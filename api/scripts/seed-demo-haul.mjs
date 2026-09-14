#!/usr/bin/env node
// Third seed, run after seed-demo-deals.mjs: registers the demo hauler's truck,
// books a hog deal that wants a hauler, and walks the shipment through
// accept -> pickup checklist -> transit pings -> hand-over, then the buyer
// confirms delivery. The console's Deals detail shows the hauler, permit and
// last position. Development only.
//
//   node scripts/seed-demo-haul.mjs --admin-email admin@example.ph --admin-password '...' --admin-totp-secret NGUT...
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
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);

async function call(path, { method = 'GET', token, body, idem, raw } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idem) headers['Idempotency-Key'] = crypto.randomUUID();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = raw.contentType;
  const payload = raw ? raw.body : body === undefined ? undefined : JSON.stringify(body);
  const url = path.startsWith('http') ? path : `${API}${path}`;
  let res = await fetch(url, { method, headers, body: payload });
  if (res.status === 429) {
    const wait = Math.min(Number(res.headers.get('retry-after') ?? 60), 120);
    process.stdout.write(`rate limited on ${path}, waiting ${wait}s\n`);
    await new Promise((r) => setTimeout(r, wait * 1000 + 500));
    res = await fetch(url, { method, headers, body: payload });
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

async function verifiedToken(phone) {
  const pair = await signIn(phone);
  if (pair.user.verification === 'verified') return pair.access_token;
  const c = await call(`/admin/users/${pair.user.id}`, { token: admin });
  for (const d of c.documents) if (d.status === 'pending') await call(`/admin/documents/${d.id}/review`, { method: 'POST', token: admin, body: { status: 'verified' } });
  await call(`/admin/users/${pair.user.id}/verification`, { method: 'POST', token: admin, idem: true, body: { status: 'verified' } });
  process.stdout.write(`verified ${pair.user.full_name}\n`);
  return (await call('/auth/refresh', { method: 'POST', body: { refresh_token: pair.refresh_token } })).access_token;
}
async function photo(token) {
  const slot = await call('/uploads', { method: 'POST', token, body: { purpose: 'shipment_photo', content_type: 'image/png', byte_size: PNG.length } });
  await call(slot.upload_url, { method: 'PUT', raw: { body: PNG, contentType: 'image/png' } });
  return slot.storage_key;
}

const farmer = await verifiedToken('+639170001002'); // Ramon Bautista
const buyer = await verifiedToken('+639170002001'); // Juan Dela Cruz
const hauler = await verifiedToken('+639170003001'); // Rey Santos

// The hauler's truck. Nueva Ecija is the service area.
const profile = await call('/haulers/me', {
  method: 'PUT',
  token: hauler,
  body: { vehicle_plate: 'NEB 4521', vehicle_type: 'Elf truck', capacity_heads: 20, capacity_kg: '2000', rate_per_head: '150', service_area: ['0304900000'] },
});
process.stdout.write(`hauler profile: ${profile.vehicle_plate}, ${profile.capacity_heads} heads\n`);

// Delivery point: any Nueva Ecija municipality other than Cabanatuan, which the
// first seed put under a hog restriction.
const munis = (await call('/locations?parent=0304900000&limit=50', { token: buyer })).items.filter((m) => m.psgc_code !== '0304903000');
const dropoff = munis.find((m) => /san jose/i.test(m.name)) ?? munis[0];

const farms = (await call('/farms', { token: farmer })).items;
const lots = (await call(`/farms/${farms[0].id}/lots`, { token: farmer })).items;
const hogLot = lots.find((l) => l.species === 'hog');
const heads = Math.min(8, hogLot.head_count);
const pickupDay = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

const listing = await call('/listings', { method: 'POST', token: farmer, idem: true, body: { lot_id: hogLot.id, heads_offered: heads, asking_price: '178.00' } });
const offer = await call(`/listings/${listing.id}/offers`, {
  method: 'POST',
  token: buyer,
  idem: true,
  body: { price: '178.00', heads, needs_hauler: true, pickup_on: pickupDay, dropoff_location_code: dropoff.psgc_code },
});
const deal = await call(`/offers/${offer.id}/accept`, { method: 'POST', token: farmer, idem: true });
process.stdout.write(`deal ${deal.id} accepted: ${heads} hogs, ${listing.location.display_name} -> ${dropoff.name}\n`);

const board = await call('/haul-jobs', { token: hauler });
process.stdout.write(`job board: ${board.items.length} job(s)\n`);
const shipment = await call(`/haul-jobs/${deal.id}/accept`, {
  method: 'POST',
  token: hauler,
  idem: true,
  body: { agreed_fee: String(150 * heads) + '.00', scheduled_pickup_at: `${pickupDay}T06:00:00+08:00` },
});
process.stdout.write(`shipment ${shipment.id}: ${shipment.status}, deal ${shipment.deal_state}\n`);

const loadPhoto = await photo(hauler);
const started = await call(`/shipments/${shipment.id}/start`, {
  method: 'POST',
  token: hauler,
  idem: true,
  body: { shipping_permit_no: 'SP-NE-2026-0917', vet_health_cert_no: 'VHC-NE-4471', head_count: heads, photo_keys: [loadPhoto], geo: { lat: 15.5843, lng: 120.9187 } },
});
process.stdout.write(`trip started: ${started.status}, ${started.head_count_at_pickup} heads, permit ${started.shipping_permit_no}\n`);
await call(`/shipments/${shipment.id}/ping`, { method: 'POST', token: hauler, body: { geo: { lat: 15.62, lng: 120.95 }, kind: 'position' } });
await call(`/shipments/${shipment.id}/ping`, { method: 'POST', token: hauler, body: { geo: { lat: 15.7, lng: 120.98 }, kind: 'checkpoint', note: 'Vet quarantine checkpoint, papers checked' } });
const handoverPhoto = await photo(hauler);
const delivered = await call(`/shipments/${shipment.id}/delivered`, {
  method: 'POST',
  token: hauler,
  idem: true,
  body: { photo_keys: [handoverPhoto], geo: { lat: 15.79, lng: 120.99 }, note: `Unloaded at ${dropoff.name}` },
});
process.stdout.write(`handed over: shipment ${delivered.status}, deal ${delivered.deal_state}\n`);
const confirmed = await call(`/deals/${deal.id}/deliver`, {
  method: 'POST',
  token: buyer,
  idem: true,
  body: { delivered_heads: heads, delivered_weight_kg: String(Math.round(heads * 108 * 10) / 10) },
});
process.stdout.write(`buyer confirmed delivery: deal ${confirmed.state}, ${confirmed.delivered_weight_kg} kg, ${confirmed.final_total}\n`);
process.stdout.write('done. Console: Deals detail shows the hauler, checklist and last position.\n');
