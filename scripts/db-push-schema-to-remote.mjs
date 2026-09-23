#!/usr/bin/env node
// Applies the pulled schema (supabase/.local-schema.sql) to a REMOTE
// Supabase project — staging, most likely. The remote counterpart to
// db-local-up.mjs's "apply schema to Postgres" step, reusing the same
// proven mechanism (temp migration file + `supabase db reset`) rather than
// a different, untested path.
//
// Usage:
//   node scripts/db-pull-schema.mjs                     # get today's schema
//   node scripts/db-push-schema-to-remote.mjs <ref> <db-password>
//
// <ref> is the target project's ref (e.g. from its dashboard URL).
// <db-password> is the DATABASE password for that project — NOT the
// SUPABASE_ACCESS_TOKEN. For a project you just created yourself, this is
// whatever you set at creation time. This script never reads or needs
// production's DB password (which was never recovered — see CLAUDE.md);
// it only ever touches the project ref you pass in explicitly.
//
// Safety: hard-refuses to run against the production project ref, checked
// in code, not left to whoever's typing the command to remember.
import { existsSync, copyFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const PRODUCTION_REF = 'cztpumgrvhmcvvpqbfqo';
const SCHEMA_FILE = 'supabase/.local-schema.sql';
const TEMP_MIGRATION = 'supabase/migrations/00000000000000_remote-push-DO-NOT-COMMIT.sql';

const [, , ref, dbPassword] = process.argv;

if (!ref || !dbPassword) {
  console.error('Usage: node scripts/db-push-schema-to-remote.mjs <project-ref> <db-password>');
  process.exit(1);
}

if (ref === PRODUCTION_REF) {
  console.error(
    `Refusing: ${ref} is the PRODUCTION project. This script applies a fresh\n` +
    'schema over whatever is there — never run it against production.'
  );
  process.exit(1);
}

if (!existsSync(SCHEMA_FILE)) {
  console.error(`${SCHEMA_FILE} doesn't exist. Run  node scripts/db-pull-schema.mjs  first.`);
  process.exit(1);
}

function sh(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return spawnSync(cmd, args, { stdio: 'inherit', ...opts }).status ?? 1;
}

process.on('SIGINT', () => {
  if (existsSync(TEMP_MIGRATION)) unlinkSync(TEMP_MIGRATION);
  process.exit(130);
});

console.log(`Linking to project ${ref} …`);
const linkStatus = sh('supabase', ['link', '--project-ref', ref], {
  env: { ...process.env, SUPABASE_DB_PASSWORD: dbPassword },
});
if (linkStatus !== 0) process.exit(linkStatus);

// supabase/migrations/ isn't tracked by git when empty, so a fresh checkout
// won't have it on disk -- create it before copying into it (see the same
// fix and reasoning in db-local-up.mjs, found the hard way when this
// exact pattern failed on a genuinely fresh CI checkout).
mkdirSync('supabase/migrations', { recursive: true });
copyFileSync(SCHEMA_FILE, TEMP_MIGRATION);
console.log(`\nApplying ${SCHEMA_FILE} to ${ref} via 'supabase db push' …`);
// db push applies every migration not yet recorded as applied on the target.
// A brand-new project has none applied, so this one lands as a normal
// migration — not a --local reset, because this is a real hosted database,
// not a disposable container.
const pushStatus = sh('supabase', ['db', 'push'], {
  env: { ...process.env, SUPABASE_DB_PASSWORD: dbPassword },
});
unlinkSync(TEMP_MIGRATION);

if (pushStatus !== 0) {
  console.error(`\n"supabase db push" failed (exit ${pushStatus}).`);
  process.exit(pushStatus);
}

console.log(`\nSchema applied to ${ref}.`);
