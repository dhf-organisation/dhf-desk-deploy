# Secrets inventory, ownership & rotation

No values in this file — locations, owners and dates only. If a credential
described here is ever pasted into a commit, an issue, or a chat message
where it doesn't belong, rotate it, don't just delete the paste; git history
and most chat tools keep it regardless.

## Inventory

| Credential | What it grants | Environment | Owner | Stored | Last rotated |
|---|---|---|---|---|---|
| Supabase Management API PAT (`SUPABASE_ACCESS_TOKEN`) | Full Management API access to every project in the DHF Supabase org — arbitrary SQL as `postgres` on `DHF CRM` (production), schema pull/push, project admin actions the token holder's org role allows | Production (org-wide reach) | Lahiru (Developer role in the DHF org — confirmed 2026-09-23; can't create new projects, can do everything else used this engagement) | `~/.config/dhf-desk/env` on Lahiru's machine, `chmod 600` | Issued during onboarding (2026-09-16); not rotated since |
| Supabase DB password (`SUPABASE_DB_PASSWORD` var) | Direct Postgres connection, if valid | Production (unclear) | Unclear | `~/.config/dhf-desk/env` | **Open question, not a rotation gap**: `CLAUDE.md` states production's actual DB password "was never recovered." This var exists in the env file regardless — needs checking with Dinuka whether it's stale, wrong, or valid and just never documented, before it's trusted or removed |
| Netlify Personal Access Token (`NETLIFY_AUTH_TOKEN`) | Deploy and manage the `dhf-desk` Netlify site (and anything else the token's account can reach) | Production | Lahiru | `~/.config/dhf-desk/env`, **and** a GitHub Actions repo secret (added 2026-09-23 for the auto-rollback workflow — see "GitHub Actions secrets" below) | Issued 2026-09-16; not rotated since |
| Netlify Site ID | Not a secret (a public-ish identifier) — listed for completeness since it travels with the token | — | — | `~/.config/dhf-desk/env`, GitHub Actions repo secret, and openly documented in `CLAUDE.md` | n/a |
| Supabase publishable (anon) key | Nothing on its own — RLS is what protects data. Intentionally public: committed in `config.js` | Production | — | Committed to the repo, by design | n/a — rotating it is a routine key-roll, not an incident response |
| Supabase **service-role** key | Bypasses RLS entirely — full read/write on every table | Production | **Unknown** — used by the supplier-stock scraper | **Unknown.** The scraper is being decommissioned (Dinuka's call, 2026-09-15) specifically because neither its location nor this key's exposure is known. Tracked on its own card, not duplicated here: https://trello.com/c/jLAkeIhI | Unknown — this is the single highest-risk open item in this inventory |
| Google OAuth Client ID (`992833623399-...`) | Not secret itself (client IDs are public in OAuth flows) — the Google Cloud *project* behind it is what matters | Production | Dinuka (assumed — no Google Cloud console access granted yet) | Committed in `config.js` | n/a |
| Google Maps API key | Currently **unrestricted** — separate known issue, not duplicated here: https://trello.com/c/3gWYDUdZ | Production | Dinuka (Google Cloud access needed) | Committed in `config.js` (exposed) | Unknown |
| Resend API key | Sends real email as DHF Tyres | Production | Dinuka (no Resend account access granted) | Supabase Vault (`vault.decrypted_secrets`) | Unknown |
| Twilio Account SID / Auth Token / From Number | Sends real SMS as DHF Tyres, can place calls | Production | Dinuka (no Twilio account access granted) | Supabase Vault | Unknown |
| Netlify token hard-coded in `dhf-crm/dhf-crm-handoff/deploy-crm.sh` | Deploy access to whatever Netlify site that script targets | Unclear (separate repo/location, not this one) | Dinuka | Committed in that script (exposed) | Flagged 2026-09-15, not yet rotated — tracked separately: https://trello.com/c/HNmU2LmB |
| Supplier portal logins (Tempe Tyres, Newbee Tyre) | Whatever the scraper's login sessions grant | Production-adjacent | Unknown | Unknown — tied to the same scraper whose location is unknown | Unknown |
| GitHub org Owner access | Full admin on `dhf-organisation` and every repo in it | — | Lahiru, Dinuka (both confirmed `admin` on this repo) | GitHub's own auth (2FA on each personal account) | n/a — this is access, not a credential to rotate |

## GitHub Actions secrets

Current state (checked 2026-09-23): two repository-level secrets exist —
`NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID`, both added the same day for the
auto-rollback workflow (`.github/workflows/post-deploy-smoke.yml`). No
Environment-scoped secrets exist on either `staging` or `production` yet.

**Deliberate exception, not an oversight:** these two stay at the repository
level rather than scoped to the `production` GitHub Environment. Checked
before deciding — `production` already has `required_reviewers` protection
(Lahiru and Dinuka must approve). Scoping the rollback's secrets to that
Environment would mean every push to `master` pauses waiting for a manual
approval *before the smoke test can even run*, which defeats the entire
point of an unattended safety net — the auto-rollback exists so a broken
deploy gets caught and reverted without anyone needing to notice first.

The general rule going forward:
- A secret used by an **unattended, automatic** workflow (the smoke
  test/rollback today; anything similar later) stays at the repository
  level, documented here with the reasoning.
- A secret used by a **human-gated** deploy or release workflow (the real
  tag → approval → production pipeline described in
  `docs/release-and-rollback.md`, once it exists) belongs in the
  `production` Environment, so the existing reviewer gate actually protects
  it.

## Rotation schedule (proposed — needs Dinuka's sign-off)

No credential above has a record of ever being rotated except at initial
issue. Proposed cadence, to be agreed rather than assumed:

- **Every 6 months**, routine: Supabase Management API PAT, Netlify PAT.
- **Immediately on any personnel change** (someone leaving the engagement,
  losing a laptop, etc.): everything that person had access to.
- **Immediately if ever pasted somewhere it shouldn't be** — a commit, a
  public issue, a screenshot — regardless of the regular schedule.
- **The service-role key and the `deploy-crm.sh` token are overdue now**,
  independent of any schedule — both are pre-existing findings, not new
  ones, tracked on their own cards.

## Offboarding checklist (proposed — needs Dinuka's sign-off)

When anyone with access to this engagement's credentials leaves or is no
longer working on it:

1. Revoke their GitHub org membership (removes repo access immediately).
2. Rotate the Supabase Management API PAT and Netlify PAT if they had a copy
   of `~/.config/dhf-desk/env` or equivalent — assume they did unless known
   otherwise.
3. Remove them from the Supabase org and Netlify team directly (org/repo
   removal alone doesn't revoke a personal access token they generated
   themselves under their own account).
4. Update this file's "Owner" column for anything they owned.

## Still open, needs Dinuka

- Whether `SUPABASE_DB_PASSWORD` in the env file is valid, stale, or simply
  wrong — clarify before relying on it or deleting it.
- Locating the supplier-stock scraper, decommissioning it, and rotating the
  service-role key it uses (tracked: https://trello.com/c/jLAkeIhI).
- Rotating the Netlify token hard-coded in `deploy-crm.sh` (tracked:
  https://trello.com/c/HNmU2LmB).
- Restricting the Google Maps API key (tracked separately).
- Agreeing the rotation schedule and offboarding checklist above — drafted,
  not yet confirmed.
