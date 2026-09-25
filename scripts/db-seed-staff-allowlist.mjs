#!/usr/bin/env node
// desk_staff_allowlist backs is_desk_user() (see the "Move the staff
// allowlist server-side" work), so every RLS-gated table now depends on it
// having real rows -- but scripts/db-pull-schema.mjs only pulls schema,
// never row data, by design (never copy production data into non-prod). A
// local stack with an empty allowlist means is_desk_user() is false for
// everyone, including every pgTAP test's own "staff" identity.
//
// Fix: pull just the allowlist *patterns* (not customer data, not anything
// sensitive -- these are staff email addresses, already visible in
// CLAUDE.md) read-only from production, and seed them into the local
// stack. Runs automatically as part of db-local-up.mjs, same as the
// messaging-safety check.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECT_REF = 'cztpumgrvhmcvvpqbfqo';
const ENV_FILE = join(homedir(), '.config/dhf-desk/env');

function readAccessToken() {
  const envVar = process.env.SUPABASE_ACCESS_TOKEN;
  if (envVar) return envVar;
  if (!existsSyncSafe(ENV_FILE)) {
    console.error(`No SUPABASE_ACCESS_TOKEN and ${ENV_FILE} doesn't exist.`);
    process.exit(1);
  }
  const text = readFileSync(ENV_FILE, 'utf8');
  const match = text.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
  if (!match) {
    console.error(`SUPABASE_ACCESS_TOKEN not found in ${ENV_FILE}.`);
    process.exit(1);
  }
  return match[1].trim();
}

function existsSyncSafe(path) {
  try { readFileSync(path); return true; } catch { return false; }
}

function localSupabaseKeys() {
  const r = spawnSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('`supabase status` failed — is the local stack running? Try: node scripts/db-local-up.mjs');
    process.exit(1);
  }
  const status = JSON.parse(r.stdout);
  const { API_URL: url, SERVICE_ROLE_KEY: key } = status;
  // Same hard safety check as db-seed-synthetic.mjs: refuse anything that
  // isn't the local loopback stack, no matter what `supabase status` claims.
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    console.error(`Refusing to seed a non-local URL: ${url}`);
    process.exit(1);
  }
  return { url, key };
}

async function pullPatternsFromProd(token) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'select pattern from desk_staff_allowlist order by pattern;' }),
  });
  if (!res.ok) throw new Error(`Pulling allowlist patterns failed: ${res.status} ${await res.text()}`);
  return (await res.json()).map((r) => r.pattern);
}

async function seedLocal(url, key, patterns) {
  const res = await fetch(`${url}/rest/v1/desk_staff_allowlist`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(patterns.map((pattern) => ({ pattern }))),
  });
  if (!res.ok) throw new Error(`Seeding local allowlist failed: ${res.status} ${await res.text()}`);
}

const token = readAccessToken();
const patterns = await pullPatternsFromProd(token);
const { url, key } = localSupabaseKeys();
await seedLocal(url, key, patterns);
console.log(`db-seed-staff-allowlist: seeded ${patterns.length} pattern(s) into the local desk_staff_allowlist.`);
