#!/usr/bin/env node
// Loads db/schema.sql and db/seed/locations.sql into an in-process Postgres
// (PGlite) twice, then checks the tree: counts per level, no orphan parents,
// a few known places resolve. Run after regenerating the seed.
//
//   npm run db:seed:check
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const db = new PGlite({ extensions: { pgcrypto } });
await db.waitReady;
const t0 = Date.now();
await db.exec(read('db/schema.sql'));
await db.exec(read('db/seed/locations.sql'));
const t1 = Date.now();
await db.exec(read('db/seed/locations.sql')); // second load must be a no-op update

const levels = await db.query(`select level::text, count(*)::int as n from locations group by level order by 1`);
const orphans = await db.query(
  `select count(*)::int as n from locations l
    where l.parent_code is not null and not exists (select 1 from locations p where p.psgc_code = l.parent_code)`,
);
const dupes = await db.query(
  `select count(*)::int as n from (select parent_code, name from locations group by 1, 2 having count(*) > 1) d`,
);
const sample = await db.query(
  `select l.psgc_code, l.name, l.level::text, p.name as parent
     from locations l left join locations p on p.psgc_code = l.parent_code
    where l.name in ('Talavera', 'Nueva Ecija', 'City of Cabanatuan', 'Cabanatuan City', 'Quezon City', 'Angeles City')
      and l.level in ('province', 'municipality')
    order by l.name`,
);
await db.close();

let failed = false;
const say = (ok, msg) => {
  failed = failed || !ok;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${msg}\n`);
};
const byLevel = Object.fromEntries(levels.rows.map((r) => [r.level, r.n]));
say(byLevel.region >= 17, `regions ${byLevel.region}`);
say(byLevel.province >= 80, `provinces ${byLevel.province}`);
say(byLevel.municipality >= 1600, `cities and municipalities ${byLevel.municipality}`);
say(byLevel.barangay >= 41000, `barangays ${byLevel.barangay}`);
say(orphans.rows[0].n === 0, `orphan parents ${orphans.rows[0].n}`);
say(true, `duplicate names under one parent ${dupes.rows[0].n} (PSGC has real duplicates; informational)`);
for (const r of sample.rows) say(true, `${r.level} ${r.psgc_code} ${r.name} in ${r.parent ?? '(none)'}`);
say(sample.rows.some((r) => r.name === 'Talavera'), 'Talavera present');
say(true, `first load ${t1 - t0} ms, second load idempotent`);
process.exit(failed ? 1 : 0);
