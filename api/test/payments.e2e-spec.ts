import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AdminAuthService } from '../src/admin/admin-auth.service.js';
import { totpCode } from '../src/admin/totp.js';
import { AppModule } from '../src/app.module.js';
import { DbService } from '../src/db/db.service.js';
import { DepositsService } from '../src/payments/deposits.service.js';

type App = Parameters<typeof request>[0];

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'pglite://memory';
process.env.DB_AUTO_SCHEMA = 'true';
process.env.SEED_LOCATIONS_PATH = './does-not-exist.sql';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
process.env.OTP_PEPPER = 'test-pepper-test-pepper';
process.env.OTP_DEV_CODE = '123456';
process.env.OTP_RESEND_AFTER_SECONDS = '0';
process.env.SCHEDULER_ENABLED = 'false';
process.env.PAYMENTS_PROVIDER = 'fake';
process.env.SETTLEMENTS_PER_BUYER_PER_WEEK = '2';

const NUEVA_ECIJA = '0304900000';
const TALAVERA = '0304930000';
const BAKAL = '0304930001';

describe('Payments: booking deposits, payout accounts, reports, users list (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let db: DbService;
  let farmer: string;
  let buyer: string;
  let hauler: string;
  let admin: string;
  let lotId: string;
  let farmId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const key = () => ({ 'Idempotency-Key': randomUUID() });
  const signIn = async (phone: string) => {
    const req = await request(http).post('/v1/auth/otp/request').send({ phone }).expect(202);
    const ok = await request(http).post('/v1/auth/otp/verify').send({ challenge_id: req.body.challenge_id, code: '123456' }).expect(200);
    return { token: ok.body.access_token as string, refresh: ok.body.refresh_token as string, id: ok.body.user.id as string };
  };
  const person = async (phone: string, name: string, role: string) => {
    const s = await signIn(phone);
    await request(http).patch('/v1/me').set(auth(s.token)).send({ full_name: name }).expect(200);
    await request(http).post('/v1/me/roles').set(auth(s.token)).send({ role }).expect(200);
    await db.query(`update users set verification = 'verified', verified_at = now() where id = $1`, [s.id]);
    const rotated = await request(http).post('/v1/auth/refresh').send({ refresh_token: s.refresh }).expect(200);
    return { token: rotated.body.access_token as string, id: s.id };
  };
  const newLot = async (heads = 20) =>
    (await request(http).post(`/v1/farms/${farmId}/lots`).set(auth(farmer)).set(key()).send({ species: 'hog', head_count: heads, avg_weight_kg: '92' }).expect(201)).body.id as string;
  const accepted = async (lot: string, heads: number, price = '180') => {
    const listing = await request(http).post('/v1/listings').set(auth(farmer)).set(key()).send({ lot_id: lot, heads_offered: heads, asking_price: price }).expect(201);
    const offer = await request(http).post(`/v1/listings/${listing.body.id}/offers`).set(auth(buyer)).set(key()).send({ price, heads, needs_hauler: true }).expect(201);
    return (await request(http).post(`/v1/offers/${offer.body.id}/accept`).set(auth(farmer)).set(key()).expect(201)).body;
  };
  const pay = (deposit: { id: string; amount: string }, eventId = randomUUID()) =>
    request(http)
      .post('/v1/payments/webhook')
      .send({ id: eventId, type: 'checkout.paid', deposit_id: deposit.id, amount: Math.round(Number(deposit.amount) * 100), fee: Math.round(Number(deposit.amount) * 2.23), payment_method: 'gcash' })
      .expect(200);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('v1');
    await app.init();
    http = app.getHttpServer();
    db = app.get(DbService);
    await db.query(`
      insert into locations (psgc_code, parent_code, level, name) values
        ('0300000000', null, 'region', 'Central Luzon'),
        ('${NUEVA_ECIJA}', '0300000000', 'province', 'Nueva Ecija'),
        ('${TALAVERA}', '${NUEVA_ECIJA}', 'municipality', 'Talavera'),
        ('${BAKAL}', '${TALAVERA}', 'barangay', 'Bakal I')`);
    farmer = (await person('+639170006001', 'Maria Santos', 'farmer')).token;
    buyer = (await person('+639170006002', 'Juan Dela Cruz', 'buyer')).token;
    hauler = (await person('+639170006003', 'Rey Santos', 'hauler')).token;
    await request(http).put('/v1/haulers/me').set(auth(hauler)).send({ vehicle_plate: 'NEB 4521', vehicle_type: 'Elf truck', capacity_heads: 20 }).expect(200);
    farmId = (await request(http).post('/v1/farms').set(auth(farmer)).set(key()).send({ name: 'Maligaya farm', barangay_code: BAKAL }).expect(201)).body.id;
    lotId = await newLot(60);
    await app.get(AdminAuthService).createAdmin({ phone: '+639170006009', email: 'admin@example.ph', fullName: 'A. Reyes', password: 'correct horse battery staple' });
    const step = await request(http).post('/v1/admin/auth/login').send({ email: 'admin@example.ph', password: 'correct horse battery staple' }).expect(200);
    admin = (await request(http).post('/v1/admin/auth/totp').send({ step_token: step.body.step_token, code: totpCode(step.body.totp_setup.secret) }).expect(200)).body.access_token;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  let dealId: string;
  let deposit: { id: string; amount: string };

  it('accepting an offer asks the buyer for a 10% deposit within the window; the job is not published yet', async () => {
    const deal = await accepted(lotId, 10); // 10 × 92 kg × ₱180 = ₱165,600 → 10% = ₱16,560
    dealId = deal.id;
    expect(deal.deposit_required).toBe(true);
    expect(deal.deposit).toMatchObject({ status: 'pending', amount: '16560.00', paid_at: null });
    expect(new Date(deal.deposit.expires_at).getTime()).toBeGreaterThan(Date.now() + 100 * 60_000);

    const asBuyer = await request(http).get(`/v1/deals/${dealId}/deposit`).set(auth(buyer)).expect(200);
    expect(asBuyer.body.checkout_url).toContain('/payments/fake/checkout/');
    expect(asBuyer.body.provider).toBe('fake');
    const asFarmer = await request(http).get(`/v1/deals/${dealId}/deposit`).set(auth(farmer)).expect(200);
    expect(asFarmer.body.checkout_url).toBeNull();
    await request(http).get(`/v1/deals/${dealId}/deposit`).set(auth(hauler)).expect(404);
    deposit = asBuyer.body;

    // The hosted page the fake link points at renders and offers to pay.
    const page = await request(http).get(new URL(asBuyer.body.checkout_url).pathname + new URL(asBuyer.body.checkout_url).search).expect(200);
    expect(page.text).toContain('PHP 16560.00');

    // Not on the job board until paid; accepting is refused.
    expect((await request(http).get('/v1/haul-jobs').set(auth(hauler)).expect(200)).body.items).toHaveLength(0);
    const refused = await request(http).post(`/v1/haul-jobs/${dealId}/accept`).set(auth(hauler)).set(key()).send({ agreed_fee: '1500', scheduled_pickup_at: '2026-09-20T06:00:00+08:00' }).expect(409);
    expect(refused.body.detail).toContain('deposit');

    const fresh = await request(http).post(`/v1/deals/${dealId}/deposit/checkout`).set(auth(buyer)).set(key()).expect(200);
    expect(fresh.body.checkout_url).not.toBe(asBuyer.body.checkout_url);
    await request(http).post(`/v1/deals/${dealId}/deposit/checkout`).set(auth(farmer)).set(key()).expect(403);
  });

  it('the paid webhook books the deal, records the ledger, and replays are ignored', async () => {
    const evt = randomUUID();
    const wrongAmount = await request(http).post('/v1/payments/webhook').send({ id: randomUUID(), type: 'checkout.paid', deposit_id: deposit.id, amount: 100, payment_method: 'gcash' }).expect(200);
    expect(wrongAmount.body.replay).toBe(false);
    let d = await request(http).get(`/v1/deals/${dealId}`).set(auth(buyer)).expect(200);
    expect(d.body.deposit.status).toBe('pending'); // rejected: amount mismatch is logged on the event, not applied
    const bad = await db.one<{ error: string }>(`select error from payment_events where event_id = $1`, [wrongAmount.body.replay ? '' : (await db.one<{ event_id: string }>(`select event_id from payment_events where error is not null order by id desc limit 1`))!.event_id]);
    expect(bad?.error).toContain('differs');

    const first = await pay(deposit, evt);
    expect(first.body).toEqual({ received: true, replay: false });
    const again = await pay(deposit, evt);
    expect(again.body.replay).toBe(true);

    d = await request(http).get(`/v1/deals/${dealId}`).set(auth(farmer)).expect(200);
    expect(d.body.deposit).toMatchObject({ status: 'paid', amount: '16560.00' });
    expect(d.body.deposit.paid_at).not.toBeNull();
    expect(d.body.events.some((e: { note: string | null }) => e.note?.includes('deal booked'))).toBe(true);
    const full = await request(http).get(`/v1/deals/${dealId}/deposit`).set(auth(farmer)).expect(200);
    expect(full.body).toMatchObject({ fee: '369.29', net: '16190.71', payment_method: 'gcash' });

    const ledger = await db.query<{ kind: string; amount: string }>(`select kind, amount::text as amount from ledger_entries where deal_id = $1 order by id`, [dealId]);
    expect(ledger.rows).toEqual([
      { kind: 'deposit_in', amount: '16560.00' },
      { kind: 'gateway_fee', amount: '-369.29' },
    ]);

    // Now the hauler sees the job.
    expect((await request(http).get('/v1/haul-jobs').set(auth(hauler)).expect(200)).body.items.map((j: { deal_id: string }) => j.deal_id)).toEqual([dealId]);
  });

  it('a farmer sets a payout account, verified by a one-peso test transfer', async () => {
    await request(http).get('/v1/me/payout-account').set(auth(farmer)).expect(404);
    await request(http).put('/v1/me/payout-account').set(auth(buyer)).send({ kind: 'gcash', account_no: '09171234567', account_name: 'Juan Dela Cruz' }).expect(403);
    const wrongName = await request(http).put('/v1/me/payout-account').set(auth(farmer)).send({ kind: 'gcash', account_no: '09171234567', account_name: 'M. Santos' }).expect(422);
    expect(wrongName.body.errors[0].field).toBe('account_name');
    const badNo = await request(http).put('/v1/me/payout-account').set(auth(farmer)).send({ kind: 'gcash', account_no: '12345678', account_name: 'Maria Santos' }).expect(422);
    expect(badNo.body.errors[0].field).toBe('account_no');
    const refused = await request(http).put('/v1/me/payout-account').set(auth(farmer)).send({ kind: 'gcash', account_no: '09170000000', account_name: 'Maria Santos' }).expect(422);
    expect(refused.body.errors[0].message).toContain('Test transfer failed');
    const noBank = await request(http).put('/v1/me/payout-account').set(auth(farmer)).send({ kind: 'bank', account_no: '001234567890', account_name: 'Maria Santos' }).expect(422);
    expect(noBank.body.errors[0].field).toBe('bank_code');

    const saved = await request(http).put('/v1/me/payout-account').set(auth(farmer)).send({ kind: 'gcash', account_no: '09171234567', account_name: 'Maria Santos' }).expect(200);
    expect(saved.body).toMatchObject({ kind: 'gcash', account_no_masked: '*******4567', verified: true });
    expect((await request(http).get('/v1/me/payout-account').set(auth(farmer)).expect(200)).body.verified).toBe(true);
  });

  it('settlement releases the deposit to the farmer, minus the gateway fee, plus our transfer fee in the ledger', async () => {
    await request(http).post(`/v1/deals/${dealId}/deliver`).set(auth(buyer)).set(key()).send({ delivered_heads: 10, delivered_weight_kg: '918' }).expect(200);
    await request(http).post(`/v1/deals/${dealId}/pay`).set(auth(buyer)).set(key()).send({ method: 'gcash', reference: 'balance 1234' }).expect(200);
    const settled = await request(http).post(`/v1/deals/${dealId}/confirm-payment`).set(auth(farmer)).set(key()).expect(200);
    expect(settled.body.state).toBe('settled');
    expect(settled.body.deposit.status).toBe('released');
    const dep = await request(http).get(`/v1/deals/${dealId}/deposit`).set(auth(farmer)).expect(200);
    expect(dep.body).toMatchObject({ status: 'released', transfer_status: 'succeeded', net: '16190.71' });
    const ledger = await db.query<{ kind: string; amount: string }>(`select kind, amount::text as amount from ledger_entries where deal_id = $1 order by id`, [dealId]);
    expect(ledger.rows.slice(2)).toEqual([
      { kind: 'release', amount: '-16190.71' },
      { kind: 'transfer_fee', amount: '-10.00' },
    ]);
  });

  it('buyer cancel forfeits to the farmer; farmer cancel refunds the buyer; an unpaid deposit lapses and reopens the listing', async () => {
    // Forfeit.
    const lot2 = await newLot(20);
    const d2 = await accepted(lot2, 5);
    await pay(d2.deposit);
    const c2 = await request(http).post(`/v1/deals/${d2.id}/cancel`).set(auth(buyer)).set(key()).send({ reason: 'Found a closer seller' }).expect(200);
    expect(c2.body.deposit.status).toBe('forfeited');
    expect((await request(http).get(`/v1/deals/${d2.id}/deposit`).set(auth(farmer)).expect(200)).body.transfer_status).toBe('succeeded');

    // Refund.
    const lot3 = await newLot(20);
    const d3 = await accepted(lot3, 5);
    await pay(d3.deposit);
    const c3 = await request(http).post(`/v1/deals/${d3.id}/cancel`).set(auth(farmer)).set(key()).send({ reason: 'Hogs got sick' }).expect(200);
    expect(c3.body.deposit.status).toBe('refunded');
    const l3 = await db.query<{ kind: string; amount: string }>(`select kind, amount::text as amount from ledger_entries where deal_id = $1 order by id`, [d3.id]);
    expect(l3.rows.at(-1)).toEqual({ kind: 'refund', amount: '-8280.00' });

    // Lapse: pretend two hours passed, run the sweep.
    const lot4 = await newLot(20);
    const d4 = await accepted(lot4, 5);
    await db.query(`update deposits set expires_at = now() - interval '1 minute' where deal_id = $1`, [d4.id]);
    const swept = await app.get(DepositsService).sweep();
    expect(swept.lapsed).toBe(1);
    const after = await request(http).get(`/v1/deals/${d4.id}`).set(auth(farmer)).expect(200);
    expect(after.body).toMatchObject({ state: 'cancelled', deposit: { status: 'lapsed' } });
    expect(after.body.cancel_reason).toContain('not paid within');
    const listing = await db.one<{ status: string }>(`select status::text as status from listings where id = $1`, [after.body.listing_id]);
    expect(listing?.status).toBe('active');

    // Late payment on a lapsed deposit is recorded but changes nothing.
    await pay(d4.deposit);
    expect((await request(http).get(`/v1/deals/${d4.id}`).set(auth(farmer)).expect(200)).body.deposit.status).toBe('lapsed');
  });

  it('a dispute decides the deposit; the admin sees totals; the buyer over the weekly limit is held out of the board', async () => {
    const lot5 = await newLot(20);
    const d5 = await accepted(lot5, 5);
    await pay(d5.deposit);
    await request(http).post(`/v1/deals/${d5.id}/deliver`).set(auth(buyer)).set(key()).send({ delivered_heads: 4, delivered_weight_kg: '360' }).expect(200);
    const dispute = await request(http).post(`/v1/deals/${d5.id}/dispute`).set(auth(buyer)).set(key()).send({ reason: 'health', details: 'one down' }).expect(201);
    const resolved = await request(http)
      .post(`/v1/admin/disputes/${dispute.body.id}/resolve`)
      .set(auth(admin))
      .set(key())
      .send({ outcome: 'refunded', resolution: 'Vet note confirms one animal unfit; refund.', deposit: 'refund_to_buyer' })
      .expect(200);
    expect(resolved.body.deal.state).toBe('refunded');
    expect((await request(http).get(`/v1/deals/${d5.id}/deposit`).set(auth(buyer)).expect(200)).body.status).toBe('refunded');

    const list = await request(http).get('/v1/admin/deposits').set(auth(admin)).expect(200);
    expect(list.body.items).toHaveLength(5);
    expect(list.body.totals).toMatchObject({ held: '0.00', released: '16190.71', pending_count: 0 });
    expect(Number(list.body.totals.refunded)).toBeCloseTo(8280 * 2, 2);
    const paidOnly = await request(http).get('/v1/admin/deposits?status=forfeited').set(auth(admin)).expect(200);
    expect(paidOnly.body.items).toHaveLength(1);
    await request(http).get('/v1/admin/deposits').set(auth(buyer)).expect(403);

    // Weekly settlement limit is 2 in this test: the third settlement is flagged and kept out of the board.
    for (const n of [1, 2]) {
      const lot = await newLot(20);
      const d = await accepted(lot, 3, `${170 + n}`);
      await pay(d.deposit);
      await request(http).post(`/v1/deals/${d.id}/deliver`).set(auth(buyer)).set(key()).send({ delivered_heads: 3, delivered_weight_kg: '270' }).expect(200);
      await request(http).post(`/v1/deals/${d.id}/pay`).set(auth(buyer)).set(key()).send({ method: 'cash' }).expect(200);
      const s = await request(http).post(`/v1/deals/${d.id}/confirm-payment`).set(auth(farmer)).set(key()).expect(200);
      expect(s.body.counts_for_price).toBe(n === 1); // the 2nd settlement this week already reaches the limit of 2 with the first test's deal
    }
    const flagged = await request(http).get('/v1/admin/deals?outliers_only=true').set(auth(admin)).expect(200);
    expect(flagged.body.items.length).toBeGreaterThanOrEqual(1);
    expect(flagged.body.items[0].counts_for_price).toBe(false);
  });

  it('reports summarise the period; users are listable', async () => {
    const r = await request(http).get(`/v1/admin/reports/summary?province_code=${NUEVA_ECIJA}`).set(auth(admin)).expect(200);
    expect(r.body.deals.by_state.find((s: { state: string }) => s.state === 'settled').count).toBe(3);
    expect(r.body.deals.settled_by_species[0]).toMatchObject({ species: 'hog', deals: 3, heads: 16, unit: 'per_kg_liveweight' });
    expect(Number(r.body.deals.settled_by_species[0].gross_value)).toBeGreaterThan(200000);
    expect(r.body.deals.outliers_pending_review).toBe(1);
    expect(r.body.users.by_role.find((x: { role: string }) => x.role === 'farmer')).toMatchObject({ total: 1, verified: 1, active_in_period: 1 });
    expect(r.body.settlement.settled).toBe(3);
    expect(r.body.settlement.median_hours_accept_to_settle).not.toBeNull();
    expect(r.body.disputes).toMatchObject({ opened: 1, open_now: 0 });
    expect(r.body.disputes.rate_pct).toBeCloseTo(25, 0); // 1 dispute over 4 deliveries
    expect(r.body.deposits).toMatchObject({ asked: 7, paid: 6, lapsed: 1, released: 3, forfeited: 1, refunded: 2, held_net: '0.00' });
    expect(r.body.hauling.deals_needing_hauler).toBe(7);
    expect(r.body.thin_municipalities[0]).toMatchObject({ species: 'hog', needed: 5 });
    expect(r.body.thin_municipalities[0].location.name).toBe('Talavera');

    const csv = await request(http).get(`/v1/admin/reports/deals.csv?state=settled`).set(auth(admin)).expect(200).expect('Content-Type', /text\/csv/);
    const lines = csv.text.trim().split('\n');
    expect(lines[0].startsWith('id,accepted_at,state,species')).toBe(true);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('Maria Santos');

    const users = await request(http).get('/v1/admin/users?role=farmer').set(auth(admin)).expect(200);
    expect(users.body.items).toHaveLength(1);
    expect(users.body.items[0]).toMatchObject({ full_name: 'Maria Santos', province_name: 'Nueva Ecija', deals_count: 7 });
    expect(users.body.items[0].last_seen_at).not.toBeNull();
    const search = await request(http).get('/v1/admin/users?q=Rey%20Santos').set(auth(admin)).expect(200);
    expect(search.body.items.map((u: { full_name: string }) => u.full_name)).toEqual(['Rey Santos']);
    const paged = await request(http).get('/v1/admin/users?limit=2').set(auth(admin)).expect(200);
    expect(paged.body.items).toHaveLength(2);
    expect(paged.body.next_cursor).not.toBeNull();
    await request(http).get('/v1/admin/users').set(auth(farmer)).expect(403);
  });
});
