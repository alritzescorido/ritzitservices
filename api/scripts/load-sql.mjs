#!/usr/bin/env node
// Run a SQL file against a local PGlite database directory. Stop the API first:
// a PGlite directory is single-process.
//
//   node scripts/load-sql.mjs --db ./.data/demo --file ../db/seed/locations.sql
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dbDir = opt('db');
const file = opt('file');
if (!dbDir || !file) {
  process.stderr.write('usage: --db <pglite dir> --file <sql file>\n');
  process.exit(2);
}
const parsers = { 1082: (v) => v, 1114: (v) => v, 1184: (v) => v, 1700: (v) => v };
const db = new PGlite(resolve(dbDir), { extensions: { pgcrypto }, parsers });
await db.waitReady;
const t0 = Date.now();
await db.exec(readFileSync(resolve(file), 'utf8'));
const { rows } = await db.query(`select count(*)::int as n from locations`);
await db.close();
process.stdout.write(`loaded ${file} into ${dbDir} in ${Date.now() - t0} ms (locations now ${rows[0].n})\n`);
