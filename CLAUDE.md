# DHF Desk — project context

@.claude/rules/trello-workflow.md
@.claude/rules/github-workflow.md

**Before doing any work, follow the rules above:** every change needs a card on
https://trello.com/b/8pYZKWmY (board "DHF Desk") with labels and a checklist, and
reaches `master` through a branch and a PR — never a direct push.

Contributor-facing documentation lives in [README.md](README.md),
[CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [docs/](docs/)
(architecture, environments, release/rollback, database, security). This file is
the working context that doesn't belong in public docs: current state, open
decisions, and the gotchas worth knowing before touching the code.

## Engagement

- **Client:** DHF Tyres (Hallam, VIC). Owner/developer of the app so far: Dinuka (`dinuka-dhf` on GitHub).
- **Repo:** `dhf-organisation/dhf-desk-deploy` (moved out of Dinuka's personal account on 2026-09-16; old links redirect).
- **Us:** Lahiru (SmoothSailor), brought in to *productionise* DHF Desk.
- **Priority order (agreed 2026-09-15):**
  1. DevOps framework: environments, CI/CD, security scanning, Supabase integration
  2. Bug backlog
- **Scope/arrangement:** not confirmed in writing yet. See the Trello card "Scope the engagement with Dinuka properly".
- **❓ Open question — is the site actually live?** Lahiru's position (2026-09-21) is that it "isn't necessarily live", which is why SDLC controls are kept loose for now. But `master` auto-publishes to the public URL, the database holds real customer records and invoices, and the 2026-09-08 incident was handled as a production outage affecting the workshop. **Confirm with Dinuka.** The answer changes how cautious to be about the RLS work, about merging, and about when issue #7's bypasses come off.
- **Access we have today:**
  - GitHub: **org Owner** on `dhf-organisation` (confirmed 2026-09-21) — rulesets, environments and security settings are available.
  - Netlify + Supabase: access granted 2026-09-16 (Netlify team `dinuka`, Supabase org `fhyhrpvrmpmnzbrypows`). Supabase PAT and Netlify token are on this machine in `~/.config/dhf-desk/env` (chmod 600, **never** in the repo).
  - Google Cloud, Resend and Twilio: no access yet
  - Can't sign into the app: staff login is limited to `@dhftyres.com.au` plus `dushentissera@gmail.com`
- **The repo is PUBLIC.** Whether to make it private is an open P0 decision, and it **blocks committing the schema baseline**. Note CodeQL and secret scanning are free on public repos and need GitHub Advanced Security if it goes private.

> ⚠️ **The Supabase PAT in `~/.config/dhf-desk/env` runs SQL as the `postgres` superuser on production.** Read-only queries unless the user explicitly approves a write. Endpoint: `POST /v1/projects/{ref}/database/query` (no DB password needed).

> 🚨 **Merging or pushing to `master` DEPLOYS TO PRODUCTION.** Netlify site "dhf-desk" (ID `c72c0d97-fae8-4980-b052-85e55879375d`) auto-publishes `master`. Confirmed 2026-09-15 when merging PR #2 deployed within about a minute.
> - Never push to `master` directly. Two rulesets exist (2026-09-21), but **they will not stop you**:
>   - `master: no force-push or deletion` — no bypass, applies to everyone.
>   - `master: PR + CI (admins bypass until go-live)` — requires a PR (0 approvals) and the four CI checks, but **Lahiru and Dinuka bypass it as org Owners**. Deliberate: low friction while iterating, per Lahiru 2026-09-21.
>   - ⚠️ So a direct push to `master` will *succeed* and *deploy to production*. The rule against it is a working agreement, not an enforced control. Ask first, every time.
>   - Removing the bypasses is tracked as GitHub issue #7, labelled `pre-go-live`.
> - ✅ **Publishing is now limited to app files** (`netlify.toml`, PR #3, 2026-09-21). `netlify.toml` builds `dist/` from an explicit `cp` list. Verified on prod: `/deploy.sh`, `/CLAUDE.md`, `/netlify.toml`, `/scripts/*` all 404.
>   - **A new file not added to that `cp` list will 404 in production** while working locally. `scripts/check-publish-list.mjs` fails CI when a page references an unpublished file.
> - PR deploy previews are public, and are backed by the **production** database.
> - **Netlify was repointed to `dhf-organisation/dhf-desk-deploy` on 2026-09-21** (it had still been linked to Dinuka's personal repo, so pushes here weren't deploying). Verified: published deploy now comes from a git commit, not a CLI upload.
> - There is a second production deploy path: Dinuka's CLI/agent deploys from `/home/dinuka/AI/dhf-desk-deploy` (not a git repo). The two can overwrite each other — suspect this first if live ≠ `master` with no merge.
>
> ✅ **Repo = live site (as of 2026-09-15).**
> - PR #2 (merge `67e47d6`) synced GitHub with production, adding `tokens.css` and `crm.html`.
> - All 7 app files are byte-identical to https://dhf-desk.netlify.app.
> - The pre-sync GitHub state is tagged `pre-live-sync-2026-09-15`.
> - ⚠️ The **code map and line numbers below still describe the OLD pre-sync app.js** (8,244 lines; it's now 9,532, with hash routing, Chats, check sheets, job-type items, supplier cost requests, delete customer). Refresh them before relying on them.
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
  - 🛑 **Being retired (Dinuka, 2026-09-15): "remove the scraper from DHF Desk".** Don't invest in it.
    - Still to do: find and stop it, rotate the service-role key, and stop the app showing stale supplier data (https://trello.com/c/jLAkeIhI).
    - Affected in-app: the **Supplier Stock** tab, supplier results in Ctrl+K search, and Settings → Tracked Tyre Sizes.
    - A replacement for cost/availability lookups is being decided separately (https://trello.com/c/nv7E9oDG).
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

## Running locally

**Against production (read-only, quickest):**

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

⚠️ **This talks to the PRODUCTION database.** Every write is real, and it can send real emails/SMS. Treat as read-only.

**Against a local Supabase stack (2026-09-22, mostly working):**

```bash
node scripts/db-pull-schema.mjs      # pulls schema from prod, read-only, into a git-ignored local file
node scripts/db-local-up.mjs         # supabase start + applies the pulled schema
node scripts/db-seed-synthetic.mjs   # a handful of fake customers/vehicles/jobs/leads
```

- Needs a Docker daemon. **No single app covers both of us** — Dinuka's on Linux, I'm on Mac — so the team standard is Docker Desktop (Mac) / native Docker Engine (Linux), written up in docs/environments.md.
- `db-pull-schema.mjs` pulls **schema only** (tables/columns/RLS/functions), never row data, via the Management API (PAT, no DB password needed — same access pattern as everywhere else in this doc). Output is `supabase/.local-schema.sql`, **git-ignored**, regenerate any time. This is the workaround for #6 still being open: migrations can't be committed yet, so nothing here is committed either.
- `check-inline-scripts.mjs` etc. don't need this — it's for exercising the app with a real (throwaway) database instead of eyeballing static HTML.
- **Not yet wired up:** signing in. Staff Google auth and portal OTP have no local equivalent configured — this gets you a database to poke at, not a fully logged-in session, yet.
- Messaging is safe by design: `desk_send_email`/`desk_send_sms` pull credentials from Supabase Vault at call time and fail closed if empty. Schema pulls never bring over row data (vault included), so a fresh local vault has nothing in it. `db-local-up.mjs` also runs `db-check-messaging-safe.mjs` automatically, which checks the local vault for the actual secret names the pulled functions use and **stops the stack cold** if it finds any — deliberate override only, `ALLOW_LOCAL_MESSAGING=1`.

Google sign-in only works if `http://localhost:8080` is an authorised origin on the OAuth client. The Maps key may be referrer-restricted. `_headers` (the CSP) only applies on Netlify.

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
- **P5 operations:** backups + restore drill; monitoring/alerting (error tracking, uptime, failed messages/cron); scraper decommissioned (Dinuka's call) and its key rotated; secrets inventory/rotation; docs/handover

Rules this plan implies from day one:
- Schema changes only through migrations
- Never copy production data into non-prod
- Every new table ships with RLS and tests
- Migrations follow expand/contract so the previous front-end keeps working

## CI and repo tooling (added 2026-09-21)

| Workflow | Trigger | Does |
|---|---|---|
| `.github/workflows/ci.yml` | PR, push to master | `node --check app.js`, inline-script syntax check, publish-allowlist check, Netlify build produces a clean `dist/`; migration naming/safety |
| `.github/workflows/codeql.yml` | PR, push, weekly | JavaScript static analysis |
| `.github/workflows/secrets-scan.yml` | PR, push, weekly | gitleaks (full history on the schedule) |
| `.github/workflows/post-deploy-smoke.yml` | push to master | Waits ~90s, then `scripts/smoke.mjs` against prod |

Scripts (all plain Node, no dependencies, runnable locally):
- `scripts/check-publish-list.mjs` — page references vs the `netlify.toml` `cp` list
- `scripts/check-inline-scripts.mjs` — syntax-checks every inline `<script>`; **this is where most of the app's code lives**, so `node --check app.js` alone proves little
- `scripts/check-migrations.mjs` — filename format; destructive SQL must declare `-- destructive: <reason>` on line 1
- `scripts/smoke.mjs <base-url>` — read-only: app files served, internal files 404, security headers present, script order correct

Actions are SHA-pinned; Dependabot watches them weekly.

## Open security work

Tracked on Trello, **not described here** — this repo is public and some of it
is still live. The one constraint that shapes the work:

> `crm.html` authorises every REST call with the **publishable key**, not the
> signed-in user's JWT, so as far as Postgres is concerned it's an anonymous
> caller. RLS on the CRM tables therefore **cannot be tightened until
> `crm.html` sends the user's token** — doing one without the other either
> breaks the CRM or leaves the data open. Branch: `fix/crm-anon-lockdown`.
> `is_desk_user()` covers every current CRM user, so it's the right gate.

Before changing those policies, confirm with Dinuka which external systems
write to those tables — an INSERT policy tightened blindly will silently break
whatever was feeding them.

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

- Don't commit or push unless asked. **Never push or merge to `master` without explicit approval: it deploys to production.** Rename to `main` is planned.
- Don't touch production data or settings without an explicit go-ahead and a card.
- **Never copy production data into non-prod**, and never let a non-prod environment reach the production messaging config — Resend/Twilio fire from Postgres triggers, so it would text real customers.
- **Credentials live only in `~/.config/dhf-desk/env`.** Never in the repo, never in a branch.
- **Report what was actually done.** If a check was skipped, say so; if something failed, paste the output. Several claims in this engagement were wrong and had to be corrected publicly (a PR called "safe to merge" that would have published internal docs; a Netlify Pretty-URLs rewrite mistaken for a rogue deploy; advice to upgrade Supabase for backups when the org was already on Pro). Verify before asserting.
- Keep this file up to date when decisions change.
