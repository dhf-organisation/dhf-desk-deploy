# Security

How to report a problem: [SECURITY.md](../SECURITY.md). This document is about
the posture — what protects the app, and where the sharp edges are.

## The threat model in one paragraph

The browser talks straight to Postgres with a key that is published in the page
source. Anyone on the internet can make the same requests the app makes. The
only thing standing between them and the data is **row-level security**. Every
other control here is defence in depth; RLS is the control.

## What is not security

Worth naming explicitly, because each of these looks like a control:

- **The publishable Supabase key.** It's in the page source by design. It
  identifies the project. It authorises nothing on its own.
- **The email/domain allowlist** in `index.html` and `staff.html`. It decides
  whether the UI renders. It's a courtesy to the user, not a boundary — the
  requests underneath it are unaffected.
- **Anything in JavaScript.** Validation, hidden fields, disabled buttons.
  All of it is advice to a cooperating browser.

If a rule must always hold, it lives in an RLS policy, a constraint or a
trigger. See [docs/database.md](database.md).

## Controls in place

### Access control

RLS on every table, with policies calling `is_desk_user()`, `is_desk_admin()`
and `portal_customer_id()` rather than duplicating logic. `SECURITY DEFINER`
helpers pin `search_path`, without which a caller can shadow the tables the
function reads.

### Authentication

Staff sign in with Google Identity Services, exchanged for a Supabase session
via `signInWithIdToken`. Customers use a Supabase email one-time code. Sessions
are Supabase-managed JWTs; PostgREST reads the claims and RLS acts on them.

A page that sends the publishable key as its `Authorization` header rather than
the signed-in user's JWT is, as far as the database is concerned, an anonymous
caller — regardless of who is looking at the screen. Anything gated on
`is_desk_user()` will fail, and anything readable anonymously will succeed.

### Transport and content

`_headers` sets the CSP and the usual security headers; HSTS is set with
preload. The CSP currently permits `unsafe-inline`, because all four pages are
built from inline scripts and inline handlers. Removing it means restructuring
the pages — worth doing, not a small change.

### What gets published

`netlify.toml` copies an explicit list of app files into `dist/`. Everything
else in the repository — `deploy.sh`, internal documentation, `scripts/`,
`.git` — returns 404. Before that list existed, Netlify published the
repository root.

`scripts/smoke.mjs` asserts both halves after every deploy: the app files are
served, the internal ones aren't.

### Supply chain

Third-party libraries load from CDNs as `<script>` tags — there's no package
manager for the app, so Dependabot can't see them. They're pinned by version;
adding subresource integrity hashes is outstanding.

GitHub Actions are pinned to commit SHAs, and Dependabot watches those weekly.
A tag like `@v4` is mutable; a SHA isn't.

### Scanning

| | Runs | Catches |
|---|---|---|
| GitHub secret scanning + push protection | On push | Provider-format secrets, blocked before they land |
| gitleaks | Every PR; full history weekly | Credentials GitHub's patterns miss |
| CodeQL | Every PR, weekly | Injection, unsafe DOM writes, and similar |

CodeQL and secret scanning are free on public repositories. If this repository
becomes private, both need GitHub Advanced Security — worth pricing before
flipping the switch.

### Secrets

Credentials live in the hosting provider's environment settings or a local
config file outside the repository, never in git. This repository is public and
history is permanent.

If a secret is committed: **rotate first**, then clean up. Rotation is what
fixes it. A force-push only tidies the evidence — assume anything pushed to a
public repository has been scraped.

## Known sharp edges

Being worked through; tracked privately rather than listed here in detail:

- **`esc()` doesn't escape quotes**, and is used inside HTML attributes and
  `onclick` strings. Customer-supplied text in an attribute can break out of
  it. Don't put user data in an attribute until this is fixed.
- **`unsafe-inline` in the CSP**, which is what makes the above exploitable
  rather than merely broken.
- **The staff allowlist is client-side** and should be enforced in the
  database.
- **Service-role keys** used by out-of-repo tooling, including the scraper
  being retired, need inventorying and rotating.
- **Subresource integrity** isn't set on CDN scripts.

## If something is exposed

1. **Close the hole.** An RLS policy change takes effect immediately — no
   deploy needed, which makes it the fastest lever available.
2. **Rotate anything that leaked.**
3. **Work out the exposure.** Supabase logs show what was queried. Be honest
   about what you can and can't tell from them.
4. **Tell the client.** If customer personal information was accessible,
   Australian privacy obligations may apply and that's a decision for DHF to
   make with proper information, promptly.
5. **Write down what happened**, including how long it was open.
