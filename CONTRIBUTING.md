# Contributing to DHF Desk

A small team maintains a system a business runs on. These conventions exist so
that a change can be understood later, and undone quickly.

## The one thing to know first

> 🚨 **Merging to `master` deploys to production.** Netlify publishes `master`
> automatically, within a couple of minutes, with no approval step in front of
> it. Never push to `master` directly. Every merge is a release.

## Where work lives

**Trello** ([DHF Desk board](https://trello.com/b/8pYZKWmY)) is for planning:
priority, the backlog, anything not yet concrete. It's the board the client
looks at.

**GitHub issues** are for work that's ready to become a branch — a specific
defect, a specific change. An issue carries the technical detail that doesn't
belong on a Trello card.

**They link both ways.** Put the Trello URL in the issue, and the issue number
on the card. Don't maintain the same description in both places: the card says
what and why for the business, the issue says what and how for the code.

Anything that touches the database, authentication, or the deploy pipeline
needs a Trello card before the branch, not after.

## Branches

Branch from `master`, named `<type>/<short-description>`:

```
feat/supplier-cost-requests
fix/diary-multiday-dates
chore/pin-action-shas
docs/environments
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `ci`, `test`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```
fix(diary): use local dates for multi-day job bars

Comparing UTC `slice(0,10)` dates made same-day jobs booked before
about 10am render as multi-day. Uses sameLocalDate() instead.

Closes #14
```

Explain *why* in the body when it isn't obvious from the diff. The next person
to read it will be one of us, six months from now, with no memory of this.

## Pull requests

Every change goes through one — including your own, including small ones. Fill
in the template honestly: the "how it was checked" section is the part that
matters, and "I didn't check that" is a perfectly good answer.

CI runs on every PR:

| Check | What it catches |
|---|---|
| `node --check` on `app.js` | A syntax error in the main script |
| `scripts/check-inline-scripts.mjs` | A syntax error inside a page's inline `<script>` — most of this app's code |
| `scripts/check-publish-list.mjs` | A new file a page references but `netlify.toml` doesn't publish |
| Netlify build | That `dist/` gets built and contains no source or docs |
| `scripts/check-migrations.mjs` | Badly named migrations, and undeclared destructive SQL |
| CodeQL | Static analysis findings in the JavaScript |
| gitleaks | Credentials in the diff |

Netlify also builds a **deploy preview** for every PR. Open it and click
through the page you changed — CI checks that the code parses, not that the
feature works, and there are no automated tests yet.

Preview URLs are public and unlisted. They're backed by the **production**
database, so anything you do in a preview is real.

## Adding a file

`netlify.toml` publishes an explicit list of files. **A new file that isn't on
that list will 404 in production**, even though it works locally. Add it to
the `cp` line in the same PR; `check-publish-list.mjs` will fail the build if
you forget.

## Changing the database

Schema changes go in `supabase/migrations/` as
`YYYYMMDDHHMMSS_snake_case.sql` — never by hand in the Supabase dashboard,
because a change made in the dashboard exists nowhere anyone can review or
replay.

Use expand/contract: add the new thing, ship the front-end that uses it, then
remove the old thing in a later release. The currently deployed page must keep
working against the new schema, because migration and deploy aren't atomic.

Destructive SQL (`DROP`, `TRUNCATE`, `DELETE FROM`, adding `NOT NULL`) must
declare itself on the first line:

```sql
-- destructive: drops desk_legacy_notes, migrated to desk_job_notes in 20260901120000
```

Every new table ships with RLS enabled and policies in the same migration. A
table without RLS is readable by anyone on the internet who knows its name.

See [docs/database.md](docs/database.md).

## House style

Match the file you're in. These pages have been written over a long time in
one continuous style, and a change that reformats its surroundings is a change
nobody can review. In particular, don't let your editor reformat a whole
page — `.editorconfig` turns off trailing-whitespace trimming on the big files
for exactly this reason.

Some things worth knowing before you write a line (the full list is in
[CLAUDE.md](CLAUDE.md)):

- **Prices include GST.** GST is the total ÷ 11. Always total through
  `calcInvoiceTotals`.
- **Supabase returns UTC.** Use `isoDateOnly()` and `sameLocalDate()`, never
  `toISOString().slice(0,10)`, for anything the user thinks of as a date.
- **`esc()` doesn't escape quotes.** Don't put user data inside an attribute or
  an `onclick` until that's fixed.
- Some CSS custom properties are looked up by name through `cssVar()`, so a
  grep for `var(--x)` won't find every use. Check before deleting a token.
- Office-only notes must never reach anything a customer sees — print, email,
  or the portal.

## Security

Don't commit credentials, and don't report vulnerabilities in a public issue —
[SECURITY.md](SECURITY.md) explains both.
