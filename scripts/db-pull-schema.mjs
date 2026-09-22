#!/usr/bin/env node
// Pulls the current production schema into a LOCAL, git-ignored file, so
// `supabase start` can boot a local Postgres that actually looks like
// production. It never writes to the repo's tracked history.
//
// Why not `supabase db pull` / `pg_dump`? Both need a direct Postgres
// connection (host:port + password), and the database password for this
// project has never been recovered (see CLAUDE.md). This uses the Supabase
// Management API's SQL endpoint instead — a personal access token is
// enough, and it only ever runs read-only introspection queries against
// Postgres's own catalog. No schema change, no write, nothing destructive.
//
// The reconstruction leans on Postgres's own DDL-rendering functions
// (pg_get_constraintdef, pg_get_indexdef, pg_get_functiondef,
// pg_get_triggerdef) rather than hand-assembling SQL, so what comes out is
// real Postgres syntax, not a guess at it. It is a best-effort catalog
// reconstruction, not a byte-perfect pg_dump — if something looks off
// against production, trust production and fix this script.
//
// Output: supabase/.local-schema.sql (git-ignored — see supabase/.gitignore
// and the root .gitignore. Never remove those entries).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECT_REF = 'cztpumgrvhmcvvpqbfqo'; // public — it's in the app's own URLs
const OUT_PATH = 'supabase/.local-schema.sql';

function loadToken() {
  const envPath = join(homedir(), '.config/dhf-desk/env');
  let text;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    console.error(`Can't read ${envPath}. This script needs SUPABASE_ACCESS_TOKEN in there.`);
    process.exit(1);
  }
  const m = text.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
  if (!m || !m[1].trim()) {
    console.error(`SUPABASE_ACCESS_TOKEN is missing or empty in ${envPath}.`);
    process.exit(1);
  }
  return m[1].trim();
}

async function runSql(token, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Management API ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

// ── Introspection queries ───────────────────────────────────────────────
// Every one of these SELECTs from pg_catalog / information_schema. None of
// them can modify anything — there is no INSERT/UPDATE/DELETE/DDL here.

const Q_SCHEMAS_EXIST = `
  select nspname from pg_namespace where nspname = 'public';
`;

const Q_SEQUENCES = `
  select sequencename as name, start_value, increment_by, min_value, max_value, cycle
  from pg_sequences
  where schemaname = 'public'
  order by sequencename;
`;

const Q_ENUMS = `
  select t.typname as name,
         string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) as labels
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  group by t.typname
  order by t.typname;
`;

const Q_TABLES = `
  select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name;
`;

const Q_COLUMNS = `
  select c.table_name, c.column_name, c.data_type, c.udt_name,
         c.is_nullable, c.column_default, c.character_maximum_length,
         c.numeric_precision, c.numeric_scale, c.ordinal_position
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
  order by c.table_name, c.ordinal_position;
`;

const Q_CONSTRAINTS = `
  select conrelid::regclass::text as table_name, conname,
         pg_get_constraintdef(oid) as def, contype
  from pg_constraint
  where connamespace = 'public'::regnamespace
  order by conrelid::regclass::text, conname;
`;

const Q_INDEXES = `
  select tablename as table_name, indexname, indexdef
  from pg_indexes
  where schemaname = 'public'
    and indexname not in (select conname from pg_constraint where connamespace = 'public'::regnamespace)
  order by tablename, indexname;
`;

const Q_RLS_ENABLED = `
  select relname as table_name, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
  from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r'
  order by relname;
`;

const Q_POLICIES = `
  select schemaname, tablename as table_name, policyname, permissive, roles,
         cmd, qual, with_check
  from pg_policies
  where schemaname = 'public'
  order by tablename, policyname;
`;

const Q_FUNCTIONS = `
  select p.proname as name, pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
  order by p.proname;
`;

const Q_TRIGGERS = `
  select tgname, pg_get_triggerdef(oid) as def
  from pg_trigger
  where not tgisinternal
    and tgrelid::regclass::text in (select table_name from information_schema.tables where table_schema='public')
  order by tgname;
`;

// ── Assembly ─────────────────────────────────────────────────────────────

function pgTypeName(col) {
  // udt_name is the authoritative Postgres type name (e.g. "varchar",
  // "int4", "uuid", "jsonb") — data_type is the SQL-standard label
  // ("character varying") which needs the length suffix reattached.
  if (col.udt_name === 'varchar' && col.character_maximum_length) {
    return `varchar(${col.character_maximum_length})`;
  }
  if (col.udt_name === 'numeric' && col.numeric_precision) {
    return col.numeric_scale
      ? `numeric(${col.numeric_precision},${col.numeric_scale})`
      : `numeric(${col.numeric_precision})`;
  }
  // Postgres internal short names for the common SERIAL/int/text family.
  const MAP = { int4: 'integer', int8: 'bigint', int2: 'smallint', bool: 'boolean' };
  return MAP[col.udt_name] || col.udt_name;
}

function buildTableSql(tableName, columns, constraints) {
  const colLines = columns.map((c) => {
    let line = `  "${c.column_name}" ${pgTypeName(c)}`;
    if (c.is_nullable === 'NO') line += ' NOT NULL';
    if (c.column_default !== null) line += ` DEFAULT ${c.column_default}`;
    return line;
  });
  // Foreign keys are deliberately NOT inlined here — see buildForeignKeySql.
  // Tables are created in one alphabetical pass (simplest, and matches how
  // the queries below are ordered), so an inline FK referencing a table that
  // sorts later would fail with "relation does not exist". pg_dump avoids
  // exactly this by adding FKs in a separate pass after every table exists;
  // doing the same here rather than hand-rolling a topological sort.
  const inlineable = constraints.filter((c) => c.contype !== 'f');
  const lines = [...colLines, ...inlineable.map((c) => `  CONSTRAINT "${c.conname}" ${c.def}`)];
  return `CREATE TABLE IF NOT EXISTS "public"."${tableName}" (\n${lines.join(',\n')}\n);`;
}

function buildForeignKeySql(tableName, constraints) {
  return constraints
    .filter((c) => c.contype === 'f')
    .map((c) => `ALTER TABLE "public"."${tableName}" ADD CONSTRAINT "${c.conname}" ${c.def};`);
}

function quoteLiteralList(rolesArray) {
  // pg_policies.roles comes back as a Postgres array literal (text);
  // normalize {public} / {authenticated,anon} into a SQL role list.
  const inner = String(rolesArray).replace(/^\{|\}$/g, '');
  return inner.split(',').map((r) => r.trim()).join(', ');
}

async function main() {
  const token = loadToken();
  console.log(`Pulling schema from project ${PROJECT_REF} (read-only) …`);

  const exists = await runSql(token, Q_SCHEMAS_EXIST);
  if (!exists.length) throw new Error('public schema not found — unexpected, stopping.');

  const [sequences, enums, tables, columns, constraints, indexes, rlsFlags, policies, functions, triggers] =
    await Promise.all([
      runSql(token, Q_SEQUENCES),
      runSql(token, Q_ENUMS),
      runSql(token, Q_TABLES),
      runSql(token, Q_COLUMNS),
      runSql(token, Q_CONSTRAINTS),
      runSql(token, Q_INDEXES),
      runSql(token, Q_RLS_ENABLED),
      runSql(token, Q_POLICIES),
      runSql(token, Q_FUNCTIONS),
      runSql(token, Q_TRIGGERS),
    ]);

  const byTableCols = {};
  for (const c of columns) (byTableCols[c.table_name] ??= []).push(c);
  const byTableCons = {};
  for (const c of constraints) (byTableCons[c.table_name] ??= []).push(c);

  const out = [];
  out.push(
    '-- Auto-generated by scripts/db-pull-schema.mjs. DO NOT COMMIT.',
    `-- Pulled ${new Date().toISOString()} from project ${PROJECT_REF} (read-only introspection).`,
    '-- Best-effort catalog reconstruction, not a byte-perfect pg_dump.',
    '-- Regenerate any time: node scripts/db-pull-schema.mjs',
    ''
  );

  if (sequences.length) {
    // Standalone sequences (bill/invoice/PO numbering etc.) need to exist
    // BEFORE the tables — a column default like nextval('x_seq'::regclass)
    // fails at table-creation time otherwise, not at insert time. SERIAL/
    // IDENTITY columns create their own sequence implicitly and don't show
    // up here (pg_sequences lists every sequence either way, so this only
    // matters for ones a table default explicitly calls by name).
    out.push('-- ── Sequences ─────────────────────────────────────────────');
    for (const s of sequences) {
      out.push(
        `CREATE SEQUENCE IF NOT EXISTS "public"."${s.name}" ` +
        `START WITH ${s.start_value} INCREMENT BY ${s.increment_by} ` +
        `MINVALUE ${s.min_value} MAXVALUE ${s.max_value}${s.cycle ? ' CYCLE' : ' NO CYCLE'};`
      );
    }
    out.push('');
  }

  if (enums.length) {
    out.push('-- ── Enums ──────────────────────────────────────────────');
    for (const e of enums) out.push(`CREATE TYPE "public"."${e.name}" AS ENUM (${e.labels});`);
    out.push('');
  }

  out.push('-- ── Tables ─────────────────────────────────────────────────');
  for (const t of tables) {
    const cols = byTableCols[t.table_name] || [];
    if (!cols.length) continue; // view or something without introspectable columns
    out.push(buildTableSql(t.table_name, cols, byTableCons[t.table_name] || []));
  }
  out.push('');

  const fkStatements = tables.flatMap((t) => buildForeignKeySql(t.table_name, byTableCons[t.table_name] || []));
  if (fkStatements.length) {
    out.push('-- ── Foreign keys (added after every table exists) ────────');
    out.push(...fkStatements);
    out.push('');
  }

  if (indexes.length) {
    out.push('-- ── Indexes (non-constraint-backed) ──────────────────────');
    for (const i of indexes) out.push(`${i.indexdef};`);
    out.push('');
  }

  if (functions.length) {
    out.push('-- ── Functions ─────────────────────────────────────────────');
    for (const f of functions) out.push(f.def + ';', '');
  }

  if (triggers.length) {
    out.push('-- ── Triggers ──────────────────────────────────────────────');
    for (const t of triggers) out.push(t.def + ';');
    out.push('');
  }

  const rlsOn = rlsFlags.filter((r) => r.rls_enabled);
  if (rlsOn.length) {
    out.push('-- ── Row-level security ───────────────────────────────────');
    for (const r of rlsOn) {
      out.push(`ALTER TABLE "public"."${r.table_name}" ENABLE ROW LEVEL SECURITY;`);
      if (r.rls_forced) out.push(`ALTER TABLE "public"."${r.table_name}" FORCE ROW LEVEL SECURITY;`);
    }
    out.push('');
  }

  if (policies.length) {
    out.push('-- ── Policies ──────────────────────────────────────────────');
    for (const p of policies) {
      const cmd = p.cmd === '*' ? 'ALL' : p.cmd;
      const roles = quoteLiteralList(p.roles);
      let stmt = `CREATE POLICY "${p.policyname}" ON "public"."${p.table_name}" AS ${
        p.permissive === 'PERMISSIVE' ? 'PERMISSIVE' : 'RESTRICTIVE'
      } FOR ${cmd} TO ${roles}`;
      if (p.qual) stmt += `\n  USING (${p.qual})`;
      if (p.with_check) stmt += `\n  WITH CHECK (${p.with_check})`;
      out.push(stmt + ';');
    }
    out.push('');
  }

  mkdirSync('supabase', { recursive: true });
  writeFileSync(OUT_PATH, out.join('\n'));

  console.log(`Wrote ${OUT_PATH}`);
  console.log(
    `  ${tables.length} tables, ${sequences.length} sequences, ${enums.length} enums, ${functions.length} functions, ` +
    `${triggers.length} triggers, ${policies.length} policies, ${rlsOn.length} tables with RLS on`
  );
  console.log('\nThis file is git-ignored — it must never be committed. Confirming:');
}

main().catch((e) => {
  console.error('Schema pull failed:', e.message);
  process.exit(1);
});
