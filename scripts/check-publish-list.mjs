#!/usr/bin/env node
// Guards the netlify.toml publish allowlist.
//
// The site deploys ONLY the files listed in netlify.toml's `cp` command. That
// is deliberate (see the file's header), but it has one failure mode: someone
// adds a page or an asset, references it from the HTML, and it silently never
// deploys — or worse, the app 404s a script in production.
//
// This check fails if:
//   1. an HTML page references a local file that isn't in the allowlist, or
//   2. the allowlist names a file that doesn't exist in the repo.
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const toml = readFileSync('netlify.toml', 'utf8');
const cmd = (toml.match(/^\s*command\s*=\s*"(.+)"\s*$/m) || [])[1];
if (!cmd) {
  console.error('check-publish-list: could not find the build command in netlify.toml');
  process.exit(1);
}

// Everything between `cp` and the destination directory.
const cpMatch = cmd.match(/cp\s+([^&|]+?)\s+dist\//);
if (!cpMatch) {
  console.error('check-publish-list: could not parse the `cp ... dist/` part of the build command');
  process.exit(1);
}
const published = cpMatch[1].trim().split(/\s+/);

const problems = [];

for (const f of published) {
  if (!existsSync(f)) problems.push(`netlify.toml publishes "${f}" but it does not exist in the repo`);
}

const pages = readdirSync('.').filter((f) => f.endsWith('.html'));
const REF = /(?:src|href)\s*=\s*["']([^"'#?:]+)["']/g;

for (const page of pages) {
  if (!published.includes(page)) {
    problems.push(`"${page}" exists but is not in the netlify.toml publish list — it will not deploy`);
  }
  const html = readFileSync(page, 'utf8');
  for (const [, ref] of html.matchAll(REF)) {
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:') || ref.startsWith('mailto:') || ref.startsWith('tel:')) continue;
    const file = ref.replace(/^\.\//, '').split('?')[0];
    if (!file || !existsSync(file)) continue; // a route like "/" or a generated file
    if (!published.includes(file)) {
      problems.push(`${page} references "${file}", which is not in the netlify.toml publish list`);
    }
  }
}

if (problems.length) {
  console.error('check-publish-list FAILED:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  console.error('\nFix: add the file to the `cp` list in netlify.toml (or stop referencing it).');
  process.exit(1);
}

console.log(`check-publish-list OK — ${published.length} files published: ${published.join(' ')}`);
