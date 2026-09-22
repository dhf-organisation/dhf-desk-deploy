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
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SCHEMA_FILE = 'supabase/.local-schema.sql';

function sh(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`\n"${cmd} ${args.join(' ')}" failed (exit ${r.status}).`);
    process.exit(r.status || 1);
  }
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
// `supabase db query` runs SQL against whichever Postgres `supabase start`
// just brought up — never production. `--local` makes that explicit rather
// than relying on there being nothing else linked.
sh('supabase', ['db', 'query', '--local', '-f', SCHEMA_FILE]);

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
