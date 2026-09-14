#!/usr/bin/env node
// Fourth seed, needs the API running with PAYMENTS_PROVIDER=fake: books a deal
// that asks for a deposit, pays it through the fake gateway, sets the farmer's
// payout account, and leaves the deal booked so the console Deposits page shows
// money held and the Deals detail shows the deposit line. Development only.
//
//   node scripts/seed-demo-deposit.mjs --admin-email admin@example.ph --admin-password '...' --admin-totp-secret NGUT...
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
async function verifiedToken(phone) {
  const pair = await signIn(phone);
  if (pair.user.verification === 'verified') return { token: pair.access_token, name: pair.user.full_name };
  const c = await call(`/admin/users/${pair.user.id}`, { token: admin });
  for (const d of c.documents) if (d.status === 'pending') await call(`/admin/documents/${d.id}/review`, { method: 'POST', token: admin, body: { status: 'verified' } });
  await call(`/admin/users/${pair.user.id}/verification`, { method: 'POST', token: admin, idem: true, body: { status: 'verified' } });
  return { token: (await call('/auth/refresh', { method: 'POST', body: { refresh_token: pair.refresh_token } })).access_token, name: pair.user.full_name };
}

const farmer = await verifiedToken('+639170001003'); // Lita Ocampo
const buyer = await verifiedToken('+639170002001'); // Juan Dela Cruz

const acct = await call('/me/payout-account', { method: 'PUT', token: farmer.token, body: { kind: 'gcash', account_no: '09171234567', account_name: farmer.name } });
process.stdout.write(`payout account for ${farmer.name}: GCash ${acct.account_no_masked}, verified ${acct.verified}\n`);

const farms = (await call('/farms', { token: farmer.token })).items;
const lots = (await call(`/farms/${farms[0].id}/lots`, { token: farmer.token })).items;
const hogLot = lots.find((l) => l.species === 'hog');
const heads = Math.min(6, hogLot.head_count);
const listing = await call('/listings', { method: 'POST', token: farmer.token, idem: true, body: { lot_id: hogLot.id, heads_offered: heads, asking_price: '176.00' } });
const offer = await call(`/listings/${listing.id}/offers`, { method: 'POST', token: buyer.token, idem: true, body: { price: '176.00', heads, needs_hauler: true, dropoff_location_code: '0304930000' } });
const deal = await call(`/offers/${offer.id}/accept`, { method: 'POST', token: farmer.token, idem: true });
if (!deal.deposit) {
  process.stderr.write('no deposit was asked: is the API running with PAYMENTS_PROVIDER=fake?\n');
  process.exit(1);
}
process.stdout.write(`deal ${deal.id}: deposit ${deal.deposit.amount} requested, pay by ${deal.deposit.expires_at}\n`);
const dep = await call(`/deals/${deal.id}/deposit`, { token: buyer.token });
process.stdout.write(`buyer's checkout link: ${dep.checkout_url}\n`);
const centavos = Math.round(Number(dep.amount) * 100);
await call('/payments/webhook', {
  method: 'POST',
  body: { id: `evt_demo_${dep.id}`, type: 'checkout.paid', deposit_id: dep.id, checkout_id: dep.checkout_url.split('/checkout/')[1]?.split('?')[0], amount: centavos, fee: Math.round(centavos * 0.0223), payment_method: 'gcash' },
});
const booked = await call(`/deals/${deal.id}`, { token: farmer.token });
process.stdout.write(`deposit ${booked.deposit.status}: ${booked.deposit.amount} held; deal ${booked.state}, job now on the hauler board\n`);
process.stdout.write('done. Console: Deposits shows the held amount; Deals detail shows the deposit line.\n');
