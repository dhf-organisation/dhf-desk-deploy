# DHF Desk — project context

@.claude/rules/trello-workflow.md

**Before doing any work, follow the Trello rule above:** every change needs a card
on https://trello.com/b/8pYZKWmY (board "DHF Desk"), with labels and a checklist.

## Engagement

- **Client:** DHF Tyres (Hallam, VIC). Owner/developer of the app so far: Dinuka (`dinuka-dhf` on GitHub).
- **Us:** Lahiru (SmoothSailor), brought in to *productionise* DHF Desk.
- **Priority order (agreed 2026-09-15):**
  1. DevOps framework: environments, CI/CD, security scanning, Supabase integration
  2. Bug backlog
- **Scope/arrangement:** not confirmed in writing yet. See the Trello card "Scope the engagement with Dinuka properly".
- **Access we have today:**
  - GitHub: **WRITE** only on `dinuka-dhf/dhf-desk-deploy` (not admin)
  - No confirmed Netlify, Supabase, Google Cloud, Resend or Twilio access
  - Can't sign into the app: staff login is limited to `@dhftyres.com.au` plus `dushentissera@gmail.com`
- **The repo is PUBLIC.** Whether to make it private is an open P0 decision.

> ⚠️ **BLOCKER: the live site is NOT this repo.** Production (https://dhf-desk.netlify.app) runs newer code than GitHub `master` (checked 2026-09-15).
> - app.js is 9,532 lines live vs 8,244 here, and index.html, staff.html, portal.html and manifest.json all differ.
> - Live-only features: hash routing, Chats view, check sheets, job-type item templates, supplier cost requests, delete customer, finish-job-with-checklist, `fetchAllRows` paging.
> - Live source: `/home/dinuka/AI/dhf-desk-deploy` on Dinuka's Linux machine. Not a git repo, no history.
> - Netlify site ID `c72c0d97-fae8-4980-b052-85e55879375d`. Deploys go through `netlify deploy --prod`, but the actual trigger is unknown.
> - **Sync in progress:** PR #2 (https://github.com/dinuka-dhf/dhf-desk-deploy/pull/2) adds the live source plus `tokens.css` and `crm.html`, which the live site also serves.
>   - Verified 2026-09-15: 6 of 7 files are byte-identical to the live site.
>   - `crm.html` differs only in its 2 "Back to Desk" links (live `href='/'`).
> - **Don't deploy anything built from this repo** until PR #2 is merged (Trello: https://trello.com/c/wyAVp8FI).
> - The code map and line numbers below describe the **old GitHub** version. Refresh them after PR #2 merges.
>
> **Also from Dinuka's audit (2026-09-15):**
> - **2026-09-08 outage:** a production deploy containing only `crm.html` wiped the whole site twice. The cause hasn't been traced (https://trello.com/c/3xDKPwIq).
> - A Netlify auth token is hard-coded in `dhf-crm/dhf-crm-handoff/deploy-crm.sh` and needs rotating (https://trello.com/c/HNmU2LmB).
> - Sibling apps on the same Supabase project, none in git: dhf-hub, dhf-crm, dhf-shareholder-meetings, dhf-shareholder-tracker (https://trello.com/c/0y3LC9QR).

## What the app is

A MechanicDesk-style workshop management system: diary/hoist scheduling, jobs, customers and vehicles, quotes/invoices/payments, POS, inventory/suppliers/POs, bills, credit notes, timesheets, service reminders, supplier stock, reports, email/SMS.

- **Stack:** plain HTML + vanilla JS. No framework, no build step, no `package.json`, no tests, no CI.
- **Hosting:** Netlify static site at **https://dhf-desk.netlify.app** (`deploy.sh` runs `netlify deploy --prod`; `_headers` sets the CSP and security headers).
  - Live checks on 2026-09-15: HSTS preload and CSP are set; `/deploy.sh`, `/.claude/`, `/.git/` and `/CLAUDE.md` return 404.
- **Backend:** Supabase project `cztpumgrvhmcvvpqbfqo`, called straight from the browser with the publishable key.
  - **RLS is the only real access control.** Helpers: `is_desk_user()` / `is_desk_admin()`.
- **Shared project:** the same Supabase project also serves other modules. app.js reads the CRM `leads` table and calls the Hub's `validate_hub_token`.

### Three independent pages (no shared JS)

| File | Audience | Auth | Notes |
|---|---|---|---|
| `index.html` + `app.js` | Office staff (desktop) | Google Sign-In → `signInWithIdToken`, then a domain/email allowlist check in JS | The main app, 13 nav tabs |
| `staff.html` | Mechanics (mobile web app via `manifest.json`) | Same Google flow + allowlist | My Jobs (`assigned_employee_id`), day diary, status, clock in/out (`desk_job_time_entries`), checklist, notes |
| `portal.html` | Customers | Supabase email OTP (`shouldCreateUser: true`) | RLS limits rows to jobs matching `desk_customers.email`; replies are forced to customer authorship by `trg_enforce_portal_note_fields` |

### Not in this repo (live elsewhere, must be recovered)

- DB schema, migrations, RLS policies, triggers (`desk_credit_application_guard`), RPCs (`desk_send_email`, `desk_send_sms`, `desk_messaging_status`).
  - The 13 original `migration-*.sql` files are at `/home/dinuka/AI/dhf-desk-docs/` on Dinuka's machine.
  - Don't commit them to this public repo until the visibility decision is made.
- `design-brief.md` (plus `design-brief v3.md` and `design-brief-v5.md`), which the CSS comments cite. Also in `/home/dinuka/AI/dhf-desk-docs/`.
- The **supplier-stock scraper**: Playwright, uses the **service-role key**. Scrapes Tempe Tyres + Newbee Tyre into `desk_supplier_stock`, using sizes from `desk_tracked_tyre_sizes`.
  - Location **unknown**: it's not on Dinuka's Linux machine, despite what the app.js comment says.
- Messaging: Resend (email) and Twilio (SMS) are called from Postgres via pg_net. Booking confirmations and day-before reminders are automated.

## app.js map (8,244 lines)

- **Pattern:** global `let` state per module → `loadX()` queries Supabase → `renderX()` builds template strings into `#main.innerHTML`.
  - Handlers are inline `onclick="fn('id')"`.
  - Modals are appended to `body`; `closeModal()` removes every `.modal-overlay`.
- **Routing:** `switchView()` (~line 95). There's no URL routing, so a refresh lands on the Diary. `activateNavView()` only toggles the nav highlight.

Rough order in the file:
1. Theme toggle, auth, `enterSession`
2. Ctrl+K search (PostgREST `or=` filters, tyre-size normalising)
3. Quick-add menu
4. Customers/vehicles
5. Messages + compose modal
6. POS (invoices flagged `is_pos_sale`; shared "Walk-in Customer" row)
7. Sales projection
8. Inventory: stock (MechanicDesk field parity), suppliers, purchase orders (receiving a PO bumps `qty_on_hand` and logs `desk_stock_adjustments`)
9. `calcInvoiceTotals` (~2074)
10. Invoices tab: payments report, bills, credit notes, item returns
11. Invoice detail (`buildInvoicePanelHtml`: headers with subtotals, drag reorder, tax type)
12. Print/email builders (`buildInvoiceHtml` with 3 templates: aurora/standard/compact)
13. Service schedule
14. Supplier stock
15. Timesheets
16. Reports (26 reports, all computed in the browser)
17. Settings (`desk_settings` key/value)
18. Jobs: list, detail, tags, follow-ups, reviews, soft delete
19. New Job modal (hoist conflict check, multi-stop `desk_job_hoist_legs`)
20. Diary: week grid with multi-day bars, inline booking edit, day context menu, full-day lock, Hoist Day view (drag to reschedule, "now" line)

### Conventions & gotchas

- **Money:** unit prices **include GST**, so GST = total ÷ 11. `calcInvoiceTotals` skips `is_header` rows and applies the percent/fixed discount. Use it for every total.
- `desk_invoices.invoice_no` / `credit_note_no` / `po_no` are DB-generated. Displayed as `INV-`/`QUO-`/`CN-`/`PO-`.
- `buy_price` is stored **incl. GST**. The stock form asks for excl. GST and converts ×1.1.
- `order_no` is **copied** from job to invoice on purpose. Editing the job later must not change a sent invoice.
- `assigned_mechanic` (text) is mirrored from `assigned_employee_id`, because old reports read the text column.
- `desk_settings.value` is text: it can hold an object, a JSON string or a plain string. Always read it through `parseSettingValue`.
- Timestamps come back from Supabase in UTC. Local-date helpers are `isoDateOnly()` and `sameLocalDate()`. **Don't use `toISOString().slice(0,10)` for local dates** (known bug).
- `esc()` doesn't escape quotes (known bug). Don't put user data inside attribute or `onclick` strings until that's fixed.
- **Design tokens:** "Aurora Glass" v4/v5 in `index.html` `:root`, with light and dark themes.
  - Some tokens are read **by name** via `cssVar('--x')` (chart palette, `--text-tertiary`). Check for them before deleting a token.
  - The print/email builders use hard-coded literal colours/fonts on purpose; never add `var(--…)` there.
- Office-only notes must never appear in anything customer-facing (print, email, portal).
- `.claude/skills/invoice-template` is a generic Python skill that isn't used by this app.

## Running locally (today)

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

⚠️ **This talks to the PRODUCTION database.** Every write is real, and it can send real emails/SMS.

Google sign-in only works if `http://localhost:8080` is an authorised origin on the OAuth client. The Maps key may be referrer-restricted. `_headers` (the CSP) only applies on Netlify.

Treat local runs as read-only until the P1 local Supabase stack exists.

## DevOps plan (decided direction, pending Dinuka's sign-off)

**Environments:**
- **Local**: Supabase CLI in Docker + synthetic seed
- **Preview**: Netlify deploy preview per PR, front-end only, pointed at staging
- **Staging/UAT**: one hosted non-prod: its own Supabase project + Netlify deploy of `main`
- **Production**: tagged, approved releases only

No separate hosted dev, and staging and UAT are combined: one developer, and each extra project adds cost and config drift.

**Flow:** feature branch → PR (CI + preview) → merge to `main` (auto-deploy staging: migrations → front-end → smoke) → tag `vX.Y.Z` → required approval → prod (backup check → migrations → deploy → smoke).

**Phases** (each a Trello card with a checklist):
- **P0 access & decisions:** admin access; public vs private repo; map the shared Supabase project
- **P1 foundations:**
  - baseline the prod schema into `supabase/migrations`
  - move config into one `config.js` (Supabase URL/key, Google client ID, Maps key, allowlist, env banner)
  - local dev stack
  - repo hygiene (`main`, rulesets, CODEOWNERS, PR template, Conventional Commits)
  - synthetic seed with no production personal data
- **P2 environments:**
  - staging Supabase project
  - Netlify contexts
  - auth per environment (OAuth origins, OTP SMTP, env-flagged test login)
  - messaging sandbox (non-prod must never message real customers)
- **P3 CI/CD:** PR CI (lint, migrations apply, `db lint`, pgTAP RLS tests, destructive-migration guard); deploy `main` → staging; prod release with approval gate; rollback/hotfix runbook
- **P4 security & quality:**
  - GitHub scanning: secret scanning/push protection, gitleaks, CodeQL, Dependabot, pinned action SHAs, Scorecard
  - Supabase advisor lint + RLS test matrix
  - front-end hardening (pin supabase-js with SRI, headers, ZAP scan, plan to drop `unsafe-inline`)
  - staff allowlist moved server-side
  - Playwright E2E
  - Lighthouse/axe budgets
- **P5 operations:** backups + restore drill; monitoring/alerting (error tracking, uptime, failed messages/cron); scraper moved off the personal machine with a scoped key; secrets inventory/rotation; docs/handover

Rules this plan implies from day one:
- Schema changes only through migrations
- Never copy production data into non-prod
- Every new table ships with RLS and tests
- Migrations follow expand/contract so the previous front-end keeps working

## Known issues (all on Trello, Backlog)

Issues 1–4 and 6–9 were also confirmed present in the **live** code on 2026-09-15.

| # | Issue | Where | Labels |
|---|---|---|---|
| 1 | Multi-day diary bar click calls `openJobFromDiary(event,id)`, which takes one argument, so it's broken | `app.js:7902` | Bug |
| 2 | Multi-day detection compares UTC `slice(0,10)` dates → same-day jobs before ~10am show as multi-day; bars overlap (fixed `top:56px`); jobs that started last week don't show | `app.js:7888`, `7925` | Bug |
| 3 | `toDateInputValue` uses UTC → "today" is yesterday before 10–11am; weeks start Saturday | `app.js:4127` | Bug, Data integrity |
| 4 | Quote→invoice drops `is_header`, `sort_order`, `tax_type`, discount, `order_no` | `app.js:3558` | Bug, Data integrity |
| 5 | Creating a job from the Diary lands on the Jobs list with the Diary tab still highlighted (**already fixed live**, not yet in GitHub) | `app.js:7351` | Bug |
| 6 | Multi-step saves aren't atomic (new job, POS, apply credit, receive PO, returns); stock uses read-modify-write on cached qty | various | Data integrity, Tech debt |
| 7 | Deleting a payment doesn't un-pay the invoice; several totals ignore discount/headers | `app.js:3546`, `2858`, `1028` | Bug, Data integrity |
| 8 | `esc()` doesn't escape quotes but is used in attributes/`onclick` → broken markup/XSS | `app.js:338` (+ portal/staff) | Security |
| 9 | Diary/Jobs/Reports load whole tables (all notes, all invoices); PostgREST caps responses at 1,000 rows (live code now pages with `fetchAllRows`, but still loads everything) | `app.js:6198`, `4749` | Tech debt/Performance |

Also on the board:
- Maps API key restriction check (Security, needs Dinuka)
- RLS policy audit (Security, needs Dinuka)

## Working agreements

- Don't commit or push unless asked. Current branch is `master` (rename to `main` is planned).
- Don't touch production data or settings without an explicit go-ahead and a card.
- Keep this file up to date when decisions change.
