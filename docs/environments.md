# Environments

## Where we are today

Honestly: **there is one environment, and it's production.**

| | Front end | Database | Notes |
|---|---|---|---|
| Local | `python3 -m http.server 8080` | **Production** | Every write is real |
| PR preview | Netlify deploy preview | **Production** | Public URL, real data |
| Production | https://dhf-desk.netlify.app | Production | Auto-published from `master` |

A local run and a pull request preview both talk to the live database. There
is no staging. There is no seed data. The app can send real email and SMS from
any of them, because the messaging automation lives in Postgres triggers rather
than in the page.

So, until that changes: **treat local and preview as read-only**. Look at
things; don't create test jobs, don't send messages, don't delete anything.

## What we're building towards

Four environments, one non-production database.

### Local

Supabase CLI running Postgres in Docker, with migrations applied from
`supabase/migrations/` and a synthetic seed. No production data, ever — not a
subset, not "just the customers", not anonymised. Real customer records don't
leave production.

Messaging providers stubbed, so a stray trigger can't text anyone.

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

1. **Baseline the production schema** into `supabase/migrations/`. Nothing
   else is possible while the schema exists only inside the live database.
2. **Extract configuration** — Supabase URL and key, Google client ID, Maps
   key, allowlist — into one `config.js` generated per environment. Currently
   these are hard-coded across four pages, so "point at staging" means editing
   four files.
3. **Local Supabase stack** with a synthetic seed.
4. **Staging Supabase project** — schema from migrations, seed data, its own
   auth and sandboxed messaging.
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
