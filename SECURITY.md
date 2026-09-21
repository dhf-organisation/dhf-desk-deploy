# Security policy

DHF Desk holds real customer records, vehicles, invoices and payment history
for a working tyre shop. We take reports seriously and we'd rather hear about
a problem awkwardly than not at all.

## Reporting a vulnerability

**Please don't open a public issue.** Use one of these instead:

1. [Report a vulnerability privately on GitHub](https://github.com/dhf-organisation/dhf-desk-deploy/security/advisories/new)
   (preferred — it's a private thread with the maintainers), or
2. email **dinuka@dhftyres.com.au**.

Tell us what you found, how you found it, and what an attacker could do with
it. A short proof of concept helps enormously.

**What to expect:** we'll acknowledge within 3 business days and tell you what
we think the impact is. Anything that exposes customer data we treat as drop-
everything urgent. We'll let you know when it's fixed.

**Please don't**, while testing: modify or delete data that isn't yours, run
automated scanners against production, access more customer records than you
need to demonstrate the issue, or make the app send emails or text messages to
real customers. If you reach real personal data, stop and tell us.

We don't run a paid bug bounty. We will happily credit you in the advisory.

## What's in scope

- https://dhf-desk.netlify.app and the pages it serves
- This repository
- The Supabase project behind the app (row-level security, database functions,
  auth configuration)

Out of scope: denial of service, findings from third-party services we don't
control, and reports that are purely "this header is missing" with no
demonstrated impact.

## How the app is protected

Because the browser talks to Postgres directly, **row-level security is the
access control**. There's no application server to enforce rules in — if a
policy is wrong, the data is exposed. That makes RLS the single most important
thing to get right, and the thing worth attacking first.

Alongside it:

- A Content-Security-Policy and the usual security headers, set in `_headers`
- HTTP Strict Transport Security with preload
- An explicit publish allowlist in `netlify.toml`, so only app files are
  served — source, scripts and docs return 404
- GitHub secret scanning with push protection, plus gitleaks over pull
  requests and, weekly, the full history
- CodeQL static analysis on every pull request
- GitHub Actions pinned to commit SHAs, with Dependabot watching them

Known gaps we're actively working through are tracked privately. If you'd like
to know whether something you've spotted is already on the list, ask via one of
the channels above.

## Handling secrets

Never commit credentials. Supabase service-role keys, Netlify tokens, Google
OAuth secrets and messaging provider keys belong in the hosting provider's
environment settings, not in the repository — not even briefly, not even in a
branch, because history is forever and this repository is public.

The Supabase *publishable* key is meant to be in the page and is safe there,
**provided RLS is correct**. It is not a secret, and it is not a control.

If a secret does get committed: rotate it first, then remove it. Rotation is
what actually fixes the problem; a force-push only tidies up.
