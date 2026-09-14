#!/usr/bin/env node
// Fills a running local API with demo content, through the public endpoints,
// exactly as the mobile app and console would: three farmers with farms, lots
// and a barangay clearance; a buyer and a hauler with pending documents; an
// admin who sets reference prices and one restricted zone.
//
// Requires a dev API with OTP_DEV_CODE=123456 and an existing console admin.
//
//   node scripts/seed-demo.mjs --api http://localhost:3000/v1 \
//     --admin-email admin@example.ph --admin-password '...' --admin-totp-secret NGUT...
import { totpCode } from '../dist/admin/totp.js';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const API = opt('api', 'http://localhost:3000/v1');
const ADMIN_EMAIL = opt('admin-email');
const ADMIN_PASSWORD = opt('admin-password');
const ADMIN_SECRET = opt('admin-totp-secret');
const OTP = opt('otp', '123456');
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_SECRET) {
  process.stderr.write('usage: --admin-email <email> --admin-password <pw> --admin-totp-secret <base32> [--api url] [--otp 123456]\n');
  process.exit(2);
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n%demo\n'), Buffer.alloc(300, 0x20)]);
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

async function call(path, { method = 'GET', token, body, idem, raw } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idem) headers['Idempotency-Key'] = crypto.randomUUID();
  let payload;
  if (raw) {
    headers['Content-Type'] = raw.contentType;
    payload = raw.body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res = await fetch(`${API}${path}`, { method, headers, body: payload });
  if (res.status === 429) {
    // The API's real rate limits apply to the seed too; wait them out once.
    const wait = Math.min(Number(res.headers.get('retry-after') ?? 60), 120);
    process.stdout.write(`rate limited on ${path}, waiting ${wait}s\n`);
    await new Promise((r) => setTimeout(r, wait * 1000 + 500));
    res = await fetch(`${API}${path}`, { method, headers, body: payload });
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function signIn(phone) {
  const req = await call('/auth/otp/request', { method: 'POST', body: { phone } });
  return call('/auth/otp/verify', { method: 'POST', body: { challenge_id: req.challenge_id, code: OTP, device: { device_id: `seed-${phone}`, platform: 'android' } } });
}

async function upload(token, purpose, contentType, bytes) {
  const slot = await call('/uploads', { method: 'POST', token, body: { purpose, content_type: contentType, byte_size: bytes.length } });
  const url = new URL(slot.upload_url);
  const local = `${API.replace(/\/v1$/, '')}${url.pathname}`;
  const res = await fetch(local, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes });
  if (!res.ok) throw new Error(`upload PUT -> ${res.status}`);
  return slot.storage_key;
}

async function person(phone, name, lang, role) {
  const pair = await signIn(phone);
  await call('/me', { method: 'PATCH', token: pair.access_token, body: { full_name: name, preferred_lang: lang } });
  await call('/me/roles', { method: 'POST', token: pair.access_token, body: { role } });
  // Roles live in the access token; rotating the refresh token yields one with the new role
  // (a second OTP within 60 seconds would hit the resend limit, as it should).
  const rotated = await call('/auth/refresh', { method: 'POST', body: { refresh_token: pair.refresh_token } });
  return rotated.access_token;
}

async function document(token, docType, contentType, bytes) {
  const key = await upload(token, 'user_document', contentType, bytes);
  return call('/me/documents', { method: 'POST', token, idem: true, body: { doc_type: docType, storage_key: key } });
}

const talaveraBarangays = (await call('/locations?parent=0304930000&limit=5')).items;
const cabanatuanBarangays = (await call('/locations?parent=0304903000&limit=5')).items;
if (!talaveraBarangays.length) throw new Error('locations are not loaded; run scripts/load-sql.mjs with db/seed/locations.sql first');

// Farmers
const farmers = [
  { phone: '+639170001001', name: 'Maria Santos', farm: 'Maligaya farm', brgy: talaveraBarangays[0].psgc_code, lots: [{ species: 'hog', head_count: 14, avg_weight_kg: '92', age_months: 5 }, { species: 'goat', head_count: 6, avg_weight_kg: '22' }] },
  { phone: '+639170001002', name: 'Ramon Bautista', farm: 'Bautista piggery', brgy: talaveraBarangays[1].psgc_code, lots: [{ species: 'hog', head_count: 25, avg_weight_kg: '88', age_months: 5 }] },
  { phone: '+639170001003', name: 'Lita Ocampo', farm: 'Ocampo backyard', brgy: cabanatuanBarangays[0].psgc_code, lots: [{ species: 'hog', head_count: 6, avg_weight_kg: '110' }, { species: 'native_chicken', head_count: 40 }] },
];
for (const f of farmers) {
  const token = await person(f.phone, f.name, 'fil', 'farmer');
  const farm = await call('/farms', { method: 'POST', token, idem: true, body: { name: f.farm, barangay_code: f.brgy, farm_type: 'backyard', geo: { lat: 15.58, lng: 120.92 } } });
  for (const lot of f.lots) await call(`/farms/${farm.id}/lots`, { method: 'POST', token, idem: true, body: lot });
  await document(token, 'barangay_clearance', 'image/png', PNG);
  process.stdout.write(`farmer ${f.name}: farm ${farm.id}\n`);
}

// Buyer with a complete document set, one of them pending review
const buyer = await person('+639170002001', 'Juan Dela Cruz', 'en', 'buyer');
await document(buyer, 'gov_id', 'image/png', PNG);
await document(buyer, 'selfie_with_id', 'image/png', PNG);
await document(buyer, 'business_permit', 'application/pdf', PDF);
process.stdout.write('buyer Juan Dela Cruz: 3 documents\n');

// Hauler with OR/CR
const hauler = await person('+639170003001', 'Rey Santos', 'fil', 'hauler');
await document(hauler, 'gov_id', 'image/png', PNG);
await document(hauler, 'or_cr', 'application/pdf', PDF);
process.stdout.write('hauler Rey Santos: 2 documents\n');

// Admin: reference prices and a restricted zone
const step = await call('/admin/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
const pair = await call('/admin/auth/totp', { method: 'POST', body: { step_token: step.step_token, code: totpCode(ADMIN_SECRET) } });
const admin = pair.access_token;
const csv = `province_code,species,weight_class_label,unit,price,effective_from,source
0304900000,hog,,per_kg_liveweight,176.00,${today},PSA farmgate week 36 2026 (demo)
0304900000,hog,under 60 kg,per_kg_liveweight,190.00,${today},PSA farmgate week 36 2026 (demo)
0304900000,hog,60-80 kg,per_kg_liveweight,182.00,${today},PSA farmgate week 36 2026 (demo)
0304900000,hog,80-100 kg,per_kg_liveweight,177.00,${today},PSA farmgate week 36 2026 (demo)
0304900000,hog,100-120 kg,per_kg_liveweight,175.00,${today},PSA farmgate week 36 2026 (demo)
0304900000,hog,over 120 kg,per_kg_liveweight,170.00,${today},PSA farmgate week 36 2026 (demo)
0304900000,cattle,,per_kg_liveweight,150.00,${today},PSA farmgate week 36 2026 (demo)
0304900000,goat,,per_head,4500.00,${today},trader survey (demo)
0304900000,native_chicken,,per_head,350.00,${today},trader survey (demo)`;
const imported = await call('/admin/reference-prices/import', { method: 'POST', token: admin, raw: { body: csv, contentType: 'text/csv' } });
process.stdout.write(`reference prices imported: ${imported.inserted}\n`);
await call('/admin/restricted-zones', {
  method: 'POST',
  token: admin,
  idem: true,
  body: { location_code: '0304903000', species: 'hog', reason: 'ASF red zone, BAI memo 2026-41 (demo)', starts_on: today },
});
process.stdout.write('restricted zone: City of Cabanatuan, hog\n');
process.stdout.write('done. Open the console: the verification queue has 5 people waiting.\n');
