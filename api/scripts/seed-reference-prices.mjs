#!/usr/bin/env node
// Gives a province a bottom rung on the price board: one reference price per
// species and hog weight class. Use it when opening a new province before any
// deals have settled there.
//
// The prices you pass are whatever you have: PSA farmgate, a trader survey, or
// placeholders. Whatever you write in --source is shown to farmers under the
// number, so say where it came from and say "placeholder" when it is one.
//
//   node scripts/seed-reference-prices.mjs --province 1206300000 \
//     --admin-email admin@example.ph --admin-password '...' --admin-totp-secret NGUT... \
//     --hog 172 --cattle 148 --carabao 135 --goat 4300 --chicken 340 \
//     --source 'PSA farmgate week 37 2026'
import { totpCode } from '../dist/admin/totp.js';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const API = opt('api', 'http://localhost:3000/v1');
const PROVINCE = opt('province');
const EMAIL = opt('admin-email');
const PASSWORD = opt('admin-password');
const SECRET = opt('admin-totp-secret');
const SOURCE = opt('source', 'PLACEHOLDER, replace with PSA farmgate');
if (!PROVINCE || !EMAIL || !PASSWORD || !SECRET) {
  process.stderr.write('usage: --province <psgc> --admin-email <email> --admin-password <pw> --admin-totp-secret <base32>\n');
  process.stderr.write('       [--hog N] [--cattle N] [--carabao N] [--goat N] [--chicken N] [--source "..."] [--api url]\n');
  process.exit(2);
}

// Hog is the only species with weight classes on the board; the multipliers
// spread one hog price across them the way the demo province is spread.
const HOG_CLASSES = [
  ['', 1],
  ['under 60 kg', 1.076],
  ['60-80 kg', 1.035],
  ['80-100 kg', 1.006],
  ['100-120 kg', 0.988],
  ['over 120 kg', 0.959],
];
const hog = Number(opt('hog', '0'));
const perHead = { goat: Number(opt('goat', '0')), native_chicken: Number(opt('chicken', '0')) };
const perKg = { cattle: Number(opt('cattle', '0')), carabao: Number(opt('carabao', '0')) };

async function call(path, { method = 'GET', token, body, raw } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = raw.contentType;
  const res = await fetch(`${API}${path}`, { method, headers, body: raw ? raw.body : body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const step = await call('/admin/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
const admin = (await call('/admin/auth/totp', { method: 'POST', body: { step_token: step.step_token, code: totpCode(SECRET) } })).access_token;

const province = await call(`/locations/${PROVINCE}`);
if (province.level !== 'province') throw new Error(`${PROVINCE} is a ${province.level}, not a province`);

const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const rows = [];
if (hog > 0) for (const [label, mult] of HOG_CLASSES) rows.push([PROVINCE, 'hog', label, 'per_kg_liveweight', (hog * mult).toFixed(2)]);
for (const [sp, v] of Object.entries(perKg)) if (v > 0) rows.push([PROVINCE, sp, '', 'per_kg_liveweight', v.toFixed(2)]);
for (const [sp, v] of Object.entries(perHead)) if (v > 0) rows.push([PROVINCE, sp, '', 'per_head', v.toFixed(2)]);
if (rows.length === 0) throw new Error('no prices given: pass at least one of --hog --cattle --carabao --goat --chicken');

const csv = ['province_code,species,weight_class_label,unit,price,effective_from,source', ...rows.map((r) => `${r.join(',')},${today},${SOURCE}`)].join('\n');
const out = await call('/admin/reference-prices/import', { method: 'POST', token: admin, raw: { body: csv, contentType: 'text/csv' } });
process.stdout.write(`${province.name}: imported ${out.inserted ?? rows.length} reference prices effective ${today}\n`);
process.stdout.write(`source recorded as: ${SOURCE}\n`);
