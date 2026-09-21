# Architecture

## The short version

The browser talks to Postgres. That's the whole architecture.

```
  Staff browser ─┐
  Mechanic phone ─┼─→ Netlify (static files) 
  Customer phone ─┘         │
                            └─→ Supabase ── PostgREST ──→ Postgres
                                  │                         ↑
                                  ├── Auth (Google, OTP)     │ RLS decides
                                  └── pg_net ──→ Resend / Twilio
```

There is no backend of ours. Netlify serves static files and nothing else; no
function, no server, no API layer. Every read and write goes from JavaScript in
the page to PostgREST using the Supabase *publishable* key, and **row-level
security is what decides who sees what**.

The consequences are worth stating plainly, because they drive most decisions
in this repo:

- **A wrong RLS policy is a data breach**, not a bug. There is no second layer.
- **The publishable key is public** and always will be — it's in the page
  source. It identifies the project; it authorises nothing on its own.
- **The allowlist in JavaScript is not security.** `index.html` and
  `staff.html` check the signed-in email against a domain allowlist before
  showing the app. That's a UX gate. Anyone can skip it. Only RLS stops them
  reading data.
- **Business logic in the page can be bypassed**, so anything that must always
  hold — an invoice number, who can author a portal note — belongs in a
  database constraint or trigger, and several already do.

## The pages

Four independent HTML pages. They share no JavaScript and no build step; each
is effectively its own app.

### `index.html` + `app.js` — the desk

The main application, ~9,500 lines, used by office staff on desktop. Thirteen
navigation tabs: Diary, Jobs, Customers, Invoices, POS, Inventory, Suppliers,
Purchase Orders, Timesheets, Reports, Messages, Supplier Stock, Settings.

**Sign-in:** Google Identity Services → `supabase.auth.signInWithIdToken()` →
an email/domain allowlist check in JavaScript.

**Pattern throughout:** a module keeps its state in file-level `let`
variables; `loadX()` queries Supabase; `renderX()` builds a template string
and assigns it to `#main.innerHTML`. Event handlers are inline
`onclick="fn('id')"` attributes. Modals are appended to `<body>` and
`closeModal()` removes every `.modal-overlay`.

**Routing:** `switchView()` swaps the view. There's no URL routing on the
desk page, so a refresh returns you to the Diary.

### `staff.html` — the workshop floor

A mobile web app for mechanics, installable via `manifest.json`. My Jobs
(filtered on `assigned_employee_id`), the day's diary, job status changes,
clock in/out into `desk_job_time_entries`, checklists and notes. Same Google
sign-in and allowlist as the desk.

### `portal.html` — customers

Customers sign in with a Supabase email one-time code. RLS limits them to
jobs whose customer record matches their email address, and the trigger
`trg_enforce_portal_note_fields` forces any note they write to be attributed
to them — a customer can't post as staff even by crafting the request
themselves.

### `crm.html` — sales pipeline

Leads and follow-ups. Self-contained, with its own list of authorised users.

## The database

Supabase project `cztpumgrvhmcvvpqbfqo`. Tables are prefixed by module:
`desk_*` for the workshop app, with other prefixes belonging to sibling
applications.

**This project is shared.** Other DHF applications — the hub, the CRM, the
shareholder tools — live in the same Postgres database. Most of them are not
in any git repository. A migration here can affect them, and a table you don't
recognise probably belongs to one of them. See
[docs/database.md](database.md).

Access control helpers, all `SECURITY DEFINER`:

| Function | Answers |
|---|---|
| `is_desk_user()` | Is the caller a signed-in staff member? |
| `is_desk_admin()` | Is the caller an admin? |
| `portal_customer_id()` | Which customer is this signed-in portal user? |

Policies call these rather than repeating the logic, so the definition of
"staff" lives in one place.

## Integrations

- **Google Identity Services** — staff sign-in on the desk and staff pages.
- **Google Maps** — address autocomplete on the customer form.
- **Resend** (email) and **Twilio** (SMS) — called *from Postgres* via
  `pg_net`, wrapped in the RPCs `desk_send_email`, `desk_send_sms` and
  `desk_messaging_status`. Booking confirmations and day-before reminders are
  automated in the database, which means **a non-production environment
  pointed at the production database will message real customers**.
- **Supplier stock scraper** — a Playwright job using the service-role key,
  scraping tyre suppliers into `desk_supplier_stock`. It is **being retired**
  and should not be built on.

## Things that live outside this repository

- The database schema, migrations, RLS policies, triggers and RPCs. Bringing
  these into `supabase/migrations/` is in progress.
- The design brief the CSS comments refer to.
- The sibling applications sharing the Supabase project.

## Front-end conventions

The details that bite — GST-inclusive pricing, UTC dates, `esc()` and quotes,
`cssVar()` token lookups — are in [CLAUDE.md](../CLAUDE.md) and summarised in
[CONTRIBUTING.md](../CONTRIBUTING.md). Read one of them before your first
change.
