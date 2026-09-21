#!/usr/bin/env node
// Reviews supabase/migrations for the mistakes that hurt most in this project:
//
//  - a filename that doesn't sort by timestamp (migrations apply in filename
//    order, so a bad name applies in the wrong order)
//  - destructive statements, which need a human to say so on the PR. DHF runs
//    the workshop on this database; a DROP that nobody noticed in review is
//    how a day's invoices disappear.
//
// Destructive migrations are allowed — they just have to be declared, by
// putting `-- destructive: <reason>` at the top of the file.
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const DIR = 'supabase/migrations';
if (!existsSync(DIR)) {
  console.log('check-migrations: no migrations directory yet — nothing to check');
  process.exit(0);
}

const DESTRUCTIVE = [
  /\bdrop\s+(table|column|schema|function|policy|trigger|index|type)\b/i,
  /\btruncate\b/i,
  /\balter\s+table\s+\S+\s+drop\b/i,
  /\bdelete\s+from\b/i,
  /\bset\s+not\s+null\b/i // fails if existing rows are null
];

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
let failed = 0;

for (const f of files) {
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(f)) {
    console.error(`FAIL  ${f} — name must be <14-digit timestamp>_snake_case.sql`);
    failed++;
    continue;
  }
  const sql = readFileSync(`${DIR}/${f}`, 'utf8');
  const declared = /^--\s*destructive:/im.test(sql);
  const hits = DESTRUCTIVE.filter((re) => re.test(sql.replace(/^--.*$/gm, '')));
  if (hits.length && !declared) {
    console.error(
      `FAIL  ${f} — contains destructive SQL (${hits.length} pattern(s)) without a declaration.\n` +
      `      Add a first line: -- destructive: <why this is safe / what it removes>`
    );
    failed++;
  } else {
    console.log(`OK    ${f}${hits.length ? ' (destructive, declared)' : ''}`);
  }
}

console.log(`check-migrations: ${files.length} migration(s)${failed ? `, ${failed} problem(s)` : ''}`);
process.exit(failed ? 1 : 0);
