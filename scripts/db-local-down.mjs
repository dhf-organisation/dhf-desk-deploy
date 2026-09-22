#!/usr/bin/env node
// Stops the local Supabase stack. Pass --wipe to also delete its data
// volume, so the next `db-local-up.mjs` starts from a clean database.
import { spawnSync } from 'node:child_process';

const wipe = process.argv.includes('--wipe');
const args = wipe ? ['stop', '--no-backup'] : ['stop'];

console.log(`$ supabase ${args.join(' ')}`);
const r = spawnSync('supabase', args, { stdio: 'inherit' });
process.exit(r.status || 0);
