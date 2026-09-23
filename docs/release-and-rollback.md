# Releasing and rolling back

## How a change reaches production today

```
branch → PR → CI + deploy preview → review → merge to master
                                                    ↓
                                    Netlify builds and publishes (~1–2 min)
                                                    ↓
                                       https://dhf-desk.netlify.app
```

**Merging is releasing.** There's no approval gate between `master` and the
live site, so the pull request is the last point at which anyone looks.

The build is defined in `netlify.toml`:

```toml
[build]
  publish = "dist"
  command = "rm -rf dist && mkdir dist && cp index.html app.js ... dist/"
```

An explicit copy list, not "publish the repo". This is deliberate — before it
existed, Netlify served the repository root, including `deploy.sh` and every
internal document. **A file not on that list 404s in production**, which is the
most common way a change appears to work locally and fails live.
`scripts/check-publish-list.mjs` fails CI when a page references a file that
isn't published.

## Marking a release (optional, audit trail only)

Pushing a `vX.Y.Z` tag creates a GitHub Release with notes generated from the
merged PRs since the last tag (`.github/workflows/release.yml`):

```bash
git tag v0.1.0
git push origin v0.1.0
```

**This does not gate or change the deploy.** By the time you tag a commit, if
it's on `master`, Netlify has already published it — merging is still what
releases. Tagging just gives a clean "what was actually live, and when" record
instead of reconstructing it from `git log`. Picking the version number is a
manual call; there's no auto-bump tooling. The *real* tag → approval →
production gate described below is separate, later work for once staging
exists — this doesn't bring that forward.

## Before you merge

- The deploy preview opens and the page you changed actually works
- Browser console is clean on that page
- If you added a file, it's in the `netlify.toml` copy list
- If there's a migration, you know who applies it and when
- It isn't late Friday afternoon, and someone is around to notice if it breaks

## After you merge

Watch it. Roughly two minutes:

```bash
# Did it publish, and from which commit?
netlify api listSiteDeploys --data '{"site_id":"c72c0d97-fae8-4980-b052-85e55879375d"}' \
  | head -40

# Does production still serve everything it should?
node scripts/smoke.mjs https://dhf-desk.netlify.app
```

The smoke test runs automatically after every push to `master`
(`.github/workflows/post-deploy-smoke.yml`). It checks that each app file is
served, that internal files are *not*, that the security headers are present,
and that scripts load in the right order. It's read-only — it never writes to
the database.

## Rolling back

**Rolling back the front end is fast and safe. Rolling back a migration is
neither.** If a release included both, deal with them separately.

### Front end — Netlify, in seconds

Netlify keeps every deploy. The fastest rollback is to publish the previous
one from the Netlify UI: **Deploys → pick the last good one → Publish deploy**.
No build, no git, live immediately.

Do this first when production is broken. Fix the repository afterwards.

⚠️ One catch: the site auto-publishes `master`, so the *next* push to `master`
replaces your rolled-back deploy. Follow up with a revert in git, or you'll
ship the broken version again with the next unrelated change.

### Front end — git

```bash
git revert <merge-commit-sha> -m 1
git push origin master   # deploys the revert
```

Slower (it waits for a build) but leaves the repository consistent. Use it
when the site is degraded rather than down.

### Database

There is no automatic rollback. Options, in the order you'd want them:

1. **Roll forward.** Write a new migration that fixes the problem. Almost
   always the right answer, and the only one that doesn't risk data written
   since.
2. **Restore from backup.** The Supabase project is on a plan with daily
   backups. A restore loses everything written since the backup, so for a
   workshop mid-day that's a day of invoices — a genuine last resort, and a
   decision for the business, not for whoever is at the keyboard.

Point-in-time recovery is not currently enabled. Enabling it would shrink that
window from a day to minutes; it's tracked on the board.

This asymmetry is why migrations use expand/contract and why destructive SQL
has to declare itself: an added column is trivially reversible, a dropped one
isn't reversible at all.

## If production is down

1. **Roll back the front end in Netlify.** Don't diagnose first.
2. Confirm with `node scripts/smoke.mjs https://dhf-desk.netlify.app`.
3. Tell whoever is at the counter — they're working around it right now.
4. *Then* work out what happened, and write it down.

Worth knowing: there has been a second deploy path into this site — direct
CLI deploys from a developer machine that isn't a git checkout. Two deploy
paths into one site can overwrite each other, and a partial CLI deploy has
taken the whole site down before. If the live site doesn't match `master` and
nobody merged anything, that's the first thing to suspect.

## Releasing, once staging exists

The target flow, for when the environments in
[docs/environments.md](environments.md) are in place:

```
merge to main → auto-deploy staging (migrations → front end → smoke)
              → tag vX.Y.Z
              → approval
              → production (verify backup → migrations → deploy → smoke)
```
