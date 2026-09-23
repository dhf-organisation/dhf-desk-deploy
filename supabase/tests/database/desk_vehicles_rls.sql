-- RLS regression tests for desk_vehicles -- one of the 3 tables hit by the
-- 2026-09-22 catastrophic-RLS-performance incident. Same coverage shape as
-- desk_customers_rls.sql: proves the perf fix didn't change WHO can see
-- WHAT, only how fast. See that file for the role-switching pattern this
-- one reuses; comments here focus on what's different about this table.
create extension if not exists pgtap with schema extensions;

begin;
select plan(7);

insert into desk_customers (id, name, email, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'RLS Test Customer A', 'rls-test-a@example.invalid', 'pgtap'),
  ('22222222-2222-2222-2222-222222222222', 'RLS Test Customer B', 'rls-test-b@example.invalid', 'pgtap');
insert into desk_vehicles (id, customer_id, rego, created_by) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'RLSA01', 'pgtap'),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'RLSB01', 'pgtap');

reset role;
set local role anon;
select is(
  (select count(*) from desk_vehicles where id in ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444'))::int,
  0,
  'anon cannot see either seeded desk_vehicles row'
);
select throws_ok(
  $$insert into desk_vehicles (customer_id, rego, created_by) values ('11111111-1111-1111-1111-111111111111', 'ANON01', 'pgtap')$$,
  'new row violates row-level security policy for table "desk_vehicles"',
  'anon cannot insert into desk_vehicles'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"randomguy@gmail.com","role":"authenticated"}';
select is(
  (select count(*) from desk_vehicles where id in ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444'))::int,
  0,
  'a non-allowlisted authenticated user cannot see desk_vehicles rows'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is(
  (select count(*) from desk_vehicles where id in ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444'))::int,
  2,
  'staff can see both seeded desk_vehicles rows'
);
select lives_ok(
  $$update desk_vehicles set rego = 'RLSA02' where id = '33333333-3333-3333-3333-333333333333'$$,
  'staff can update desk_vehicles'
);

-- portal customer A: matched via customer_id, not the vehicle's own id
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"rls-test-a@example.invalid","role":"authenticated"}';
select is(
  (select count(*) from desk_vehicles where id in ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444'))::int,
  1,
  'portal customer A sees exactly one of the two seeded vehicles'
);
select is(
  (select id::text from desk_vehicles where id in ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444')),
  '33333333-3333-3333-3333-333333333333',
  'portal customer A sees their OWN vehicle (matched via customer_id), not customer B''s'
);

select * from finish();
rollback;
