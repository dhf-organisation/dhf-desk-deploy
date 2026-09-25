-- RLS regression tests for desk_tags, desk_job_tags, desk_job_sources.
-- Confirmed by reading pg_policies before writing this, not assumed: all
-- three are staff-only, no portal access, but desk_job_tags (the job<->tag
-- join table) has SELECT/INSERT/DELETE only -- no UPDATE policy, which
-- makes sense for a join table with no non-key columns to update.
create extension if not exists pgtap with schema extensions;

begin;
select plan(16);

insert into desk_tags (id, name) values
  ('f1f1f1f1-1111-1111-1111-111111111111', 'RLS Test Tag');
insert into desk_job_sources (id, name) values
  ('a2a2a2a2-2222-2222-2222-222222222222', 'RLS Test Source');
insert into desk_customers (id, name, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'RLS Test Customer A', 'pgtap');
insert into desk_jobs (id, customer_id, job_type, created_by) values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'RLS test job', 'pgtap');
insert into desk_job_tags (job_id, tag_id) values
  ('55555555-5555-5555-5555-555555555555', 'f1f1f1f1-1111-1111-1111-111111111111');

-- anon
reset role;
set local role anon;
select is((select count(*) from desk_tags)::int, 0, 'anon cannot see desk_tags rows');
select is((select count(*) from desk_job_tags)::int, 0, 'anon cannot see desk_job_tags rows');
select is((select count(*) from desk_job_sources)::int, 0, 'anon cannot see desk_job_sources rows');
select throws_ok(
  $$insert into desk_tags (name) values ('anon tag attempt')$$,
  'new row violates row-level security policy for table "desk_tags"',
  'anon cannot insert into desk_tags'
);
select throws_ok(
  $$insert into desk_job_sources (name) values ('anon source attempt')$$,
  'new row violates row-level security policy for table "desk_job_sources"',
  'anon cannot insert into desk_job_sources'
);

-- a non-allowlisted authenticated user
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"randomguy@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_tags)::int, 0, 'a non-allowlisted authenticated user cannot see desk_tags rows');
select is((select count(*) from desk_job_tags)::int, 0, 'a non-allowlisted authenticated user cannot see desk_job_tags rows');
select is((select count(*) from desk_job_sources)::int, 0, 'a non-allowlisted authenticated user cannot see desk_job_sources rows');

-- staff
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_tags)::int, 1, 'staff can see the seeded desk_tags row');
select is((select count(*) from desk_job_tags)::int, 1, 'staff can see the seeded desk_job_tags row');
select is((select count(*) from desk_job_sources)::int, 1, 'staff can see the seeded desk_job_sources row');
select lives_ok(
  $$update desk_tags set color='#ff0000' where id='f1f1f1f1-1111-1111-1111-111111111111'$$,
  'staff can update desk_tags'
);
select lives_ok(
  $$update desk_job_sources set is_active=false where id='a2a2a2a2-2222-2222-2222-222222222222'$$,
  'staff can update desk_job_sources'
);
select lives_ok(
  $$delete from desk_job_tags where job_id='55555555-5555-5555-5555-555555555555' and tag_id='f1f1f1f1-1111-1111-1111-111111111111'$$,
  'staff can delete desk_job_tags'
);
select lives_ok(
  $$delete from desk_tags where id='f1f1f1f1-1111-1111-1111-111111111111'$$,
  'staff can delete desk_tags'
);
select lives_ok(
  $$delete from desk_job_sources where id='a2a2a2a2-2222-2222-2222-222222222222'$$,
  'staff can delete desk_job_sources'
);

select * from finish();
rollback;
