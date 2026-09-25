-- RLS regression tests for desk_bills and desk_bill_payments (supplier
-- bills -- the accounts-payable side, mirroring desk_invoices/desk_payments
-- on the accounts-receivable side). Staff-only, no portal access at all --
-- confirmed by reading pg_policies before writing this, not assumed.
--
-- Same "no DELETE"/"no UPDATE" shape already proven for desk_invoices and
-- desk_payments, here on the supplier side: desk_bills has no DELETE policy
-- for anyone (bills can't be hard-deleted), and desk_bill_payments has no
-- UPDATE policy (a payment is corrected by deleting and re-recording, not
-- editing in place).
create extension if not exists pgtap with schema extensions;

begin;
select plan(13);

insert into desk_suppliers (id, name, created_by) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'RLS Test Supplier', 'pgtap');
insert into desk_bills (id, supplier_id, amount, created_by) values
  ('d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 250.00, 'pgtap');
insert into desk_bill_payments (id, bill_id, amount, created_by) values
  ('e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1', 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1', 100.00, 'pgtap');

-- anon
reset role;
set local role anon;
select is((select count(*) from desk_bills)::int, 0, 'anon cannot see desk_bills rows');
select is((select count(*) from desk_bill_payments)::int, 0, 'anon cannot see desk_bill_payments rows');
select throws_ok(
  $$insert into desk_bills (supplier_id, amount, created_by) values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 50, 'pgtap')$$,
  'new row violates row-level security policy for table "desk_bills"',
  'anon cannot insert into desk_bills'
);
select throws_ok(
  $$insert into desk_bill_payments (bill_id, amount, created_by) values ('d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1', 10, 'pgtap')$$,
  'new row violates row-level security policy for table "desk_bill_payments"',
  'anon cannot insert into desk_bill_payments'
);

-- a non-allowlisted authenticated user
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"randomguy@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_bills)::int, 0, 'a non-allowlisted authenticated user cannot see desk_bills rows');
select is((select count(*) from desk_bill_payments)::int, 0, 'a non-allowlisted authenticated user cannot see desk_bill_payments rows');

-- staff
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_bills)::int, 1, 'staff can see the seeded desk_bills row');
select is((select count(*) from desk_bill_payments)::int, 1, 'staff can see the seeded desk_bill_payments row');
select lives_ok(
  $$update desk_bills set status='awaiting_payment' where id='d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1'$$,
  'staff can update desk_bills'
);
delete from desk_bills where id='d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1';
select is(
  (select count(*) from desk_bills where id='d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1')::int,
  1,
  'desk_bills has no DELETE policy for anyone, not even staff -- the row is still there, not an error'
);
select lives_ok(
  $$insert into desk_bill_payments (bill_id, amount, created_by) values ('d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1', 50, 'lwijesuriya97@gmail.com')$$,
  'staff can insert a new desk_bill_payments row'
);
update desk_bill_payments set amount=999 where id='e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1';
select is(
  (select amount from desk_bill_payments where id='e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1'),
  100.00::numeric,
  'desk_bill_payments has no UPDATE policy for anyone, not even staff -- amount is unchanged, not an error'
);
select lives_ok(
  $$delete from desk_bill_payments where id='e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1'$$,
  'staff can delete desk_bill_payments (the actual correction path, since there is no UPDATE policy)'
);

select * from finish();
rollback;
