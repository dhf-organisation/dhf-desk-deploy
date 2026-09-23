-- RLS regression tests for desk_customers, the table the 2026-09-22
-- catastrophic-RLS-performance incident was found on. Everything here
-- proves the FIX didn't change WHO can see WHAT (only how fast) -- these
-- tests are the thing that should have existed before that incident, not
-- a reaction to it in isolation.
--
-- Roles covered: anon, a non-allowlisted authenticated Google user, staff,
-- and a portal customer (isolated from a second portal customer's row).
-- service_role bypasses RLS by design, so testing "it sees everything" is
-- trivially true and not asserted here.
create extension if not exists pgtap with schema extensions;

begin;
select plan(9);

-- Seeded inside this test's own transaction, rolled back at the end --
-- never touches real data, never persists.
insert into desk_customers (id, name, email, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'RLS Test Customer A', 'rls-test-a@example.invalid', 'pgtap'),
  ('22222222-2222-2222-2222-222222222222', 'RLS Test Customer B', 'rls-test-b@example.invalid', 'pgtap');

-- anon
reset role;
set local role anon;
select is(
  (select count(*) from desk_customers where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'))::int,
  0,
  'anon cannot see either seeded desk_customers row'
);
select throws_ok(
  $$insert into desk_customers (name, created_by) values ('anon insert attempt', 'pgtap')$$,
  'new row violates row-level security policy for table "desk_customers"',
  'anon cannot insert into desk_customers'
);

-- authenticated, but not staff and not a portal customer (a real Google
-- sign-in, just not on the allowlist and no matching desk_customers.email)
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"randomguy@gmail.com","role":"authenticated"}';
select is(
  (select count(*) from desk_customers where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'))::int,
  0,
  'a non-allowlisted authenticated user cannot see desk_customers rows'
);

-- staff
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is(
  (select count(*) from desk_customers where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'))::int,
  2,
  'staff can see both seeded desk_customers rows'
);
select lives_ok(
  $$insert into desk_customers (name, created_by) values ('staff insert test', 'pgtap')$$,
  'staff can insert into desk_customers'
);
select lives_ok(
  $$update desk_customers set name = 'RLS Test Customer A (updated by staff)' where id = '11111111-1111-1111-1111-111111111111'$$,
  'staff can update desk_customers'
);

-- portal customer A: sees only their own row, via portal_customer_id()
-- matching on auth.email()
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"rls-test-a@example.invalid","role":"authenticated"}';
select is(
  (select count(*) from desk_customers where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'))::int,
  1,
  'portal customer A sees exactly one of the two seeded rows'
);
select is(
  (select id::text from desk_customers where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222')),
  '11111111-1111-1111-1111-111111111111',
  'portal customer A sees their OWN row, not customer B''s'
);
update desk_customers set name = 'hacked' where id = '11111111-1111-1111-1111-111111111111';
select isnt(
  (select name from desk_customers where id = '11111111-1111-1111-1111-111111111111'),
  'hacked',
  'portal customer A cannot update their own desk_customers row (no portal UPDATE policy -- the update matches 0 rows, not an error, so it has to be checked by its absence of effect)'
);

select * from finish();
rollback;
