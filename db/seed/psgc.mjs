#!/usr/bin/env node
// Builds db/seed/locations.sql from the Philippine Standard Geographic Code.
//
//   npm run db:seed:psgc                       # whole country, from the public PSGC API
//   npm run db:seed:psgc -- --provinces 0304900000,0301400000   # regions + these provinces and their children
//   npm run db:seed:psgc -- --from ./psgc-cache  # reuse a previous download
//
// Source: https://psgc.gitlab.io/api (community mirror of the PSA publication,
// 10-digit codes in `psgc10DigitCode`). The PSA site itself blocks scripted
// downloads. Always record the publication quarter you loaded in the header of
// the generated file; PSGC changes every quarter (new cities, renamed barangays).
//
// Output is plain SQL with `insert ... on conflict do update`, so re-running it
// after a PSGC update renames in place and never duplicates. Rows that vanish
// from the publication are NOT deleted (farms may still reference them); they
// are marked active = false by a second statement at the end.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const provinceFilter = (opt('provinces', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const cacheDir = resolve(opt('from', join(here, '.psgc-cache')));
const outPath = resolve(opt('out', join(here, 'locations.sql')));
const API = 'https://psgc.gitlab.io/api';

async function load(name) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${name}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  process.stderr.write(`fetching ${name}…\n`);
  const res = await fetch(`${API}/${name}.json`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(file, text);
  return JSON.parse(text);
}

const [regions, provinces, citiesMunis, barangays] = await Promise.all([
  load('regions'),
  load('provinces'),
  load('cities-municipalities'),
  load('barangays'),
]);

// Map old 9-digit codes (used for parent references in the API) to 10-digit.
const ten = new Map();
for (const r of regions) ten.set(r.code, r.psgc10DigitCode);
for (const p of provinces) ten.set(p.code, p.psgc10DigitCode);
for (const c of citiesMunis) ten.set(c.code, c.psgc10DigitCode);

const rows = [];
const keepProvince = new Set(provinceFilter);
const keepMuni = new Set();

for (const r of regions) rows.push([r.psgc10DigitCode, null, 'region', r.name]);

for (const p of provinces) {
  if (keepProvince.size && !keepProvince.has(p.psgc10DigitCode)) continue;
  rows.push([p.psgc10DigitCode, ten.get(p.regionCode), 'province', p.name]);
}

for (const c of citiesMunis) {
  // Highly urbanised cities and NCR cities have provinceCode === false; parent them to the region.
  const parent = c.provinceCode ? ten.get(c.provinceCode) : ten.get(c.regionCode);
  const parentProvince = c.provinceCode ? ten.get(c.provinceCode) : null;
  if (keepProvince.size && !(parentProvince && keepProvince.has(parentProvince))) continue;
  keepMuni.add(c.code);
  const name = c.isCity && !/city/i.test(c.name) ? `${c.name} City` : c.name;
  rows.push([c.psgc10DigitCode, parent, 'municipality', name]);
}

for (const b of barangays) {
  const parentOld = b.cityCode || b.municipalityCode || b.subMunicipalityCode;
  if (!parentOld) continue;
  if (keepProvince.size && !keepMuni.has(parentOld)) continue;
  const parent = ten.get(parentOld);
  if (!parent) continue;
  rows.push([b.psgc10DigitCode, parent, 'barangay', b.name]);
}

const q = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const counts = rows.reduce((m, r) => ((m[r[2]] = (m[r[2]] || 0) + 1), m), {});
const header = `-- PSGC locations seed, generated ${new Date().toISOString().slice(0, 10)} by db/seed/psgc.mjs
-- Source: ${API} (mirror of the PSA PSGC publication). Record the PSA quarter here when you load it: [PSGC quarter].
-- Rows: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}${provinceFilter.length ? ` · filtered to provinces ${provinceFilter.join(', ')}` : ''}
-- Load: psql -d lpb -f db/seed/locations.sql   (idempotent)
begin;
create temp table psgc_in (psgc_code text primary key, parent_code text, level location_level, name text) on commit drop;
`;
const chunks = [];
for (let i = 0; i < rows.length; i += 500) {
  const batch = rows.slice(i, i + 500).map((r) => `(${q(r[0])},${q(r[1])},${q(r[2])},${q(r[3])})`).join(',\n');
  chunks.push(`insert into psgc_in values\n${batch};`);
}
const footer = `
-- Parents first so the self-reference holds on an empty table.
insert into locations (psgc_code, parent_code, level, name, active)
select psgc_code, parent_code, level, name, true from psgc_in
order by case level when 'region' then 1 when 'province' then 2 when 'municipality' then 3 else 4 end
on conflict (psgc_code) do update
  set parent_code = excluded.parent_code, level = excluded.level, name = excluded.name, active = true;
${provinceFilter.length ? '-- Filtered load: not deactivating rows outside the filter.' :
`-- Codes no longer in the publication stay (farms may reference them) but are hidden from pickers.
update locations l set active = false
 where l.active and not exists (select 1 from psgc_in i where i.psgc_code = l.psgc_code);`}
commit;
`;
writeFileSync(outPath, header + chunks.join('\n') + footer);
process.stdout.write(`wrote ${outPath}: ${rows.length} rows (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')})\n`);
