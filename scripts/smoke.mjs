#!/usr/bin/env node
// Post-deploy smoke test. Read-only: fetches pages and checks what is served.
// Usage: node scripts/smoke.mjs https://dhf-desk.netlify.app
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) {
  console.error('usage: node scripts/smoke.mjs <base-url>');
  process.exit(1);
}

const MUST_SERVE = ['/', '/app.js', '/portal.html', '/staff.html', '/crm.html', '/tokens.css', '/manifest.json', '/config.js'];
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
//
// Compare real <script src> tags, not raw substrings. The pages carry
// comments that mention both filenames ("...before the stylesheet and before
// app.js..."), and a naive indexOf matches those comments instead of the
// tags — which is exactly what made this check report a false failure on
// every deploy until 2026-09-21.
const srcOrder = (html) => {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const srcs = [];
  for (const [, src] of withoutComments.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    srcs.push(src);
  }
  return srcs;
};

for (const page of ['/', '/staff.html', '/portal.html', '/crm.html']) {
  const html = await (await fetch(base + page)).text();
  const srcs = srcOrder(html);
  const cfgAt = srcs.findIndex((s) => /(^|\/)config\.js(\?|$)/.test(s));
  const appAt = srcs.findIndex((s) => /(^|\/)app\.js(\?|$)/.test(s));

  if (cfgAt === -1) {
    // Only index.html loads app.js, but every page needs its config.
    say(false, `${page} loads config.js`);
    continue;
  }
  if (appAt === -1) {
    say(true, `${page} loads config.js (no app.js on this page)`);
    continue;
  }
  say(cfgAt < appAt, `${page} loads config.js before app.js`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
