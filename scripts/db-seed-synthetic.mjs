#!/usr/bin/env node
// Adds a small set of obviously-fake rows to the LOCAL Supabase instance,
// so the app has something to render — customers, vehicles, jobs, a couple
// of CRM leads. Not an exhaustive fixture set for all 65 tables; it's a
// starting point for the tables the desk/staff/CRM views need first.
// Extend it as more of the app gets exercised locally.
//
// Safety: this hard-refuses to run against anything but the local stack.
// It never reads production credentials, and never accepts a --url or
// similar override — if you need to point it somewhere else, that's a
// deliberate code change, not a flag, so it can't happen by accident.
import { spawnSync } from 'node:child_process';

function localSupabaseKeys() {
  const r = spawnSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('`supabase status` failed — is the local stack running? Try: node scripts/db-local-up.mjs');
    console.error(r.stderr || '');
    process.exit(1);
  }
  let status;
  try {
    status = JSON.parse(r.stdout);
  } catch {
    console.error('Could not parse `supabase status -o json` output.');
    process.exit(1);
  }
  const url = status.API_URL;
  const key = status.SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing API_URL / SERVICE_ROLE_KEY in `supabase status` output.');
    process.exit(1);
  }
  // The one hard safety check that matters: refuse anything that isn't the
  // local loopback stack, no matter what `supabase status` claims.
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    console.error(`Refusing to seed a non-local URL: ${url}`);
    process.exit(1);
  }
  return { url, key };
}

async function sb(url, key, table, rows) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST ${table} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  const { url, key } = localSupabaseKeys();
  console.log(`Seeding local stack at ${url} (this is not production)…`);

  const customers = await sb(url, key, 'desk_customers', [
    { name: 'Test Customer — Alex Rivera', email: 'alex.test@example.invalid', mobile: '0400 000 001', created_by: 'seed-script' },
    { name: 'Test Customer — Jordan Blake', email: 'jordan.test@example.invalid', mobile: '0400 000 002', created_by: 'seed-script' },
    { name: 'Test Customer — Sam Okafor (Fleet)', email: 'sam.test@example.invalid', mobile: '0400 000 003', created_by: 'seed-script' },
  ]);
  console.log(`  ${customers.length} desk_customers`);

  const vehicles = await sb(url, key, 'desk_vehicles', [
    { customer_id: customers[0].id, rego: 'TEST01', make: 'Toyota', model: 'Hilux', odometer: 45000, created_by: 'seed-script' },
    { customer_id: customers[1].id, rego: 'TEST02', make: 'Mazda', model: 'CX-5', odometer: 62000, created_by: 'seed-script' },
    { customer_id: customers[2].id, rego: 'TEST03', make: 'Isuzu', model: 'D-Max', odometer: 118000, created_by: 'seed-script' },
  ]);
  console.log(`  ${vehicles.length} desk_vehicles`);

  // desk_jobs.status has a CHECK constraint — confirmed against the real
  // pulled schema, not guessed: 'booking' | 'in_progress' | 'on_hold' |
  // 'finished'. Got this wrong on the first pass ('Booked'/'In Progress'),
  // caught it by actually running this against the local stack rather than
  // trusting it would work.
  const jobs = await sb(url, key, 'desk_jobs', [
    {
      customer_id: customers[0].id, vehicle_id: vehicles[0].id,
      job_type: 'Tyre Fitment', status: 'booking',
      booked_at: new Date(Date.now() + 86400000).toISOString(),
      created_by: 'seed-script',
    },
    {
      customer_id: customers[1].id, vehicle_id: vehicles[1].id,
      job_type: 'Roadworthy', status: 'in_progress',
      booked_at: new Date().toISOString(),
      created_by: 'seed-script',
    },
  ]);
  console.log(`  ${jobs.length} desk_jobs`);

  // PostgREST requires every object in a batch insert to have the exact
  // same set of keys — it builds one INSERT with a fixed column list from
  // the first row, and 400s ("All object keys must match") on a mismatch.
  // Learned by hitting it: the second row here was missing `email` entirely
  // rather than setting it null, which is enough to trigger this.
  const leads = await sb(url, key, 'leads', [
    { name: 'Test Lead — Priya Nair', phone: '0400 000 010', email: 'priya.test@example.invalid', enquiry: 'Tyre price enquiry (synthetic seed row)', source: 'seed-script' },
    { name: 'Test Lead — Marco Rossi', phone: '0400 000 011', email: null, enquiry: 'Fleet quote request (synthetic seed row)', source: 'seed-script' },
  ]);
  console.log(`  ${leads.length} leads`);

  console.log('\nDone. Every row above is fake — created_by/source is "seed-script" so it is easy to find and clear.');
}

main().catch((e) => {
  console.error('Seeding failed:', e.message);
  process.exit(1);
});
