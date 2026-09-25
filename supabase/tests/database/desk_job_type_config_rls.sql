-- RLS regression tests for the job-type configuration cluster:
-- desk_job_types, desk_job_type_invoice_items, desk_checklist_templates,
-- desk_job_checklist_items. Same staff-only, single-ALL-policy shape across
-- all four -- confirmed by reading pg_policies before writing this, not
-- assumed. Bundled together because desk_job_type_invoice_items and
-- desk_checklist_templates both FK to desk_job_types, which needs seeding
-- either way.
create extension if not exists pgtap with schema extensions;

begin;
select plan(22);

insert into desk_job_types (id, name) values
  ('a1a1a1a1-1111-1111-1111-111111111111', 'RLS Test Job Type');
insert into desk_job_type_invoice_items (id, job_type_id, description) values
  ('b1b1b1b1-1111-1111-1111-111111111111', 'a1a1a1a1-1111-1111-1111-111111111111', 'RLS test line item');
insert into desk_checklist_templates (id, job_type_id, label) values
  ('c1c1c1c1-1111-1111-1111-111111111111', 'a1a1a1a1-1111-1111-1111-111111111111', 'RLS test checklist item');
insert into desk_customers (id, name, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'RLS Test Customer A', 'pgtap');
insert into desk_jobs (id, customer_id, job_type, created_by) values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'RLS test job', 'pgtap');
insert into desk_job_checklist_items (id, job_id, label) values
  ('d1d1d1d1-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 'RLS test job checklist item');

-- anon
reset role;
set local role anon;
select is((select count(*) from desk_job_types)::int, 0, 'anon cannot see desk_job_types rows');
select is((select count(*) from desk_job_type_invoice_items)::int, 0, 'anon cannot see desk_job_type_invoice_items rows');
select is((select count(*) from desk_checklist_templates)::int, 0, 'anon cannot see desk_checklist_templates rows');
select is((select count(*) from desk_job_checklist_items)::int, 0, 'anon cannot see desk_job_checklist_items rows');
select throws_ok(
  $$insert into desk_job_types (name) values ('anon job type attempt')$$,
  'new row violates row-level security policy for table "desk_job_types"',
  'anon cannot insert into desk_job_types'
);
select throws_ok(
  $$insert into desk_checklist_templates (job_type_id, label) values ('a1a1a1a1-1111-1111-1111-111111111111', 'anon attempt')$$,
  'new row violates row-level security policy for table "desk_checklist_templates"',
  'anon cannot insert into desk_checklist_templates'
);

-- a non-allowlisted authenticated user
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"randomguy@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_job_types)::int, 0, 'a non-allowlisted authenticated user cannot see desk_job_types rows');
select is((select count(*) from desk_job_type_invoice_items)::int, 0, 'a non-allowlisted authenticated user cannot see desk_job_type_invoice_items rows');
select is((select count(*) from desk_checklist_templates)::int, 0, 'a non-allowlisted authenticated user cannot see desk_checklist_templates rows');
select is((select count(*) from desk_job_checklist_items)::int, 0, 'a non-allowlisted authenticated user cannot see desk_job_checklist_items rows');

-- staff
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_job_types)::int, 1, 'staff can see the seeded desk_job_types row');
select is((select count(*) from desk_job_type_invoice_items)::int, 1, 'staff can see the seeded desk_job_type_invoice_items row');
select is((select count(*) from desk_checklist_templates)::int, 1, 'staff can see the seeded desk_checklist_templates row');
select is((select count(*) from desk_job_checklist_items)::int, 1, 'staff can see the seeded desk_job_checklist_items row');

select lives_ok(
  $$update desk_job_types set is_active = false where id='a1a1a1a1-1111-1111-1111-111111111111'$$,
  'staff can update desk_job_types'
);
select lives_ok(
  $$update desk_job_type_invoice_items set qty = 2 where id='b1b1b1b1-1111-1111-1111-111111111111'$$,
  'staff can update desk_job_type_invoice_items'
);
select lives_ok(
  $$update desk_checklist_templates set label = 'updated' where id='c1c1c1c1-1111-1111-1111-111111111111'$$,
  'staff can update desk_checklist_templates'
);
select lives_ok(
  $$update desk_job_checklist_items set is_complete = true where id='d1d1d1d1-1111-1111-1111-111111111111'$$,
  'staff can update desk_job_checklist_items'
);

select lives_ok(
  $$delete from desk_job_checklist_items where id='d1d1d1d1-1111-1111-1111-111111111111'$$,
  'staff can delete desk_job_checklist_items'
);
select lives_ok(
  $$delete from desk_checklist_templates where id='c1c1c1c1-1111-1111-1111-111111111111'$$,
  'staff can delete desk_checklist_templates'
);
select lives_ok(
  $$delete from desk_job_type_invoice_items where id='b1b1b1b1-1111-1111-1111-111111111111'$$,
  'staff can delete desk_job_type_invoice_items'
);
select lives_ok(
  $$delete from desk_job_types where id='a1a1a1a1-1111-1111-1111-111111111111'$$,
  'staff can delete desk_job_types'
);

select * from finish();
rollback;
