#!/usr/bin/env node
// Writes dist/config.js for the environment being deployed.
//
// Default (no env vars set): copies the committed config.js, i.e. production.
// If DHF_ENV is set, every value must come from environment variables, so a
// staging build can never silently fall back to production credentials.
//
// Netlify: set DHF_ENV + the DHF_* vars per deploy context (branch deploys,
// deploy previews). Production sets nothing and uses the committed file.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const OUT_DIR = 'dist';
const OUT = `${OUT_DIR}/config.js`;
mkdirSync(OUT_DIR, { recursive: true });

const env = process.env.DHF_ENV;

if (!env) {
  writeFileSync(OUT, readFileSync('config.js'));
  console.log('build-config: no DHF_ENV set — using committed config.js (production)');
  process.exit(0);
}

const required = ['DHF_SUPABASE_URL', 'DHF_SUPABASE_KEY', 'DHF_GOOGLE_CLIENT_ID'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`build-config: DHF_ENV=${env} but missing: ${missing.join(', ')}`);
  console.error('Set them in Netlify → Site configuration → Environment variables, scoped to this context.');
  process.exit(1);
}

if (env === 'production') {
  console.error('build-config: refusing to generate a "production" config from env vars — production uses the committed config.js');
  process.exit(1);
}

const cfg = {
  env,
  supabaseUrl: process.env.DHF_SUPABASE_URL,
  supabaseKey: process.env.DHF_SUPABASE_KEY,
  googleClientId: process.env.DHF_GOOGLE_CLIENT_ID,
  mapsKey: process.env.DHF_MAPS_KEY || '',
  allowedDomain: process.env.DHF_ALLOWED_DOMAIN || 'dhftyres.com.au',
  allowedEmails: (process.env.DHF_ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
};

writeFileSync(
  OUT,
  `// GENERATED for the "${env}" environment — do not edit.\nwindow.DHF_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`
);
console.log(`build-config: wrote ${OUT} for env "${env}" (${cfg.supabaseUrl})`);

// The CSP in _headers names the Supabase host explicitly, so a staging build
// pointed at a different project would be blocked by connect-src. Swap the
// production host for this environment's host in the copied _headers.
const PROD_HOST = 'https://cztpumgrvhmcvvpqbfqo.supabase.co';
const host = cfg.supabaseUrl.replace(/\/$/, '');
if (host !== PROD_HOST) {
  const headersPath = `${OUT_DIR}/_headers`;
  const headers = readFileSync(headersPath, 'utf8');
  writeFileSync(headersPath, headers.split(PROD_HOST).join(host));
  console.log(`build-config: rewrote CSP host in _headers → ${host}`);
}
