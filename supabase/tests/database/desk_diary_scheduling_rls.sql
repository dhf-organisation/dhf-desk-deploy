-- RLS regression tests for the diary/hoist-scheduling cluster: desk_block_outs,
-- desk_full_days, desk_day_notes, desk_job_hoist_legs. Same staff-only shape
-- as every tranche so far (is_desk_user(), no portal access) -- confirmed by
-- reading pg_policies before writing this, not assumed. Two real shape
-- differences worth proving rather than assuming:
--   - desk_block_outs and desk_job_hoist_legs each have a single ALL policy
--     (full CRUD for staff).
--   - desk_full_days and desk_day_notes have SELECT/INSERT/DELETE policies
--     only -- no UPDATE policy exists for either, so an UPDATE from staff
--     should silently affect 0 rows, same pattern already proven for
--     desk_payments and desk_stock_adjustments.
--
create extension if not exists pgtap with schema extensions;

begin;
select plan(26);

insert into desk_customers (id, name, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'RLS Test Customer A', 'pgtap');
insert into desk_jobs (id, customer_id, job_type, created_by) values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'RLS test job', 'pgtap');
insert into desk_block_outs (id, block_date, division, bay, start_hour) values
  ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', '2026-10-01', 'Tyres', 'Bay 1', 9.0);
insert into desk_full_days (note_date, created_by) values
  ('2026-10-02', 'pgtap');
insert into desk_day_notes (id, note_date, body, created_by) values
  ('b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0', '2026-10-03', 'RLS test day note', 'pgtap');
insert into desk_job_hoist_legs (id, job_id, division, bay, sequence) values
  ('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0', '55555555-5555-5555-5555-555555555555', 'Tyres', 'Bay 1', 0);

-- anon
reset role;
set local role anon;
select is((select count(*) from desk_block_outs)::int, 0, 'anon cannot see desk_block_outs rows');
select is((select count(*) from desk_full_days)::int, 0, 'anon cannot see desk_full_days rows');
select is((select count(*) from desk_day_notes)::int, 0, 'anon cannot see desk_day_notes rows');
select is((select count(*) from desk_job_hoist_legs)::int, 0, 'anon cannot see desk_job_hoist_legs rows');
select throws_ok(
  $$insert into desk_block_outs (block_date, division, bay, start_hour) values ('2026-10-04','Tyres','Bay 2', 9.0)$$,
  'new row violates row-level security policy for table "desk_block_outs"',
  'anon cannot insert into desk_block_outs'
);
select throws_ok(
  $$insert into desk_full_days (note_date, created_by) values ('2026-10-05', 'anon')$$,
  'new row violates row-level security policy for table "desk_full_days"',
  'anon cannot insert into desk_full_days'
);

-- a non-allowlisted authenticated user
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"randomguy@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_block_outs)::int, 0, 'a non-allowlisted authenticated user cannot see desk_block_outs rows');
select is((select count(*) from desk_full_days)::int, 0, 'a non-allowlisted authenticated user cannot see desk_full_days rows');
select is((select count(*) from desk_day_notes)::int, 0, 'a non-allowlisted authenticated user cannot see desk_day_notes rows');
select is((select count(*) from desk_job_hoist_legs)::int, 0, 'a non-allowlisted authenticated user cannot see desk_job_hoist_legs rows');
select is(is_desk_user(), false, 'is_desk_user() is false for a non-allowlisted email');

-- staff
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is(is_desk_user(), true, 'is_desk_user() is true for an allowlisted email');
select is((select count(*) from desk_block_outs)::int, 1, 'staff can see the seeded desk_block_outs row');
select is((select count(*) from desk_full_days)::int, 1, 'staff can see the seeded desk_full_days row');
select is((select count(*) from desk_day_notes)::int, 1, 'staff can see the seeded desk_day_notes row');
select is((select count(*) from desk_job_hoist_legs)::int, 1, 'staff can see the seeded desk_job_hoist_legs row');

select lives_ok(
  $$update desk_block_outs set reason='RLS test reason' where id='a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0'$$,
  'staff can update desk_block_outs'
);
select lives_ok(
  $$delete from desk_block_outs where id='a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0'$$,
  'staff can delete desk_block_outs'
);

select lives_ok(
  $$insert into desk_full_days (note_date, created_by) values ('2026-10-06', 'lwijesuriya97@gmail.com')$$,
  'staff can insert a new desk_full_days row'
);
update desk_full_days set created_by='hacked' where note_date='2026-10-02';
select is(
  (select created_by from desk_full_days where note_date='2026-10-02'),
  'pgtap',
  'desk_full_days has no UPDATE policy for anyone, not even staff -- created_by is unchanged'
);
select lives_ok(
  $$delete from desk_full_days where note_date='2026-10-02'$$,
  'staff can delete desk_full_days (the actual correction path, since there is no UPDATE policy)'
);

select lives_ok(
  $$insert into desk_day_notes (note_date, body, created_by) values ('2026-10-07', 'a new day note', 'lwijesuriya97@gmail.com')$$,
  'staff can insert a new desk_day_notes row'
);
update desk_day_notes set body='hacked' where id='b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0';
select is(
  (select body from desk_day_notes where id='b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0'),
  'RLS test day note',
  'desk_day_notes has no UPDATE policy for anyone, not even staff -- body is unchanged'
);
select lives_ok(
  $$delete from desk_day_notes where id='b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0'$$,
  'staff can delete desk_day_notes (the actual correction path, since there is no UPDATE policy)'
);

select lives_ok(
  $$update desk_job_hoist_legs set sequence=1 where id='c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0'$$,
  'staff can update desk_job_hoist_legs'
);
select lives_ok(
  $$delete from desk_job_hoist_legs where id='c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0'$$,
  'staff can delete desk_job_hoist_legs'
);

select * from finish();
rollback;
