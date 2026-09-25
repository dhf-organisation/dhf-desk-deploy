-- RLS regression tests for desk_settings, desk_stock_categories,
-- desk_supplier_stock, desk_tracked_tyre_sizes, desk_xero_accounts -- the
-- last tranche needed for full desk_* RLS coverage. Confirmed by reading
-- pg_policies before writing this, not assumed. Three shapes:
--   - desk_stock_categories, desk_tracked_tyre_sizes: single ALL policy,
--     full CRUD for staff.
--   - desk_settings, desk_xero_accounts: SELECT/INSERT/UPDATE only, no
--     DELETE policy for anyone.
--   - desk_supplier_stock: SELECT + a narrowly-named UPDATE policy
--     ("request_cost") only -- no INSERT, no DELETE policy at all, for
--     anyone, not even staff. Matches the real shape of this table: it's
--     populated by the (being-retired) supplier-stock scraper via the
--     service-role key, which bypasses RLS entirely -- staff can view rows
--     and request an updated cost, but can't create or remove rows through
--     the app itself.
create extension if not exists pgtap with schema extensions;

begin;
select plan(28);

insert into desk_settings (key, value) values
  ('rls_test_setting', 'test value');
insert into desk_stock_categories (id, name) values
  ('e2e2e2e2-2222-2222-2222-222222222222', 'RLS Test Category');
insert into desk_supplier_stock (id, supplier, sku) values
  ('f2f2f2f2-2222-2222-2222-222222222222', 'RLS Test Supplier', 'RLS-TEST-SKU');
insert into desk_tracked_tyre_sizes (id, size_code) values
  ('a3a3a3a3-3333-3333-3333-333333333333', '205/55R16');
insert into desk_xero_accounts (id, code, name, created_by) values
  ('b3b3b3b3-3333-3333-3333-333333333333', 'RLS-200', 'RLS Test Account', 'pgtap');

-- anon
reset role;
set local role anon;
select is((select count(*) from desk_settings)::int, 0, 'anon cannot see desk_settings rows');
select is((select count(*) from desk_stock_categories)::int, 0, 'anon cannot see desk_stock_categories rows');
select is((select count(*) from desk_supplier_stock)::int, 0, 'anon cannot see desk_supplier_stock rows');
select is((select count(*) from desk_tracked_tyre_sizes)::int, 0, 'anon cannot see desk_tracked_tyre_sizes rows');
select is((select count(*) from desk_xero_accounts)::int, 0, 'anon cannot see desk_xero_accounts rows');
select throws_ok(
  $$insert into desk_settings (key, value) values ('anon_attempt', 'x')$$,
  'new row violates row-level security policy for table "desk_settings"',
  'anon cannot insert into desk_settings'
);
select throws_ok(
  $$insert into desk_stock_categories (name) values ('anon attempt')$$,
  'new row violates row-level security policy for table "desk_stock_categories"',
  'anon cannot insert into desk_stock_categories'
);

-- a non-allowlisted authenticated user
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"randomguy@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_settings)::int, 0, 'a non-allowlisted authenticated user cannot see desk_settings rows');
select is((select count(*) from desk_stock_categories)::int, 0, 'a non-allowlisted authenticated user cannot see desk_stock_categories rows');
select is((select count(*) from desk_supplier_stock)::int, 0, 'a non-allowlisted authenticated user cannot see desk_supplier_stock rows');
select is((select count(*) from desk_tracked_tyre_sizes)::int, 0, 'a non-allowlisted authenticated user cannot see desk_tracked_tyre_sizes rows');
select is((select count(*) from desk_xero_accounts)::int, 0, 'a non-allowlisted authenticated user cannot see desk_xero_accounts rows');

-- staff
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_settings)::int, 1, 'staff can see the seeded desk_settings row');
select is((select count(*) from desk_stock_categories)::int, 1, 'staff can see the seeded desk_stock_categories row');
select is((select count(*) from desk_supplier_stock)::int, 1, 'staff can see the seeded desk_supplier_stock row');
select is((select count(*) from desk_tracked_tyre_sizes)::int, 1, 'staff can see the seeded desk_tracked_tyre_sizes row');
select is((select count(*) from desk_xero_accounts)::int, 1, 'staff can see the seeded desk_xero_accounts row');

select lives_ok(
  $$update desk_settings set value='updated' where key='rls_test_setting'$$,
  'staff can update desk_settings'
);
delete from desk_settings where key='rls_test_setting';
select is(
  (select count(*) from desk_settings where key='rls_test_setting')::int,
  1,
  'desk_settings has no DELETE policy for anyone, not even staff -- the row is still there, not an error'
);

select lives_ok(
  $$update desk_stock_categories set name='RLS Test Category Updated' where id='e2e2e2e2-2222-2222-2222-222222222222'$$,
  'staff can update desk_stock_categories'
);
select lives_ok(
  $$delete from desk_stock_categories where id='e2e2e2e2-2222-2222-2222-222222222222'$$,
  'staff can delete desk_stock_categories'
);

select lives_ok(
  $$update desk_supplier_stock set cost_requested_at=now() where id='f2f2f2f2-2222-2222-2222-222222222222'$$,
  'staff can update desk_supplier_stock (the cost-request path)'
);
select throws_ok(
  $$insert into desk_supplier_stock (supplier, sku) values ('Another Supplier', 'ANOTHER-SKU')$$,
  'new row violates row-level security policy for table "desk_supplier_stock"',
  'desk_supplier_stock has no INSERT policy for anyone, not even staff -- rows only ever come from the scraper''s service-role key'
);
delete from desk_supplier_stock where id='f2f2f2f2-2222-2222-2222-222222222222';
select is(
  (select count(*) from desk_supplier_stock where id='f2f2f2f2-2222-2222-2222-222222222222')::int,
  1,
  'desk_supplier_stock has no DELETE policy for anyone, not even staff -- the row is still there, not an error'
);

select lives_ok(
  $$update desk_tracked_tyre_sizes set is_active=false where id='a3a3a3a3-3333-3333-3333-333333333333'$$,
  'staff can update desk_tracked_tyre_sizes'
);
select lives_ok(
  $$delete from desk_tracked_tyre_sizes where id='a3a3a3a3-3333-3333-3333-333333333333'$$,
  'staff can delete desk_tracked_tyre_sizes'
);

select lives_ok(
  $$update desk_xero_accounts set is_active=false where id='b3b3b3b3-3333-3333-3333-333333333333'$$,
  'staff can update desk_xero_accounts'
);
delete from desk_xero_accounts where id='b3b3b3b3-3333-3333-3333-333333333333';
select is(
  (select count(*) from desk_xero_accounts where id='b3b3b3b3-3333-3333-3333-333333333333')::int,
  1,
  'desk_xero_accounts has no DELETE policy for anyone, not even staff -- the row is still there, not an error'
);

select * from finish();
rollback;
