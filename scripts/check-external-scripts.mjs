#!/usr/bin/env node
// Every third-party <script src> must be pinned to an exact version AND carry
// a Subresource Integrity hash, so a compromised CDN or a malicious package
// publish can't execute in a signed-in session.
//
// This matters more here than in most apps: the pages have no build step and
// no dependency lockfile, so a CDN tag IS the dependency management. The
// Supabase client in particular holds the user's session — whatever runs in
// that script can do anything the signed-in person can.
//
// SRI also requires crossorigin="anonymous" on a cross-origin script;
// without it the browser fetches in no-cors mode, can't read the body, and
// skips the integrity check entirely. A hash with no crossorigin is a hash
// that does nothing, which is worse than none because it looks protected.
import { readFileSync, readdirSync } from 'node:fs';

// Scripts that genuinely cannot be pinned. Each needs a reason, not just an
// entry — an allowlist nobody justifies becomes a place to hide things.
const ALLOWED_UNPINNED = [
  {
    match: /^https:\/\/accounts\.google\.com\/gsi\/client/,
    why: 'Google Identity Services is served unversioned and updated without notice. ' +
         'There is no version to pin, and an SRI hash would break sign-in the moment ' +
         'Google ships a change.'
  }
];

// An exact version looks like @1.2.3 in the path, or a /1.2.3/ path segment.
const isPinned = (url) =>
  /@\d+\.\d+\.\d+(?![\d.])/.test(url) || /\/\d+\.\d+\.\d+\//.test(url);

const SCRIPT_TAG = /<script\b([^>]*)>/gi;
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : null;
};

let failed = 0;
let checked = 0;
const allowed = [];

for (const page of readdirSync('.').filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(page, 'utf8');
  // Skip commented-out tags: a single-pass comment strip can leave "<!--"
  // behind on nested comments, so walk and skip comment regions instead.
  let i = 0;
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (!/^<script\b/i.test(html.slice(i, i + 8))) {
      i++;
      continue;
    }
    const gt = html.indexOf('>', i);
    if (gt === -1) break;
    const tag = html.slice(i, gt + 1);
    i = gt + 1;

    const src = attr(tag, 'src');
    if (!src || !/^https?:\/\//i.test(src)) continue; // local file, checked elsewhere
    checked++;

    const exempt = ALLOWED_UNPINNED.find((a) => a.match.test(src));
    if (exempt) {
      allowed.push(`${page}: ${src}`);
      continue;
    }

    const problems = [];
    if (!isPinned(src)) problems.push('not pinned to an exact version');
    if (!attr(tag, 'integrity')) problems.push('missing integrity (SRI) hash');
    else if ((attr(tag, 'crossorigin') || '').toLowerCase() !== 'anonymous') {
      problems.push('has integrity but no crossorigin="anonymous", so the browser skips the check');
    }

    if (problems.length) {
      failed++;
      console.error(`FAIL  ${page}\n      ${src}`);
      for (const p of problems) console.error(`      - ${p}`);
    } else {
      console.log(`OK    ${page}: ${src.replace(/^https:\/\/[^/]+/, '…')}`);
    }
  }
}

for (const a of allowed) console.log(`ALLOWED (documented exception)  ${a}`);

if (failed) {
  console.error(
    `\ncheck-external-scripts: ${failed} problem(s).\n` +
    `Pin the exact version and add integrity + crossorigin="anonymous". To get the hash:\n` +
    `  curl -sL <exact-version-url> | openssl dgst -sha384 -binary | openssl base64 -A\n` +
    `If the script genuinely cannot be pinned, add it to ALLOWED_UNPINNED in this file with a reason.`
  );
} else {
  console.log(`\ncheck-external-scripts: ${checked} external script(s) OK`);
}
process.exit(failed ? 1 : 0);
