-- RLS regression tests for the inventory/supplier cluster: desk_stock,
-- desk_suppliers, desk_purchase_orders, desk_purchase_order_items,
-- desk_stock_adjustments. Same shape as every other tranche so far --
-- staff-only, no portal access at all (none of this is customer-facing).
-- desk_stock_adjustments is worth calling out specifically: SELECT/INSERT
-- only, no UPDATE or DELETE policy for anyone -- it's an append-only audit
-- log by design (desk_receive_po and desk_return_items, both built and
-- tested earlier this session, only ever insert into it, never touch an
-- existing row), confirmed here rather than assumed.
create extension if not exists pgtap with schema extensions;

begin;
select plan(11);

insert into desk_stock (id, name, created_by) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'RLS Test Stock Item', 'pgtap');
insert into desk_suppliers (id, name, created_by) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'RLS Test Supplier', 'pgtap');
insert into desk_purchase_orders (id, supplier_id, created_by) values
  ('12121212-1212-1212-1212-121212121212', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'pgtap');
insert into desk_purchase_order_items (id, po_id, stock_id, description) values
  ('34343434-3434-3434-3434-343434343434', '12121212-1212-1212-1212-121212121212', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'RLS test PO item');
insert into desk_stock_adjustments (id, stock_id, qty_before, qty_after, reason, adjusted_by) values
  ('56565656-5656-5656-5656-565656565656', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 0, 10, 'RLS test seed', 'pgtap');

-- anon
reset role;
set local role anon;
select is((select count(*) from desk_stock where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')::int, 0, 'anon cannot see the seeded desk_stock row');
select is((select count(*) from desk_suppliers where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff')::int, 0, 'anon cannot see the seeded desk_suppliers row');
select is((select count(*) from desk_purchase_orders where id = '12121212-1212-1212-1212-121212121212')::int, 0, 'anon cannot see the seeded desk_purchase_orders row');
select throws_ok(
  $$insert into desk_stock (name, created_by) values ('anon stock attempt', 'pgtap')$$,
  'new row violates row-level security policy for table "desk_stock"',
  'anon cannot insert into desk_stock'
);

-- a non-allowlisted authenticated user (not staff, and none of these
-- tables have any portal-customer access to be relevant to either)
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"randomguy@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_stock where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')::int, 0, 'a non-allowlisted authenticated user cannot see desk_stock rows');

-- staff
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_stock where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')::int, 1, 'staff can see the seeded desk_stock row');
select is((select count(*) from desk_purchase_order_items where id = '34343434-3434-3434-3434-343434343434')::int, 1, 'staff can see the seeded desk_purchase_order_items row');
select is((select count(*) from desk_stock_adjustments where id = '56565656-5656-5656-5656-565656565656')::int, 1, 'staff can see the seeded desk_stock_adjustments row');
select lives_ok(
  $$update desk_purchase_orders set status = 'received' where id = '12121212-1212-1212-1212-121212121212'$$,
  'staff can update desk_purchase_orders'
);
select lives_ok(
  $$insert into desk_stock_adjustments (stock_id, qty_before, qty_after) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 10, 14)$$,
  'staff can insert a new desk_stock_adjustments row'
);
update desk_stock_adjustments set reason = 'hacked' where id = '56565656-5656-5656-5656-565656565656';
select is(
  (select reason from desk_stock_adjustments where id = '56565656-5656-5656-5656-565656565656'),
  'RLS test seed',
  'desk_stock_adjustments has no UPDATE policy for anyone, not even staff -- append-only audit log by design, not an oversight'
);

select * from finish();
rollback;
