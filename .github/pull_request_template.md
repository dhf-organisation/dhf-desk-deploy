<!--
Merging to master publishes to https://dhf-desk.netlify.app within ~2 minutes.
There is no staging gate in front of it yet. Treat every merge as a release.
-->

## What this changes

<!-- One or two sentences. What is different for someone using the app? -->

## Why

<!-- Link the Trello card and/or GitHub issue: Closes #12 / Trello: <url> -->

## How it was checked

<!-- Delete what doesn't apply, and say what you actually did. -->

- [ ] Opened the Netlify deploy preview and clicked through the affected page
- [ ] Checked the browser console for errors on that page
- [ ] Signed in as a staff user (if the change touches auth or the CRM)
- [ ] Signed in as a customer on `portal.html` (if the change touches the portal)
- [ ] Ran `node scripts/check-publish-list.mjs` (if files were added or renamed)

## Risk

- **Blast radius:** <!-- one page / all pages / database / deploy pipeline -->
- **Rollback:** <!-- usually "revert this PR"; if not, say what it takes -->

## Database changes

- [ ] No database changes
- [ ] Migration included in `supabase/migrations/`, and it has been applied to
      production (or: it has not, and this says who applies it and when)

## Deploy notes

<!-- New file that must be added to the netlify.toml publish list? New
     environment variable? Anything that has to happen outside this merge? -->
