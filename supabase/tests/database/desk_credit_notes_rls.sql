-- RLS regression tests for desk_credit_notes, desk_credit_note_items and
-- desk_credit_applications. Simplest of the tranches so far: each table
-- has exactly one ALL-commands policy (is_desk_user() for both USING and
-- WITH CHECK) -- confirmed by reading pg_policies before writing this, not
-- assumed. No portal access at all; customers don't manage their own
-- credit notes.
--
-- desk_credit_note_items needs seeding before an application can be
-- inserted for real: trg_desk_credit_application_guard (a real production
-- trigger, exercised manually many times earlier this session) rejects any
-- application whose amount exceeds the credit note's item total -- with no
-- items, the total is 0 and every application would fail the guard, not
-- the RLS policy being tested here. Seeded so the INSERT test proves what
-- it's meant to prove.
create extension if not exists pgtap with schema extensions;

begin;
select plan(10);

insert into desk_customers (id, name, email, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'RLS Test Customer A', 'rls-test-a@example.invalid', 'pgtap');
insert into desk_credit_notes (id, customer_id, status, created_by) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'issued', 'pgtap');
insert into desk_credit_note_items (id, credit_note_id, description, qty, unit_price) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'RLS test credit item', 1, 100);

-- anon
reset role;
set local role anon;
select is((select count(*) from desk_credit_notes where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc')::int, 0, 'anon cannot see the seeded desk_credit_notes row');
select is((select count(*) from desk_credit_note_items where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd')::int, 0, 'anon cannot see the seeded desk_credit_note_items row');
select is((select count(*) from desk_credit_applications where credit_note_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc')::int, 0, 'anon cannot see desk_credit_applications rows');
select throws_ok(
  $$insert into desk_credit_notes (customer_id, created_by) values ('11111111-1111-1111-1111-111111111111', 'pgtap')$$,
  'new row violates row-level security policy for table "desk_credit_notes"',
  'anon cannot insert into desk_credit_notes'
);

-- a non-allowlisted authenticated user (not staff, not relevant to portal
-- customers either way -- these tables have no portal access at all)
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"randomguy@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_credit_notes where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc')::int, 0, 'a non-allowlisted authenticated user cannot see desk_credit_notes rows');

-- a portal customer -- owns the customer AND the credit note, still can't
-- see it: no portal-read policy exists on this table at all
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"rls-test-a@example.invalid","role":"authenticated"}';
select is((select count(*) from desk_credit_notes where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc')::int, 0, 'a portal customer cannot see their own credit note -- no portal-read policy exists');

-- staff: full CRUD, exercised against all three tables
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_credit_notes where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc')::int, 1, 'staff can see the seeded desk_credit_notes row');
select lives_ok(
  $$update desk_credit_notes set reason = 'RLS test reason' where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  'staff can update desk_credit_notes'
);
select lives_ok(
  $$insert into desk_credit_applications (credit_note_id, amount, method) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 100, 'write_off')$$,
  'staff can insert into desk_credit_applications (within the seeded credit note''s balance, so trg_desk_credit_application_guard allows it)'
);
select lives_ok(
  $$delete from desk_credit_note_items where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'$$,
  'staff can delete desk_credit_note_items'
);

select * from finish();
rollback;
