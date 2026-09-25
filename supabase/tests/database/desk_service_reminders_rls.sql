-- RLS regression tests for desk_service_types, desk_follow_ups,
-- desk_reviews. Confirmed by reading pg_policies before writing this, not
-- assumed: all three staff-only, no portal access, but two real shape
-- differences worth proving:
--   - desk_service_types has SELECT/INSERT/UPDATE only -- no DELETE policy
--     (service types are deactivated via is_active, never hard-deleted).
--   - desk_reviews has SELECT/INSERT only -- no UPDATE, no DELETE at all,
--     an append-only record once a review is logged.
-- desk_follow_ups has a single ALL policy -- full CRUD for staff.
create extension if not exists pgtap with schema extensions;

begin;
select plan(18);

insert into desk_service_types (id, name, created_by) values
  ('b2b2b2b2-2222-2222-2222-222222222222', 'RLS Test Service Type', 'pgtap');
insert into desk_customers (id, name, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'RLS Test Customer A', 'pgtap');
insert into desk_follow_ups (id, customer_id, note, created_by) values
  ('c2c2c2c2-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'RLS test follow-up', 'pgtap');
insert into desk_reviews (id, customer_id, rating, created_by) values
  ('d2d2d2d2-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 5, 'pgtap');

-- anon
reset role;
set local role anon;
select is((select count(*) from desk_service_types)::int, 0, 'anon cannot see desk_service_types rows');
select is((select count(*) from desk_follow_ups)::int, 0, 'anon cannot see desk_follow_ups rows');
select is((select count(*) from desk_reviews)::int, 0, 'anon cannot see desk_reviews rows');
select throws_ok(
  $$insert into desk_service_types (name, created_by) values ('anon attempt', 'pgtap')$$,
  'new row violates row-level security policy for table "desk_service_types"',
  'anon cannot insert into desk_service_types'
);
select throws_ok(
  $$insert into desk_follow_ups (customer_id, note) values ('11111111-1111-1111-1111-111111111111', 'anon attempt')$$,
  'new row violates row-level security policy for table "desk_follow_ups"',
  'anon cannot insert into desk_follow_ups'
);

-- a non-allowlisted authenticated user
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"randomguy@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_service_types)::int, 0, 'a non-allowlisted authenticated user cannot see desk_service_types rows');
select is((select count(*) from desk_follow_ups)::int, 0, 'a non-allowlisted authenticated user cannot see desk_follow_ups rows');
select is((select count(*) from desk_reviews)::int, 0, 'a non-allowlisted authenticated user cannot see desk_reviews rows');

-- staff
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_service_types)::int, 1, 'staff can see the seeded desk_service_types row');
select is((select count(*) from desk_follow_ups)::int, 1, 'staff can see the seeded desk_follow_ups row');
select is((select count(*) from desk_reviews)::int, 1, 'staff can see the seeded desk_reviews row');

select lives_ok(
  $$update desk_service_types set is_active=false where id='b2b2b2b2-2222-2222-2222-222222222222'$$,
  'staff can update desk_service_types'
);
delete from desk_service_types where id='b2b2b2b2-2222-2222-2222-222222222222';
select is(
  (select count(*) from desk_service_types where id='b2b2b2b2-2222-2222-2222-222222222222')::int,
  1,
  'desk_service_types has no DELETE policy for anyone, not even staff -- the row is still there, not an error'
);

select lives_ok(
  $$update desk_follow_ups set status='processed' where id='c2c2c2c2-2222-2222-2222-222222222222'$$,
  'staff can update desk_follow_ups'
);
select lives_ok(
  $$delete from desk_follow_ups where id='c2c2c2c2-2222-2222-2222-222222222222'$$,
  'staff can delete desk_follow_ups'
);

select lives_ok(
  $$insert into desk_reviews (customer_id, rating, created_by) values ('11111111-1111-1111-1111-111111111111', 4, 'lwijesuriya97@gmail.com')$$,
  'staff can insert a new desk_reviews row'
);
update desk_reviews set rating=1 where id='d2d2d2d2-2222-2222-2222-222222222222';
select is(
  (select rating from desk_reviews where id='d2d2d2d2-2222-2222-2222-222222222222'),
  5,
  'desk_reviews has no UPDATE policy for anyone, not even staff -- rating is unchanged, not an error'
);
delete from desk_reviews where id='d2d2d2d2-2222-2222-2222-222222222222';
select is(
  (select count(*) from desk_reviews where id='d2d2d2d2-2222-2222-2222-222222222222')::int,
  1,
  'desk_reviews has no DELETE policy for anyone, not even staff -- reviews are append-only, the row is still there'
);

select * from finish();
rollback;
