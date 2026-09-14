#!/usr/bin/env node
// Second seed, run after seed-demo.mjs: verifies the demo farmer and buyer as an
// admin, then walks two deals through the public endpoints. One settles (so a
// price lands in the municipality snapshot), one ends in an open dispute for the
// console to resolve. Development only.
//
//   node scripts/seed-demo-deals.mjs --admin-email admin@example.ph --admin-password '...' --admin-totp-secret NGUT...
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
  process.stderr.write('usage: --admin-email <email> --admin-password <pw> --admin-totp-secret <base32> [--api url]\n');
  process.exit(2);
}

async function call(path, { method = 'GET', token, body, idem } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idem) headers['Idempotency-Key'] = crypto.randomUUID();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 429) {
    const wait = Math.min(Number(res.headers.get('retry-after') ?? 60), 120);
    process.stdout.write(`rate limited on ${path}, waiting ${wait}s\n`);
    await new Promise((r) => setTimeout(r, wait * 1000 + 500));
    res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}
const signIn = async (phone) => {
  const req = await call('/auth/otp/request', { method: 'POST', body: { phone } });
  return call('/auth/otp/verify', { method: 'POST', body: { challenge_id: req.challenge_id, code: OTP } });
};

const step = await call('/admin/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
const admin = (await call('/admin/auth/totp', { method: 'POST', body: { step_token: step.step_token, code: totpCode(ADMIN_SECRET) } })).access_token;

// Sign in as each person; if the admin has not verified them yet, do it now and
// rotate the token so the claims carry the new status (listing and offering need it).
async function verifiedToken(phone) {
  const pair = await signIn(phone);
  if (pair.user.verification === 'verified') return pair.access_token;
  const c = await call(`/admin/users/${pair.user.id}`, { token: admin });
  for (const d of c.documents) if (d.status === 'pending') await call(`/admin/documents/${d.id}/review`, { method: 'POST', token: admin, body: { status: 'verified' } });
  await call(`/admin/users/${pair.user.id}/verification`, { method: 'POST', token: admin, idem: true, body: { status: 'verified' } });
  process.stdout.write(`verified ${pair.user.full_name}\n`);
  return (await call('/auth/refresh', { method: 'POST', body: { refresh_token: pair.refresh_token } })).access_token;
}

const farmer = await verifiedToken('+639170001001'); // Maria Santos
const buyer = await verifiedToken('+639170002001'); // Juan Dela Cruz
const farms = (await call('/farms', { token: farmer })).items;
const lots = (await call(`/farms/${farms[0].id}/lots`, { token: farmer })).items;
const hogLot = lots.find((l) => l.species === 'hog');
const goatLot = lots.find((l) => l.species === 'goat');

// Deal 1: hog, counter, settle.
const l1 = await call('/listings', { method: 'POST', token: farmer, idem: true, body: { lot_id: hogLot.id, heads_offered: 10, asking_price: '180.00' } });
const o1 = await call(`/listings/${l1.id}/offers`, { method: 'POST', token: buyer, idem: true, body: { price: '176.00', heads: 10, needs_hauler: false, pickup_on: '2026-09-20' } });
const c1 = await call(`/offers/${o1.id}/counter`, { method: 'POST', token: farmer, idem: true, body: { price: '180.00', heads: 10, note: 'firm at board' } });
const d1 = await call(`/offers/${c1.id}/accept`, { method: 'POST', token: buyer, idem: true });
await call(`/deals/${d1.id}/deliver`, { method: 'POST', token: buyer, idem: true, body: { delivered_heads: 10, delivered_weight_kg: '918' } });
await call(`/deals/${d1.id}/pay`, { method: 'POST', token: buyer, idem: true, body: { method: 'gcash', reference: '1029 3847 56' } });
const settled = await call(`/deals/${d1.id}/confirm-payment`, { method: 'POST', token: farmer, idem: true });
process.stdout.write(`deal 1 ${settled.state}: 10 hogs, 918 kg at ₱180 = ${settled.final_total}\n`);

// Deal 2: goats, delivered short, disputed.
const l2 = await call('/listings', { method: 'POST', token: farmer, idem: true, body: { lot_id: goatLot.id, heads_offered: 6, asking_price: '4500.00' } });
const o2 = await call(`/listings/${l2.id}/offers`, { method: 'POST', token: buyer, idem: true, body: { price: '4200.00', heads: 6, needs_hauler: false } });
const d2 = await call(`/offers/${o2.id}/accept`, { method: 'POST', token: farmer, idem: true });
await call(`/deals/${d2.id}/deliver`, { method: 'POST', token: buyer, idem: true, body: { delivered_heads: 5, note: 'One goat down at unloading, refused it' } });
const dispute = await call(`/deals/${d2.id}/dispute`, { method: 'POST', token: buyer, idem: true, body: { reason: 'health', details: 'One of six goats could not stand at unloading. Paying for five.' } });
process.stdout.write(`deal 2 disputed: ${dispute.id}\n`);
process.stdout.write('done. Console: Deals shows both, Disputes has one open.\n');
