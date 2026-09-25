# Database

Supabase project `cztpumgrvhmcvvpqbfqo`, Postgres. The browser queries it
directly through PostgREST — there is no application server between a user and
the database.

## Read this first

**Row-level security is the only access control.** A table with RLS disabled,
or with a policy that permits more than it should, is readable by anyone on the
internet who knows the table name. They don't need credentials; the publishable
key is in the page source and is meant to be.

So:

- Every table has RLS **enabled**, with policies in the same migration that
  creates it.
- Policies express intent through the helper functions rather than repeating
  logic.
- `USING (true)` on a `SELECT` policy means "the public may read this". Write
  it only when that's genuinely what you mean.

## Access helpers

`SECURITY DEFINER` functions that policies call:

| Function | Returns |
|---|---|
| `is_desk_user()` | true if the caller is a signed-in staff member |
| `is_desk_admin()` | true if the caller is an admin |
| `portal_customer_id()` | the `desk_customers.id` for the signed-in portal user |

A `SECURITY DEFINER` function runs with its creator's privileges, so it must
pin `search_path` — otherwise a caller can shadow the tables it reads and make
it return whatever they like:

```sql
create or replace function is_desk_user() returns boolean
language sql stable security definer
set search_path = public, pg_temp   -- required
as $$ ... $$;
```

Helpers should also fail closed. `portal_customer_id()` returning NULL for a
user with no matching customer record makes policies simply match nothing;
raising an exception instead turns a normal state into a 500 for the user.

### Call these functions wrapped in `(select ...)`

Every policy that calls `is_desk_user()`, `is_desk_admin()`, `portal_customer_id()`
or Supabase's own `auth.<function>()` (`auth.uid()`, `auth.jwt()`, ...) must wrap
the call: `(select is_desk_user())`, not a bare `is_desk_user()`. Unwrapped, Postgres
re-evaluates the function **once per row** instead of once per query — on one
occasion this turned reads that should take milliseconds into ones taking
multi-second to 96-second, across 65 policies on 43 tables at once (fixed via
PR referenced from the Trello card ["RLS query performance: unwrap auth
function calls"](https://trello.com/c/9LqMiUUc)). Same fix, always:

```sql
-- Slow: re-evaluated per row
using ( is_desk_user() )

-- Fast: evaluated once per query
using ( (select is_desk_user()) )
```

**This is caught automatically, not by a custom script here.** Supabase's own
database linter flags it as `auth_rls_initplan` (category `PERFORMANCE`,
level `WARN`) — check it any time via the Management API
(`GET /v1/projects/{ref}/advisors/performance`) or the dashboard's Advisor
page, rather than building bespoke tooling to scan `supabase/migrations/` for
the same pattern. Confirmed 2026-09-25: querying the advisor live turned up a
real, current instance on `hub_tokens` (a sibling module's table, not this
repo's — see [Shared project](#shared-project) below), proving the linter
actually catches this class of bug, not just in theory.

## Shared project

**Other applications share this database.** The DHF hub, the CRM, and the
shareholder tools all live here, and most aren't in any git repository. A table
you don't recognise probably belongs to one of them.

Practical consequences:

- Don't drop or rename anything you can't account for.
- `desk_*` is the workshop app. Other prefixes are somebody else's.
- Before changing a shared table, ask who else writes to it. "Nothing in this
  repo reads it" isn't an answer — most of what reads this database isn't in
  this repo.

## Migrations

Schema changes go in `supabase/migrations/` as
`YYYYMMDDHHMMSS_snake_case_description.sql`. Filename order is apply order,
which is why the format is enforced by `scripts/check-migrations.mjs`.

**Never change the schema through the Supabase dashboard.** A change made
there exists in exactly one place, can't be reviewed, can't be replayed into
another environment, and will be silently overwritten the first time someone
rebuilds from migrations.

### Expand/contract

Migration and deploy are separate steps and will never be atomic. There is
always a window where the new schema is live and the old page is still in
someone's browser. So:

1. **Expand** — add the new column/table, nullable, with a default. Ship it.
2. **Migrate** — backfill, and ship the front end that writes both old and new.
3. **Contract** — once nothing reads the old shape, remove it. A later release.

Renaming a column in one migration breaks every open tab.

### Destructive SQL

`DROP`, `TRUNCATE`, `DELETE FROM`, and adding `NOT NULL` to an existing column
all need a declaration on the first line of the file:

```sql
-- destructive: drops desk_legacy_notes; rows migrated to desk_job_notes in 20260901120000
```

CI fails without it. The point isn't to prevent destructive migrations — it's
to make sure the reviewer knows they're reviewing one. This database is a
working tyre shop's books; an unnoticed `DROP` is how a day of invoices
disappears.

### Applying a migration

Today, production is the only database, so a migration is applied by hand
after the PR merges, by whoever wrote it, and the PR says so. Once staging
exists this moves into the release pipeline
([docs/release-and-rollback.md](release-and-rollback.md)).

Before applying anything destructive to production: confirm the most recent
backup, and know what restoring it would cost.

## Conventions in the data

Things that will surprise you:

- **Prices include GST.** GST is the total ÷ 11, not × 0.1. `buy_price` on
  stock is stored inclusive too, though the form asks for it exclusive and
  converts.
- **Document numbers are generated in the database** —
  `desk_invoices.invoice_no`, `credit_note_no`, `po_no`. Don't compute them in
  the page.
- **`order_no` is copied from job to invoice deliberately.** Editing the job
  afterwards must not change an invoice that's already been sent.
- **`assigned_mechanic` (text) mirrors `assigned_employee_id`** because older
  reports read the text column. Write both.
- **`desk_settings.value` is text** holding an object, a JSON string, or a
  plain string depending on the key. Read it through `parseSettingValue`.
- **Timestamps come back in UTC.** Anything the user thinks of as a date needs
  `isoDateOnly()` or `sameLocalDate()`.

## Triggers worth knowing about

- `trg_enforce_portal_note_fields` — forces portal notes to be attributed to
  the customer who wrote them. A customer can't post as staff even by crafting
  the request themselves.
- `desk_credit_application_guard` — guards credit application state.

Business rules that must always hold belong here, not in the page. Anything in
JavaScript can be bypassed by anyone who opens the network tab.

## Messaging from the database

Resend (email) and Twilio (SMS) are called from Postgres via `pg_net`, wrapped
in `desk_send_email`, `desk_send_sms` and `desk_messaging_status`. Booking
confirmations and day-before reminders fire automatically.

**This means a non-production environment pointed at the production database
will text real customers.** Check messaging configuration before connecting
anything new.
