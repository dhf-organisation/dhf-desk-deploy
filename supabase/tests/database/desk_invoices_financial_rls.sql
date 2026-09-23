-- RLS regression tests for the financial trio: desk_invoices,
-- desk_invoice_items, desk_payments. Unlike desk_customers/desk_vehicles/
-- desk_jobs, none of these three has a portal-read policy -- confirmed by
-- reading pg_policies directly before writing this, not assumed from the
-- other tables' shape: portal customers see their job's status through
-- desk_jobs, not an itemised invoice of their own. Staff-only, full stop.
--
-- Also confirmed directly rather than assumed: desk_invoices has no DELETE
-- policy at all (invoices can't be hard-deleted by anyone via RLS), and
-- desk_payments has no UPDATE policy (a payment is corrected by deleting
-- and re-recording, not editing in place -- matches how savePayment/
-- deletePayment in app.js actually work).
create extension if not exists pgtap with schema extensions;

begin;
select plan(11);

insert into desk_customers (id, name, email, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'RLS Test Customer A', 'rls-test-a@example.invalid', 'pgtap');
insert into desk_invoices (id, customer_id, doc_type, created_by) values
  ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'invoice', 'pgtap');
insert into desk_invoice_items (id, invoice_id, description, qty, unit_price) values
  ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888', 'RLS test item', 1, 100);
insert into desk_payments (id, invoice_id, amount, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '88888888-8888-8888-8888-888888888888', 100, 'pgtap');

-- anon
reset role;
set local role anon;
select is((select count(*) from desk_invoices where id = '88888888-8888-8888-8888-888888888888')::int, 0, 'anon cannot see the seeded desk_invoices row');
select is((select count(*) from desk_invoice_items where id = '99999999-9999-9999-9999-999999999999')::int, 0, 'anon cannot see the seeded desk_invoice_items row');
select is((select count(*) from desk_payments where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::int, 0, 'anon cannot see the seeded desk_payments row');
select throws_ok(
  $$insert into desk_payments (invoice_id, amount, created_by) values ('88888888-8888-8888-8888-888888888888', 999, 'pgtap')$$,
  'new row violates row-level security policy for table "desk_payments"',
  'anon cannot insert a payment'
);

-- portal customer A -- owns the customer AND the invoice, still can't see
-- it: confirms there really is no portal-read path onto these 3 tables,
-- not just "this particular customer isn't matched"
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"rls-test-a@example.invalid","role":"authenticated"}';
select is(
  (select count(*) from desk_invoices where id = '88888888-8888-8888-8888-888888888888')::int,
  0,
  'a portal customer cannot see their own invoice -- no portal-read policy exists on desk_invoices'
);

-- staff
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_invoices where id = '88888888-8888-8888-8888-888888888888')::int, 1, 'staff can see the seeded desk_invoices row');
select is((select count(*) from desk_invoice_items where id = '99999999-9999-9999-9999-999999999999')::int, 1, 'staff can see the seeded desk_invoice_items row');
select is((select count(*) from desk_payments where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::int, 1, 'staff can see the seeded desk_payments row');
select lives_ok(
  $$update desk_invoices set notes = 'RLS test note' where id = '88888888-8888-8888-8888-888888888888'$$,
  'staff can update desk_invoices'
);
insert into desk_payments (id, invoice_id, amount, created_by) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '88888888-8888-8888-8888-888888888888', 50, 'pgtap');
update desk_payments set amount = 999 where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select is(
  (select amount from desk_payments where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  50::numeric,
  'desk_payments genuinely has no UPDATE policy at all, even for staff -- amount is unchanged, not an error, matching how an UPDATE with no matching policy behaves'
);
select lives_ok(
  $$delete from desk_payments where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'staff can delete desk_payments (the actual correction path, since there is no UPDATE policy)'
);

select * from finish();
rollback;
