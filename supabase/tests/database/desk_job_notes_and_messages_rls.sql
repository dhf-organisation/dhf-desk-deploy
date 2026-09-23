-- RLS regression tests for desk_job_notes and desk_messages. Read the
-- actual policies and the enforce_portal_note_fields() trigger body before
-- writing anything, not assumed from either table's name:
--
-- desk_job_notes is the richest policy set in this whole suite so far:
--   - DELETE/UPDATE: author_email = auth.email() OR is_desk_admin() -- a
--     regular staff member can only touch their OWN note; deleting or
--     editing someone else's requires hub_users.role='admin' (a separate
--     table from the staff allowlist -- is_desk_admin() checks THAT, not
--     is_desk_user()). Different shape from desk_job_time_entries (#50),
--     which let ANY staff touch ANY employee's record -- worth proving
--     both are real and different, not assuming one pattern applies
--     everywhere.
--   - SELECT: staff see everything; portal customers see only
--     is_office_only = false notes on their own job -- the "office-only
--     notes must never appear in anything customer-facing" rule actually
--     enforced at the RLS layer, not just a convention.
--   - The portal INSERT policy's WITH CHECK doesn't itself block a customer
--     claiming is_office_only=true or author_type='staff' -- that's caught
--     by a separate trigger, enforce_portal_note_fields(), which force-
--     overwrites both fields when the caller isn't staff. Tested here by
--     actually trying to spoof it and checking what got stored, not by
--     reading the trigger source and assuming it works.
--
-- desk_messages is simpler: a single ALL policy, staff-only, no portal
-- access -- customers never see the raw message log (they see status via
-- their own job/portal views elsewhere).
create extension if not exists pgtap with schema extensions;

begin;
select plan(12);

insert into desk_customers (id, name, email, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'RLS Test Customer A', 'rls-test-a@example.invalid', 'pgtap');
insert into desk_jobs (id, customer_id, job_type, created_by) values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'RLS test job', 'pgtap');
insert into desk_job_notes (id, job_id, author_email, body, is_office_only) values
  ('cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd', '55555555-5555-5555-5555-555555555555', 'lwijesuriya97@gmail.com', 'Public note visible to the customer', false),
  ('efefefef-efef-efef-efef-efefefefefef', '55555555-5555-5555-5555-555555555555', 'someoneelse@dhftyres.com.au', 'Office-only internal note', true);
insert into desk_messages (id, channel, to_address, body, customer_id) values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'sms', '0400000000', 'RLS test message body', '11111111-1111-1111-1111-111111111111');

-- anon
reset role;
set local role anon;
select is((select count(*) from desk_job_notes where job_id = '55555555-5555-5555-5555-555555555555')::int, 0, 'anon cannot see any desk_job_notes rows');
select is((select count(*) from desk_messages where id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1')::int, 0, 'anon cannot see the seeded desk_messages row');

-- portal customer A: only the non-office-only note on their own job
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"rls-test-a@example.invalid","role":"authenticated"}';
select is(
  (select count(*) from desk_job_notes where job_id = '55555555-5555-5555-5555-555555555555')::int,
  1,
  'portal customer A sees exactly one of the two notes on their job'
);
select is(
  (select is_office_only from desk_job_notes where job_id = '55555555-5555-5555-5555-555555555555'),
  false,
  'the one note portal customer A can see is the non-office-only one, not the internal one'
);
select is((select count(*) from desk_messages where customer_id = '11111111-1111-1111-1111-111111111111')::int, 0, 'portal customer A cannot see the desk_messages log at all');

-- portal customer A tries to spoof an office-only, staff-authored note --
-- the INSERT's own WITH CHECK allows it (job_id belongs to them), but
-- enforce_portal_note_fields() should force-correct is_office_only and
-- author_type regardless of what was submitted
insert into desk_job_notes (id, job_id, body, is_office_only, author_type)
  values ('12341234-1234-1234-1234-123412341234', '55555555-5555-5555-5555-555555555555', 'trying to spoof office-only', true, 'staff');
select is(
  (select is_office_only from desk_job_notes where id = '12341234-1234-1234-1234-123412341234'),
  false,
  'a portal customer cannot spoof is_office_only=true -- enforce_portal_note_fields() forces it to false regardless of what was submitted'
);
select is(
  (select author_type from desk_job_notes where id = '12341234-1234-1234-1234-123412341234'),
  'customer',
  'a portal customer cannot spoof author_type=staff either -- same trigger forces it to customer'
);

-- staff (non-admin -- no hub_users row seeded for this email, so
-- is_desk_admin() is false, same as a real non-admin allowlisted account)
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_job_notes where job_id = '55555555-5555-5555-5555-555555555555')::int, 3, 'staff can see all notes on the job, including the office-only one and the portal-inserted one');
select is((select count(*) from desk_messages where id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1')::int, 1, 'staff can see the desk_messages log');
select lives_ok(
  $$delete from desk_job_notes where id = 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd'$$,
  'a non-admin staff member CAN delete their own note (author_email matches auth.email())'
);
update desk_job_notes set body = 'hacked' where id = 'efefefef-efef-efef-efef-efefefefefef';
select is(
  (select body from desk_job_notes where id = 'efefefef-efef-efef-efef-efefefefefef'),
  'Office-only internal note',
  'a non-admin staff member CANNOT edit another staff member''s note -- author_email does not match and is_desk_admin() is false (no hub_users admin row seeded for this test)'
);
select lives_ok(
  $$insert into desk_job_notes (job_id, body) values ('55555555-5555-5555-5555-555555555555', 'a new staff note')$$,
  'staff can insert a new desk_job_notes row'
);

select * from finish();
rollback;
