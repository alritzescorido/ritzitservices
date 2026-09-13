#!/usr/bin/env node
// Runs db/schema.sql and every db/tests/*.sql file against an in-process
// PostgreSQL (PGlite, Postgres compiled to WebAssembly). No Docker, no psql.
//
//   npm run db:test
//
// PGlite has pgcrypto but not PostGIS, so the schema's geo_* domains fall back
// to built-in point/polygon here. CI runs the same files against real PostGIS
// through db/tests/run.sh, so both paths stay covered.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const schemaPath = join(root, 'db', 'schema.sql');
const testFiles = readdirSync(here)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => join(here, f));

const started = Date.now();
const db = new PGlite({ extensions: { pgcrypto } });
await db.waitReady;
await db.exec(`set timezone to 'Asia/Manila';`);

async function runFile(path) {
  const label = path.startsWith(root) ? path.slice(root.length + 1).replaceAll('\\', '/') : basename(path);
  process.stdout.write(`== ${label}\n`);
  const sql = readFileSync(path, 'utf8');
  try {
    await db.exec(sql);
  } catch (err) {
    process.stdout.write(`\nFAILED in ${label}\n${err.message}\n`);
    if (err.position) {
      const pos = Number(err.position);
      const line = sql.slice(0, pos).split('\n').length;
      process.stdout.write(`at line ${line}\n`);
    }
    await db.close();
    process.exit(1);
  }
}

await runFile(schemaPath);
for (const f of testFiles) await runFile(f);

const { rows } = await db.query(`select count(*)::int as n from pg_proc where proname like 'test_%'`);
await db.close();
process.stdout.write(`== all test files passed (${testFiles.length} files, ${rows[0].n} helper functions, ${Date.now() - started} ms)\n`);
