# Rule: branches, issues and pull requests

Repo: `dhf-organisation/dhf-desk-deploy`. Pairs with
@.claude/rules/trello-workflow.md — Trello is planning, GitHub is execution.

## Non-negotiables

1. **Never push or merge to `master` without explicit approval.** It deploys to
   production within a couple of minutes, with no gate. Say so before asking.
2. **Never commit or push unless asked.** Write the change, say what's staged,
   wait.
3. **Every change goes through a branch and a PR**, including one-line fixes.
4. **Never commit credentials.** Not in a branch, not temporarily. The repo is
   public and history is permanent. If one is committed: rotate first, then
   clean up.
5. **Don't commit the database schema, migrations or RLS policies** until the
   public/private repo decision is made.

## Trello ↔ GitHub

| | Trello | GitHub issue |
|---|---|---|
| Purpose | Planning, priority, the client's view | Work ready to become a branch |
| Content | Objective, business context, definition of done | Technical detail, repro, file:line, approach |

Every card that becomes code gets an issue; every issue links back to its card.
Don't maintain the same prose in both — link them and let each do its job.

Not everything needs both. A card can sit in Backlog for months without an
issue. An issue without a card means the work was never agreed — go make the
card.

## Branches and commits

`<type>/<short-description>` from `master` — `feat`, `fix`, `chore`, `docs`,
`refactor`, `ci`, `test`.

Conventional Commits, with the *why* in the body when the diff doesn't show it.
Close the issue from the commit or the PR (`Closes #14`).

## Pull requests

Use the template and fill it in honestly. "Not checked" is a valid answer and
far better than a ticked box that wasn't.

**Claim only what was actually verified.** Don't write "tested in the preview"
for a preview nobody opened, and don't call a PR safe to merge without
checking what merging it publishes. That mistake has already been made once on
this repo — the first PR was described as safe while Netlify was still
publishing the repository root.

When a PR is up: move the Trello card to **Review**, comment the PR link on the
card, and put the card URL in the PR description.

## Before saying a change is ready

- CI passes — and if a check is red, read it rather than re-running it
- The deploy preview was opened and the changed page clicked through
- A new file is in the `netlify.toml` publish list
- A migration declares itself if it's destructive, and the PR says who applies
  it and when

## After merging to master

Watch the deploy. `node scripts/smoke.mjs https://dhf-desk.netlify.app` — the
post-deploy workflow runs it too. If production breaks, roll back in Netlify
first and diagnose afterwards
([docs/release-and-rollback.md](../../docs/release-and-rollback.md)).

## Reporting

Report what happened, not what was intended. If a check was skipped, say it was
skipped. If something failed, paste the output. A correction costs a sentence
now and a lot more later.
