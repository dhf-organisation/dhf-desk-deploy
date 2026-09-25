-- RLS regression test for desk_staff_allowlist -- backs is_desk_user(), moved
-- off hardcoded literals in the function body into a real table so adding or
-- removing staff is an INSERT/DELETE, not an ALTER FUNCTION (Trello: "Move
-- the staff allowlist server-side"). The table has RLS enabled with zero
-- policies at all: nobody -- not even allowlisted staff -- can read it
-- directly through PostgREST. Only the SECURITY DEFINER is_desk_user()
-- function (running as the function owner, which bypasses RLS) can see it.
-- Proven here rather than assumed from the table definition, same as every
-- other tranche.
create extension if not exists pgtap with schema extensions;

begin;
select plan(6);

-- Relies on db-local-up.mjs's own seeding step (db-seed-staff-allowlist.mjs)
-- having already populated this table by the time the suite runs -- schema
-- pulls never bring row data, and is_desk_user() now depends on this table's
-- content, not a hardcoded literal in the function body.

-- anon
reset role;
set local role anon;
select is((select count(*) from desk_staff_allowlist)::int, 0, 'anon cannot see desk_staff_allowlist rows');

-- a non-allowlisted authenticated user
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"randomguy@gmail.com","role":"authenticated"}';
select is((select count(*) from desk_staff_allowlist)::int, 0, 'a non-allowlisted authenticated user cannot see desk_staff_allowlist rows');
select is(is_desk_user(), false, 'is_desk_user() is false for a non-allowlisted email');

-- a lookalike domain attack -- must not match the '@dhftyres.com.au' suffix pattern
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"attacker@evil-dhftyres.com.au","role":"authenticated"}';
select is(is_desk_user(), false, 'is_desk_user() rejects a lookalike domain that merely contains the real domain as a substring');

-- staff -- can resolve as staff via is_desk_user(), but still cannot read the
-- allowlist table directly, same as anon
reset role;
set local role authenticated;
set local request.jwt.claims to '{"email":"lwijesuriya97@gmail.com","role":"authenticated"}';
select is(is_desk_user(), true, 'is_desk_user() is true for an allowlisted email');
select is((select count(*) from desk_staff_allowlist)::int, 0, 'staff cannot read desk_staff_allowlist directly either -- only the SECURITY DEFINER function can see it, no RLS policy grants row access to anyone');

select * from finish();
rollback;
