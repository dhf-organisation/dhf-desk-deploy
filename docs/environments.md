# Environments

## Where we are today

| | Front end | Database | Notes |
|---|---|---|---|
| Local (static server) | `python3 -m http.server 8080` | **Production** | Every write is real — the original, still-simplest way to look at the app |
| Local (Supabase stack) | same static server | **Local, throwaway** | See below — real writes, but to a database nobody else can see, seeded with fake data |
| PR preview | Netlify deploy preview | **Production** | Public URL, real data |
| Production | https://dhf-desk.netlify.app | Production | Auto-published from `master` |

There is still no staging, and PR previews still hit the live database — that
part of "there is one environment, and it's production" hasn't changed yet.
**Treat previews as read-only.**

Local development no longer has to be one of those two things, though — see
below.

## Local — a real throwaway database, available now

```bash
node scripts/db-pull-schema.mjs   # pulls today's schema from prod, read-only
node scripts/db-local-up.mjs      # starts Postgres/Auth/PostgREST in Docker, applies it
node scripts/db-seed-synthetic.mjs # adds a handful of obviously-fake rows
```

What this actually is: the Supabase CLI running Postgres (and Auth, and
PostgREST) in Docker on your machine. Nothing here reaches production except
the first command, which only ever runs read-only introspection queries —
`SELECT`s against Postgres's own catalog, nothing that can modify anything.

**Why "pull the schema" instead of committing migrations,** which is the
usual Supabase-CLI-tutorial way to do this: `supabase/migrations/` can't be
committed to this public repo yet — see #6. `db-pull-schema.mjs` reconstructs
real DDL (tables, RLS policies, functions, triggers) from the live catalog via
the Management API, using a personal access token rather than the database
password (which was never recovered), and writes it to
`supabase/.local-schema.sql` — **git-ignored, never committed**. When #6
resolves, promoting that file's contents into `supabase/migrations/` is a
small, deliberate follow-up, not a redo of this work.

Each developer runs the pull themselves, whenever they want current schema —
it's not shared or synced between machines, by design.

**Container runtime:** the CLI needs a working Docker daemon. Docker Desktop
on macOS, or native Docker Engine on Linux — see
[Docker setup](#docker-setup-mac-vs-linux) below. Both speak the same Docker
API, so the rest of the flow is identical either way.

**Seed data** (`db-seed-synthetic.mjs`) is a starting set — a few customers,
vehicles, jobs, and CRM leads — not exhaustive coverage of every table. It
refuses to run against anything but `localhost`/`127.0.0.1`, checked in code,
not by convention. Extend it as more of the app gets exercised locally.

**What this doesn't cover yet:** signing in. Staff auth is Google Identity
Services against a real Google OAuth client, and the portal is a real Supabase
email OTP — neither has a local/fake equivalent configured yet. Today the
local stack is for looking at data and exercising anything that doesn't need
a session. Wiring up local-only test logins is tracked as part of P2 (staging
auth).

### Docker setup: Mac vs Linux

No single app runs on both, so the team standard is "Docker itself, via
whichever official path fits your OS" rather than one specific tool:

- **macOS:** [Docker Desktop](https://docker.com/products/docker-desktop) —
  the officially-documented Supabase CLI target, most-tested path.
- **Linux:** native
  [Docker Engine](https://docs.docker.com/engine/install/) — no Desktop
  wrapper needed; Linux runs containers natively, so this is actually the
  lighter install of the two.

Either way, `docker info` succeeding is the thing that matters — the Supabase
CLI just needs a reachable Docker socket, it doesn't care which runtime is
behind it.

## What we're building towards

Four environments, one non-production database.

### Local

**Mostly here** — see [Local — a real throwaway database, available now](#local--a-real-throwaway-database-available-now)
above. Supabase CLI running Postgres in Docker; schema pulled from production
read-only rather than from committed migrations, until #6 resolves; a small
synthetic seed.

**No production data, ever** — not a subset, not "just the customers", not
anonymised. Real customer records don't leave production. Worth being precise
about what "pulled from production" means here: `db-pull-schema.mjs` pulls
**schema only** — table/column/policy/function *definitions*, the shape of the
database — never a row of actual data. Nothing a real customer typed reaches
a developer's machine through this path.

**Messaging is safe by design, not by luck — checked, not assumed.** Read the
pulled function bodies rather than guessing: `desk_send_email`/`desk_send_sms`
(and the triggers that call them — booking confirmations, day-before
reminders) look up their Resend/Twilio credentials from **Supabase Vault**
(`vault.decrypted_secrets`) at call time, and fail closed with "not
configured" if the lookup comes back empty. The schema pull never brings over
row data — vault entries included — so a fresh local database's vault has
nothing in it, and every messaging call simply has nothing to send with.

`db-local-up.mjs` runs `db-check-messaging-safe.mjs` automatically after
every start: it reads the actual secret names the pulled functions look up
(not a hard-coded list) and checks the local vault for each. Finds one →
**stops there** with the exact `DELETE` to clean it up, rather than handing
back a "ready to use, actually dangerous" stack. There's a documented,
deliberate override (`ALLOW_LOCAL_MESSAGING=1`) for the day someone genuinely
wants to test messaging against a sandbox provider account — it has to be
typed out in full each time, not left as a flag that lingers in a script
someone reuses without reading it.

### Preview — one per pull request

Netlify builds a deploy preview for every PR. Front end only, pointed at
**staging**, so clicking around a preview stops being a production action.

This is the step that makes code review meaningful: right now a reviewer can
either not click the preview, or click it and act on live data.

### Staging / UAT

One hosted non-production environment: its own Supabase project, and a Netlify
deploy of the main branch. It's where a change is exercised before release and
where Dinuka or the DHF team accept it.

Staging and UAT are deliberately the same environment. With one developer,
each additional hosted project is another set of credentials, another schema to
keep in step, and another thing to drift. When two audiences genuinely need
different data at once, we'll split it then.

Staging gets its own Supabase project, its own Google OAuth origins, its own
OTP mail sender, and **sandboxed messaging providers**. That last one isn't
optional: the day-before reminder job will happily send to whatever phone
numbers it finds.

### Production

Released deliberately: a tag, an approval, then deploy. Migrations first, then
the front end, then a smoke test. A backup verified before any migration runs.

## Getting from here to there

Rough order, because each step depends on the one before:

1. ~~**Baseline the production schema** into `supabase/migrations/`.~~
   **Blocked on #6** (public/private decision) — committing real RLS policy
   text and function bodies to a public repo isn't something to do casually.
   Worked around for now: `scripts/db-pull-schema.mjs` reconstructs it into a
   git-ignored local file instead, so local dev didn't have to wait.
2. ✅ **Extract configuration** — done (`config.js` + `scripts/build-config.mjs`).
3. ✅ **Local Supabase stack** with a synthetic seed — done, see above. Signing
   in locally (staff Google auth, portal OTP) is still open.
4. **Staging Supabase project** — schema from migrations, seed data, its own
   auth and sandboxed messaging. Still blocked on #1 above for a *committed*
   baseline, though nothing stops standing up the project itself first.
5. **Point previews at staging.**
6. **Add the release gate** in front of production.

Progress is tracked on the Trello board.

## Rules that apply from day one

These hold regardless of which environments exist yet:

- **Schema changes only through migrations.** Not through the dashboard.
- **Never copy production data into non-production.** Generate synthetic data
  instead.
- **Every new table ships with RLS enabled** and its policies in the same
  migration.
- **Migrations follow expand/contract**, so the currently deployed front end
  keeps working. Migration and deploy are not atomic and never will be.
- **Non-production must never message a real customer.** Check the messaging
  configuration before pointing any new environment at anything.
