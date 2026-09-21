# DHF Desk

Workshop management for [DHF Tyres](https://dhftyres.com.au) (Hallam, VIC) —
diary and hoist scheduling, jobs, customers and vehicles, quotes, invoices,
payments, POS, inventory and purchase orders, timesheets, service reminders and
reporting.

**Production:** https://dhf-desk.netlify.app

## The shape of it in one minute

Plain HTML and vanilla JavaScript. No framework, no bundler, no
`package.json` for the app itself. The browser talks straight to
[Supabase](https://supabase.com) over PostgREST using the publishable key, so
**Postgres row-level security is the access control** — there is no server of
ours in between.

Three independent pages that share no JavaScript:

| Page | Who uses it | How they sign in |
|---|---|---|
| `index.html` + `app.js` | Office staff, desktop | Google Sign-In, then an email/domain allowlist |
| `staff.html` | Mechanics, on their phones (installable via `manifest.json`) | Same Google flow |
| `portal.html` | Customers | Supabase email one-time code |

`crm.html` is a fourth page serving the sales pipeline.

More detail: [docs/architecture.md](docs/architecture.md).

## Running it locally

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

> ⚠️ **A local run talks to the production database.** There is no local
> Supabase stack yet, so every write is real and the app can send real emails
> and text messages to real customers. Treat local runs as read-only until
> that changes.

Google sign-in works locally only if `http://localhost:8080` is an authorised
origin on the OAuth client, and the `_headers` CSP applies on Netlify only.

## Deploying

Merging to `master` publishes to production within a couple of minutes. There
is no staging gate in front of it yet. `netlify.toml` builds a `dist/`
directory containing an explicit list of app files — nothing else in the repo
is published.

Read [docs/release-and-rollback.md](docs/release-and-rollback.md) before your
first merge, and [docs/environments.md](docs/environments.md) for where we're
taking this.

## Contributing

Work is planned on Trello and executed through GitHub issues and pull
requests — see [CONTRIBUTING.md](CONTRIBUTING.md). Every PR runs syntax checks
on the pages, a publish-list check, CodeQL and a secret scan.

Found a security problem? Please don't open a public issue —
see [SECURITY.md](SECURITY.md).

## Documentation

| Document | What's in it |
|---|---|
| [docs/architecture.md](docs/architecture.md) | How the pages, the database and the integrations fit together |
| [docs/environments.md](docs/environments.md) | Local, preview, staging/UAT and production — what exists today and what's planned |
| [docs/release-and-rollback.md](docs/release-and-rollback.md) | How a change reaches production, and how to get it back off |
| [docs/database.md](docs/database.md) | Schema conventions, RLS, and the migration workflow |
| [docs/security.md](docs/security.md) | What protects the app, and what we're still hardening |
| [CLAUDE.md](CLAUDE.md) | Working context for AI assistants — conventions, gotchas, current state |
