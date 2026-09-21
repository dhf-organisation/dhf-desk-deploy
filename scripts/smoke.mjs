#!/usr/bin/env node
// Post-deploy smoke test. Read-only: fetches pages and checks what is served.
// Usage: node scripts/smoke.mjs https://dhf-desk.netlify.app
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) {
  console.error('usage: node scripts/smoke.mjs <base-url>');
  process.exit(1);
}

const MUST_SERVE = ['/', '/app.js', '/portal.html', '/staff.html', '/crm.html', '/tokens.css', '/manifest.json'];
// Anything here would mean the publish allowlist has broken.
const MUST_404 = ['/deploy.sh', '/CLAUDE.md', '/netlify.toml', '/.git/HEAD', '/scripts/smoke.mjs', '/supabase/migrations'];
const MUST_HAVE_HEADERS = ['content-security-policy', 'x-frame-options', 'x-content-type-options'];

let failed = 0;
const say = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
};

for (const path of MUST_SERVE) {
  const r = await fetch(base + path, { redirect: 'follow' });
  say(r.ok, `${path} → ${r.status}`);
}

for (const path of MUST_404) {
  const r = await fetch(base + path);
  say(r.status === 404, `${path} → ${r.status} (expected 404)`);
}

const root = await fetch(base + '/');
for (const h of MUST_HAVE_HEADERS) {
  say(!!root.headers.get(h), `header ${h}`);
}

// The pages must load their config before any app script, or the app falls
// back to production config in a non-production environment.
const html = await (await fetch(base + '/')).text();
if (html.includes('config.js')) {
  const cfgAt = html.indexOf('config.js');
  const appAt = html.indexOf('app.js');
  say(cfgAt !== -1 && (appAt === -1 || cfgAt < appAt), 'config.js loads before app.js');
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
