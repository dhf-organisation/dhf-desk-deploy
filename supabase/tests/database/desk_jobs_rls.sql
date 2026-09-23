-- RLS regression tests for desk_jobs -- the third table hit by the
-- 2026-09-22 catastrophic-RLS-performance incident. Same shape as
-- desk_customers_rls.sql/desk_vehicles_rls.sql, plus one thing specific to
-- this table: the portal-read policy also requires is_deleted = false, but
-- the STAFF policy (desk_jobs_sel) doesn't filter is_deleted at all -- a
-- soft-deleted job is invisible to portal customers but still visible to
-- staff at the RLS layer (the app's own queries filter is_deleted=false for
-- staff views by convention, not because RLS enforces it). Worth asserting
-- explicitly since it's easy to assume RLS does that filtering and be wrong.
create extension if not exists pgtap with schema extensions;

begin;
select plan(8);

insert into desk_customers (id, name, email, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'RLS Test Customer A', 'rls-test-a@example.invalid', 'pgtap'),
  ('22222222-2222-2222-2222-222222222222', 'RLS Test Customer B', 'rls-test-b@example.invalid', 'pgtap');
insert into desk_jobs (id, customer_id, job_type, is_deleted, created_by) values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'RLS test job A', false, 'pgtap'),
  ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'RLS test job B', false, 'pgtap'),
  ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', 'RLS test job A (deleted)', true, 'pgtap');

reset role;
set local role anon;
select is(
  (select count(*) from desk_jobs where id in ('55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777'))::int,
  0,
  'anon cannot see any seeded desk_jobs row'
);
select throws_ok(
  $$insert into desk_jobs (customer_id, job_type, created_by) values ('11111111-1111-1111-1111-111111111111', 'anon job', 'pgtap')$$,
  'new row violates row-level security policy for table "desk_jobs"',
  'anon cannot insert into desk_jobs'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"randomguy@gmail.com","role":"authenticated"}';
select is(
  (select count(*) from desk_jobs where id in ('55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777'))::int,
  0,
  'a non-allowlisted authenticated user cannot see desk_jobs rows'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is(
  (select count(*) from desk_jobs where id in ('55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777'))::int,
  3,
  'staff can see all 3 seeded desk_jobs rows, INCLUDING the soft-deleted one -- RLS does not filter is_deleted for staff, the app does'
);
select lives_ok(
  $$update desk_jobs set job_type = 'RLS test job A (updated)' where id = '55555555-5555-5555-5555-555555555555'$$,
  'staff can update desk_jobs'
);

-- portal customer A: matched via customer_id AND is_deleted = false
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"rls-test-a@example.invalid","role":"authenticated"}';
select is(
  (select count(*) from desk_jobs where id in ('55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777'))::int,
  1,
  'portal customer A sees exactly one job: their own, non-deleted one'
);
select is(
  (select id::text from desk_jobs where id in ('55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777')),
  '55555555-5555-5555-5555-555555555555',
  'portal customer A sees their own NON-DELETED job, not customer B''s and not their own deleted one'
);
select is(
  (select count(*) from desk_jobs where id = '77777777-7777-7777-7777-777777777777')::int,
  0,
  'portal customer A cannot see their OWN job once it is soft-deleted (is_deleted=true fails the portal-read policy)'
);

select * from finish();
rollback;
