# Rule: log it in Trello before working on it

Board: https://trello.com/b/8pYZKWmY (board "DHF Desk")
(board ARI `ari:cloud:trello::board/workspace/6a75c9efe9ba03d1f7b3f32a/6aa881ce953330f020ff5ab7`)

## Non-negotiables

1. **No work without a card.** Before changing code, config, the database or any
   platform setting, the work must exist as a Trello card. If it doesn't, create
   the card first, then start.
2. **Log findings, don't silently fix them.** Anything new discovered mid-task
   (bug, security issue, tech debt, question for DHF) gets its own card
   immediately. Don't fold it into the current change unless the user says so.
3. **Only pick up work the user has chosen.** Cards sit in Backlog until the user
   moves them or asks for them by name.
4. **Every card gets labels and a checklist.** No exceptions, including small bugs.

## Card format

- **Name**: a prefix, then a plain-English summary.
  - `[DevOps P0]`…`[DevOps P5]` for the DevOps framework (see the PLAN card)
  - `Bug:`, `Security:`, `Data integrity:`, `Performance:` for findings
- **Description** in three parts:
  - **Objective**: one sentence on the outcome
  - **Context**: why it matters, with `file:line` references and a repro where relevant
  - **Definition of done**: how we'll know it's finished
- **Checklist** named `Tasks` (or `Decisions` for decision cards). Concrete,
  tickable steps; bugs end with *verify on staging → release → verify in prod*.
- **Position**: keep Backlog ordered: engagement/P0 → P1 → P2 → P3 → P4 → P5 → bugs.

## Labels (colour → meaning)

| Colour | Name | Use for |
|---|---|---|
| Red | Bug | Something behaves wrongly for users |
| Orange | Security | Access control, secrets, XSS, exposure, scanning |
| Yellow | Data integrity | Money, stock or records can end up wrong, lost or inconsistent |
| Green | DevOps | Environments, CI/CD, tooling, repo process, docs |
| Blue | Tech debt / Performance | Slowness, scaling limits, code-health refactors |
| Purple | Needs Dinuka / access | Blocked on a decision, credentials, billing or access from DHF |

A card can carry several labels (e.g. a bug that corrupts payment dates is Red + Yellow).

## While working a card

- Move it to **In Progress** when you start; **Waiting**/**Blocked** when stuck
  (say why in a comment); **Review** when a PR is up; **Done** when verified.
- Tick checklist items as they're completed, not in bulk at the end.
- Comment the PR/commit link and the environment it was verified in.
- Reference the card URL in the PR description.
