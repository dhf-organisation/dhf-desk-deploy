#!/usr/bin/env node
// Most of this app's JavaScript lives inside <script> tags in the HTML pages
// (portal.html, staff.html and crm.html are each a whole app in one file), so
// `node --check auth.js app-main.js` alone would miss a syntax error that
// breaks a page completely. This extracts every inline script and
// syntax-checks it.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// The end-tag pattern is permissive on purpose. HTML ends a script at
// `</script>`, `</script >`, and even `</script foo="bar">` — an end tag may
// carry attributes, which are ignored. A regex matching only `</script>`
// would run straight past those and swallow the rest of the file as a single
// script body, hiding any real syntax error further down.
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script(?:\s[^>]*)?>/gi;
const tmp = mkdtempSync(join(tmpdir(), 'dhf-inline-'));
let checked = 0;
let failed = 0;

for (const page of readdirSync('.').filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(page, 'utf8');
  let i = 0;
  for (const [, attrs, body] of html.matchAll(SCRIPT)) {
    i++;
    if (/\ssrc\s*=/i.test(attrs)) continue; // external file, checked elsewhere
    if (/type\s*=\s*["'](?!text\/javascript|module)/i.test(attrs)) continue; // templates, JSON-LD
    if (!body.trim()) continue;
    const file = join(tmp, `${page.replace(/\W/g, '_')}_${i}.js`);
    writeFileSync(file, body);
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      checked++;
    } catch (e) {
      failed++;
      console.error(`SYNTAX ERROR in ${page} (inline script #${i}):`);
      console.error(String(e.stderr || e.message).split('\n').slice(0, 6).join('\n'));
    }
  }
}

console.log(`check-inline-scripts: ${checked} inline script(s) OK${failed ? `, ${failed} failed` : ''}`);
process.exit(failed ? 1 : 0);
