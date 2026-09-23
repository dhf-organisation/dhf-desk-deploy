-- RLS regression tests for desk_employees, desk_job_time_entries and
-- desk_timesheets. Same staff-only shape as every tranche so far, with one
-- finding worth documenting plainly rather than silently working around:
-- desk_job_time_entries' single ALL-commands policy is is_desk_user() with
-- no per-employee scoping at all -- ANY staff member can see, edit or
-- delete ANY OTHER employee's clock-in/out records, not just their own.
-- This may or may not be intentional (small workshop, managers need to
-- fix a mechanic's mis-clocked time) but it's what the policy actually
-- does today, so the test asserts that reality rather than a narrower
-- behaviour that doesn't exist. Not this test suite's job to decide if
-- that's right -- flagging it accurately is.
create extension if not exists pgtap with schema extensions;

begin;
select plan(9);

insert into desk_customers (id, name, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'RLS Test Customer A', 'pgtap');
insert into desk_jobs (id, customer_id, job_type, created_by) values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'RLS test job', 'pgtap');
insert into desk_employees (id, name, created_by) values
  ('78787878-7878-7878-7878-787878787878', 'RLS Test Employee A', 'pgtap');
insert into desk_job_time_entries (id, job_id, employee_id) values
  ('9a9a9a9a-9a9a-9a9a-9a9a-9a9a9a9a9a9a', '55555555-5555-5555-5555-555555555555', '78787878-7878-7878-7878-787878787878');
insert into desk_timesheets (id, employee_id, hours, created_by) values
  ('bcbcbcbc-bcbc-bcbc-bcbc-bcbcbcbcbcbc', '78787878-7878-7878-7878-787878787878', 8, 'pgtap');

-- anon
reset role;
set local role anon;
select is((select count(*) from desk_employees where id = '78787878-7878-7878-7878-787878787878')::int, 0, 'anon cannot see the seeded desk_employees row');
select is((select count(*) from desk_job_time_entries where id = '9a9a9a9a-9a9a-9a9a-9a9a-9a9a9a9a9a9a')::int, 0, 'anon cannot see the seeded desk_job_time_entries row');
select is((select count(*) from desk_timesheets where id = 'bcbcbcbc-bcbc-bcbc-bcbc-bcbcbcbcbcbc')::int, 0, 'anon cannot see the seeded desk_timesheets row');
select throws_ok(
  $$insert into desk_employees (name) values ('anon employee attempt')$$,
  'new row violates row-level security policy for table "desk_employees"',
  'anon cannot insert into desk_employees'
);

-- a non-allowlisted authenticated user
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"randomguy@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_employees where id = '78787878-7878-7878-7878-787878787878')::int, 0, 'a non-allowlisted authenticated user cannot see desk_employees rows');

-- staff -- including confirming the "any staff can touch any employee's
-- time entry" finding above for real
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_employees where id = '78787878-7878-7878-7878-787878787878')::int, 1, 'staff can see the seeded desk_employees row');
select is((select count(*) from desk_timesheets where id = 'bcbcbcbc-bcbc-bcbc-bcbc-bcbcbcbcbcbc')::int, 1, 'staff can see the seeded desk_timesheets row');
select lives_ok(
  $$update desk_job_time_entries set clock_out = now() where id = '9a9a9a9a-9a9a-9a9a-9a9a-9a9a9a9a9a9a'$$,
  'staff can clock out ANY employee''s time entry, not just their own -- desk_job_time_entries has no per-employee scoping in its RLS policy'
);
select lives_ok(
  $$update desk_employees set hourly_cost = 50 where id = '78787878-7878-7878-7878-787878787878'$$,
  'staff can update desk_employees, including pay-adjacent fields like hourly_cost'
);

select * from finish();
rollback;
