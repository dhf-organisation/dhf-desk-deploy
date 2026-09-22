#!/usr/bin/env node
// Confirms the local stack cannot send a real email or SMS, and explains why
// if it's ever wrong. Runs automatically at the end of db-local-up.mjs, and
// can be run on its own any time.
//
// Why this matters here specifically: desk_send_email / desk_send_sms (and
// the triggers that call them — booking confirmations, day-before
// reminders) fire from Postgres itself via pg_net, not from this app's
// JavaScript. There is no "point staging at a sandbox" switch in the
// front end to get this wrong — the front end has no visibility into it at
// all. The only thing standing between a local test job and a text message
// to whatever phone number is in the test data is whether Supabase Vault
// on this local instance has real provider credentials in it.
//
// Read from the pulled schema (see db-pull-schema.mjs), not hard-coded:
// every function that calls out to Resend/Twilio looks up its credentials
// from vault.decrypted_secrets by one of these names. A fresh local
// database's vault has no rows at all, which is what actually keeps this
// safe today — not a stub, not a mock, just nothing to send with.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SCHEMA_FILE = 'supabase/.local-schema.sql';

function secretNamesFromSchema() {
  let text;
  try {
    text = readFileSync(SCHEMA_FILE, 'utf8');
  } catch {
    // Nothing pulled yet — nothing to check against, but that's a different
    // script's problem to report. Don't fail the messaging check for it.
    return null;
  }
  const names = new Set();
  for (const m of text.matchAll(/vault\.decrypted_secrets\s+where\s+name\s*=\s*'([a-z0-9_]+)'/gi)) {
    names.add(m[1]);
  }
  return [...names];
}

function queryLocalVault(names) {
  const inList = names.map((n) => `'${n}'`).join(',');
  const sql = `select name from vault.decrypted_secrets where name in (${inList});`;
  const r = spawnSync(
    'supabase',
    ['db', 'query', '--local', '--output-format', 'json', sql],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) {
    console.error('Could not query the local database:');
    console.error(r.stderr || r.stdout || '(no output)');
    process.exit(1);
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    console.error('Unexpected output from `supabase db query`:');
    console.error(r.stdout);
    process.exit(1);
  }
}

const names = secretNamesFromSchema();
if (!names || !names.length) {
  console.log(
    'db-check-messaging-safe: no messaging-related secret names found in ' +
    `${SCHEMA_FILE} — either it hasn't been pulled yet, or nothing in the ` +
    'schema calls a messaging provider. Nothing to check.'
  );
  process.exit(0);
}

const found = queryLocalVault(names);

if (found.length) {
  console.log('');
  console.log('🚨🚨🚨  LOCAL DATABASE CAN SEND REAL MESSAGES  🚨🚨🚨');
  console.log('');
  console.log('These provider secrets exist in this LOCAL instance\'s vault:');
  for (const row of found) console.log(`  - ${row.name}`);
  console.log('');
  console.log('Any job/booking change that fires a messaging trigger here will');
  console.log('try to send a REAL email or SMS to whatever\'s in your test data.');
  console.log('If that test data has a real phone number in it, a real person');
  console.log('gets a real text message.');
  console.log('');
  console.log('Remove them:');
  console.log("  node scripts/db-local-down.mjs --wipe   # nuke the whole local DB, or");
  console.log('  supabase db query --local "delete from vault.decrypted_secrets where name in (' +
    names.map((n) => `'${n}'`).join(',') + ')"');
  console.log('');
  if (process.env.ALLOW_LOCAL_MESSAGING === '1') {
    console.log('ALLOW_LOCAL_MESSAGING=1 set — continuing anyway. This was your call.');
  } else {
    console.log('Stopping db-local-up.mjs here rather than handing you a "ready to use,');
    console.log('actually dangerous" stack. If you genuinely intend to test messaging');
    console.log('against a sandbox/test provider account, re-run with:');
    console.log('  ALLOW_LOCAL_MESSAGING=1 node scripts/db-local-up.mjs');
    process.exit(1);
  }
} else {
  console.log(
    `db-check-messaging-safe: OK — no provider secrets in the local vault (checked: ${names.join(', ')}). ` +
    'Messaging triggers will fail closed with "not configured", not send anything.'
  );
}
