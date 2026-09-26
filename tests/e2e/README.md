# E2E tests (Playwright)

Runs against the **local Supabase stack only** — never staging or
production. See `playwright.config.mjs`'s own comment for why that's a hard
rule, not just a default.

## Scope

Only the **unauthenticated** flows are covered so far:

- `index.html` / `staff.html` show their Google sign-in screen correctly
- `portal.html`'s OTP request actually sends an email (verified against the
  local stack's Mailpit mail catcher, not just the UI's optimistic response)
- `crm.html`'s auth gate redirects an unauthenticated visitor to the login
  page, rather than ever loading the main CRM script for them

The actual "critical flows" this card cares about — Diary, Jobs, Invoices,
POS — all require being signed in as staff, and Google Sign-In can't be
automated. That needs an env-flagged test login that's provably unavailable
in production, which doesn't exist yet (Trello: "[DevOps P2] Auth per
environment: Google OAuth origins, portal OTP email, test logins"). Extend
this suite once that lands, rather than working around it here.

## Running locally

```bash
# 1. Bring up the local stack with fake data (see docs/environments.md)
node ../../scripts/db-local-up.mjs
node ../../scripts/db-seed-synthetic.mjs

# 2. Build the app pointed at the local stack (same command Netlify runs,
#    just with DHF_ENV=local instead of a real deploy context) and serve it
eval "$(grep '^  command' ../../netlify.toml | sed 's/^  command = "\(.*\)"$/\1/')" # from the repo root — sets up dist/
# then, still from the repo root, with the local stack's own keys
#   (from `supabase status -o json` — API_URL, ANON_KEY):
# DHF_ENV=local DHF_SUPABASE_URL=<API_URL> DHF_SUPABASE_KEY=<ANON_KEY> \
#   DHF_GOOGLE_CLIENT_ID=placeholder node scripts/build-config.mjs
npx --prefix . serve ../../dist -l 8080   # or: python3 -m http.server 8080 --directory ../../dist

# 3. Run the tests
npm test
```

CI does all of this automatically — see `.github/workflows/e2e.yml`.

## Why a `package.json` here and not at the repo root

The app itself still has no build step and no dependencies — that's
unchanged. Playwright needs to be an actual installed package, so it lives
in this subdirectory specifically so Netlify's build never auto-detects it
and tries to `npm install` it as part of deploying the site (see this
directory's `package.json` description, and `netlify.toml`'s own comment).
`node_modules` here is gitignored, same as anywhere else.
