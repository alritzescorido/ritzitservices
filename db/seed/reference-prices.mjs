#!/usr/bin/env node
// Turns a CSV of reference prices into db/seed/reference-prices.sql.
//
//   npm run db:seed:reference-prices -- --csv db/seed/reference-prices.template.csv --set-by <admin user uuid>
//
// CSV columns (header required, order free):
//   province_code   10-digit PSGC of the province, e.g. 0304900000
//   species         hog | cattle | carabao | goat | native_chicken
//   weight_class    label from weight_classes for that species ('80-100 kg'), or blank for species-wide
//   unit            per_kg_liveweight | per_head
//   price           pesos, decimal, e.g. 176.00
//   source          free text, e.g. "PSA farmgate week 36 2026"
//   effective_from  YYYY-MM-DD
//
// Source data: PSA OpenSTAT, Agriculture > Prices > Farmgate prices of livestock
// (https://openstat.psa.gov.ph). Export the province rows for the week, map the
// PSA commodity names to our species and weight classes, and save as CSV. The
// mapping is a Phase 0 task (assumption P6 in docs/phase0-field-validation.md);
// the template file shows the shape with placeholder numbers only.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const csvPath = resolve(opt('csv', join(here, 'reference-prices.template.csv')));
const outPath = resolve(opt('out', join(here, 'reference-prices.sql')));
const setBy = opt('set-by', null);
if (!setBy) {
  process.stderr.write('need --set-by <admin user uuid>: reference prices carry who set them for the audit log\n');
  process.exit(2);
}

const SPECIES = new Set(['hog', 'cattle', 'carabao', 'goat', 'native_chicken']);
const UNITS = new Set(['per_kg_liveweight', 'per_head']);

function parseCsv(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const split = (l) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') {
        if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q;
      } else if (c === ',' && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((l, idx) => {
    const cells = split(l);
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ''));
    row._line = idx + 2;
    return row;
  });
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const errors = [];
for (const r of rows) {
  if (!/^\d{10}$/.test(r.province_code)) errors.push(`line ${r._line}: province_code must be 10 digits`);
  if (!SPECIES.has(r.species)) errors.push(`line ${r._line}: unknown species "${r.species}"`);
  if (!UNITS.has(r.unit)) errors.push(`line ${r._line}: unknown unit "${r.unit}"`);
  if (!(Number(r.price) > 0)) errors.push(`line ${r._line}: price must be a positive number`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.effective_from)) errors.push(`line ${r._line}: effective_from must be YYYY-MM-DD`);
  if (!r.source) errors.push(`line ${r._line}: source is required`);
}
if (errors.length) {
  process.stderr.write(errors.join('\n') + '\n');
  process.exit(1);
}

const q = (s) => (s === '' || s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const values = rows.map((r) => {
  const wc = r.weight_class
    ? `(select id from weight_classes where species = ${q(r.species)} and label = ${q(r.weight_class)})`
    : 'null';
  return `  (${q(r.province_code)}, ${q(r.species)}, ${wc}, ${q(r.unit)}, ${Number(r.price).toFixed(2)}, ${q(r.source)}, ${q(r.effective_from)}, ${q(setBy)})`;
});

const sql = `-- Reference prices seed, generated ${new Date().toISOString().slice(0, 10)} by db/seed/reference-prices.mjs from ${csvPath.split(/[\\/]/).pop()}
-- ${rows.length} rows. Each row is a new effective_from entry; the board picks the latest at or before "as of".
-- Load: psql -d lpb -f db/seed/reference-prices.sql
begin;
insert into reference_prices (province_code, species, weight_class_id, unit, price, source, effective_from, set_by) values
${values.join(',\n')};
insert into admin_audit_log (admin_id, action, target_type, target_id, after_json)
values (${q(setBy)}, 'import_reference_prices', 'reference_prices', ${q(csvPath.split(/[\\/]/).pop())},
        jsonb_build_object('rows', ${rows.length}));
commit;
`;
writeFileSync(outPath, sql);
process.stdout.write(`wrote ${outPath}: ${rows.length} rows\n`);
