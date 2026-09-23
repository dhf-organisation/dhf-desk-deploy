#!/usr/bin/env node
// Brings up the local Supabase stack (Postgres + Auth + PostgREST, in
// Docker) and loads it with a schema that looks like production.
//
// Usage:
//   node scripts/db-pull-schema.mjs   # once, or whenever prod schema changes
//   node scripts/db-local-up.mjs
//
// What this does NOT do: touch production in any way beyond the read-only
// pull above, which is a separate, explicit step. This script only talks to
// the local Docker containers it starts.
import { existsSync, copyFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SCHEMA_FILE = 'supabase/.local-schema.sql';
// A deliberately fake, un-guessable-as-a-real-date version prefix — this
// file must never be mistaken for a real migration if something goes wrong
// and it's left behind. See the try/finally below: it's deleted immediately
// after use, success or failure, so under normal operation it exists on
// disk for a few seconds at most.
const TEMP_MIGRATION = 'supabase/migrations/00000000000000_local-schema-DO-NOT-COMMIT.sql';

function sh(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`\n"${cmd} ${args.join(' ')}" failed (exit ${r.status}).`);
    process.exit(r.status || 1);
  }
}

// Like sh(), but returns the exit code instead of calling process.exit() —
// needed anywhere a cleanup step has to run on failure too. Confirmed by
// testing directly, not assumed: process.exit() skips pending `finally`
// blocks entirely, it doesn't unwind the stack the way a thrown error does.
// sh()'s hard exit is fine for steps with nothing to clean up; it is not
// fine here, where leaving the temp migration file behind on a failed
// `db reset` is exactly the kind of thing that ends up in a stray
// `git add -A` later.
function shNoExit(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  return r.status ?? 1;
}

function haveSupabaseCli() {
  const r = spawnSync('supabase', ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

function haveDocker() {
  const r = spawnSync('docker', ['info'], { stdio: 'ignore' });
  return r.status === 0;
}

if (!haveSupabaseCli()) {
  console.error(
    'The Supabase CLI isn\'t on PATH.\n' +
    '  brew install supabase/tap/supabase\n' +
    'or download a release directly: https://github.com/supabase/cli/releases'
  );
  process.exit(1);
}

if (!haveDocker()) {
  console.error(
    'Docker isn\'t running.\n' +
    '  macOS: open Docker Desktop (or `open -a Docker`) and wait for it to finish starting\n' +
    '  Linux: `sudo systemctl start docker`, or make sure your user is in the docker group\n' +
    'Then re-run this script.'
  );
  process.exit(1);
}

if (!existsSync(SCHEMA_FILE)) {
  console.error(
    `${SCHEMA_FILE} doesn't exist yet.\n` +
    'Run  node scripts/db-pull-schema.mjs  first (needs SUPABASE_ACCESS_TOKEN in ~/.config/dhf-desk/env).'
  );
  process.exit(1);
}

console.log('Starting the local Supabase stack …');
sh('supabase', ['start']);

console.log('\nApplying the pulled schema to the local database …');
// `supabase db query -f` cannot run a multi-statement file — it executes
// through the extended query protocol (one prepared statement per call),
// which rejects a file containing 100+ semicolon-separated statements with
// "cannot insert multiple commands into a prepared statement". Confirmed by
// hitting exactly that error while building this, not assumed.
//
// `supabase db reset --local` is the CLI's actual supported path for this —
// it applies every .sql file under supabase/migrations/ using the same
// mechanism real migrations use, which handles multi-statement files fine.
// So: copy the pulled schema in as a migration, reset, then remove it
// immediately — it must never be left sitting where a `git add -A` could
// pick it up. The try/finally makes the cleanup unconditional, including on
// failure, not just the happy path.
// Covers the one thing the exit-code path above can't: Ctrl+C during the
// (sometimes slow) `db reset` below. A signal kills the process outright,
// same as process.exit() does — no `finally`, no unwind — so this is the
// only way to still clean up the temp migration file if that happens.
process.on('SIGINT', () => {
  if (existsSync(TEMP_MIGRATION)) unlinkSync(TEMP_MIGRATION);
  process.exit(130); // 128 + SIGINT(2), the conventional shell exit code
});

// supabase/migrations/ isn't tracked by git when empty (and can't be
// committed with real content yet anyway -- see #6), so a genuinely fresh
// checkout -- a new developer's first run, or a CI runner -- won't have it
// on disk at all. copyFileSync into a directory that doesn't exist fails
// with ENOENT; create it first rather than assuming it's already there.
mkdirSync('supabase/migrations', { recursive: true });
copyFileSync(SCHEMA_FILE, TEMP_MIGRATION);
// --local scopes this to the stack `supabase start` just brought up — never
// production. --no-seed: seeding is a separate, explicit step
// (db-seed-synthetic.mjs), not bundled into bringing the stack up.
const resetStatus = shNoExit('supabase', ['db', 'reset', '--local', '--no-seed']);
unlinkSync(TEMP_MIGRATION); // unconditional — runs whether reset succeeded or not
if (resetStatus !== 0) {
  console.error(`\n"supabase db reset --local --no-seed" failed (exit ${resetStatus}).`);
  process.exit(resetStatus);
}

console.log('\nChecking nothing here can actually send a real message …');
sh('node', ['scripts/db-check-messaging-safe.mjs']);

console.log(
  '\nLocal stack is up.\n' +
  '  Studio:    http://localhost:54323\n' +
  '  API:       http://localhost:54321\n' +
  '  Postgres:  postgresql://postgres:postgres@localhost:54322/postgres\n\n' +
  'Next: node scripts/db-seed-synthetic.mjs   to add fake data to work with\n' +
  'Stop with: node scripts/db-local-down.mjs'
);
