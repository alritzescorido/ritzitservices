import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AdminAuthService } from '../src/admin/admin-auth.service.js';
import { totpCode } from '../src/admin/totp.js';
import { AppModule } from '../src/app.module.js';
import { DbService } from '../src/db/db.service.js';

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
process.env.COMMISSION_PERCENT = '1.5';

const NUEVA_ECIJA = '0304900000';
const TALAVERA = '0304930000';
const BAKAL = '0304930001';

// A 10-head hog deal at 92 kg average and 180 pesos a kilo is worth 165,600.
// Booking is 10% of that, 16,560. Commission at 1.5% is 2,484. The buyer pays
// 19,044 and the farmer is promised 16,560, never less.
const EST = 165_600;
const BOOKING = '16560.00';
const COMMISSION = '2484.00';
const CHARGED = '19044.00';

describe('Commission: the platform fee rides on the deposit and is earned on settlement (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let db: DbService;
  let farmer: string;
  let buyer: string;
  let admin: string;
  let farmId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const key = () => ({ 'Idempotency-Key': randomUUID() });
  const person = async (phone: string, name: string, role: string) => {
    const req = await request(http).post('/v1/auth/otp/request').send({ phone }).expect(202);
    const ok = await request(http).post('/v1/auth/otp/verify').send({ challenge_id: req.body.challenge_id, code: '123456' }).expect(200);
    await request(http).patch('/v1/me').set(auth(ok.body.access_token)).send({ full_name: name }).expect(200);
    await request(http).post('/v1/me/roles').set(auth(ok.body.access_token)).send({ role }).expect(200);
    await db.query(`update users set verification = 'verified', verified_at = now() where id = $1`, [ok.body.user.id]);
    const rotated = await request(http).post('/v1/auth/refresh').send({ refresh_token: ok.body.refresh_token }).expect(200);
    return { token: rotated.body.access_token as string, id: ok.body.user.id as string };
  };
  const newLot = async () => (await request(http).post(`/v1/farms/${farmId}/lots`).set(auth(farmer)).set(key()).send({ species: 'hog', head_count: 10, avg_weight_kg: '92' }).expect(201)).body.id as string;
  const accepted = async () => {
    const lot = await newLot();
    const listing = await request(http).post('/v1/listings').set(auth(farmer)).set(key()).send({ lot_id: lot, heads_offered: 10, asking_price: '180' }).expect(201);
    const offer = await request(http).post(`/v1/listings/${listing.body.id}/offers`).set(auth(buyer)).set(key()).send({ price: '180', heads: 10, needs_hauler: false }).expect(201);
    return (await request(http).post(`/v1/offers/${offer.body.id}/accept`).set(auth(farmer)).set(key()).expect(201)).body;
  };
  const pay = (deposit: { id: string; amount: string }) =>
    request(http)
      .post('/v1/payments/webhook')
      .send({ id: randomUUID(), type: 'checkout.paid', deposit_id: deposit.id, amount: Math.round(Number(deposit.amount) * 100), fee: 0, payment_method: 'gcash' })
      .expect(200);
  const ledger = async (dealId: string) => (await db.query<{ kind: string; amount: string }>(`select kind, amount::text as amount from ledger_entries where deal_id = $1 order by id`, [dealId])).rows;

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
    farmer = (await person('+639170007001', 'Maria Santos', 'farmer')).token;
    buyer = (await person('+639170007002', 'Juan Dela Cruz', 'buyer')).token;
    farmId = (await request(http).post('/v1/farms').set(auth(farmer)).set(key()).send({ name: 'Maligaya farm', barangay_code: BAKAL }).expect(201)).body.id;
    await request(http).put('/v1/me/payout-account').set(auth(farmer)).send({ kind: 'gcash', account_no: '09171234567', account_name: 'Maria Santos' }).expect(200);
    await app.get(AdminAuthService).createAdmin({ phone: '+639170007009', email: 'admin@example.ph', fullName: 'A. Reyes', password: 'correct horse battery staple' });
    const step = await request(http).post('/v1/admin/auth/login').send({ email: 'admin@example.ph', password: 'correct horse battery staple' }).expect(200);
    admin = (await request(http).post('/v1/admin/auth/totp').send({ step_token: step.body.step_token, code: totpCode(step.body.totp_setup.secret) }).expect(200)).body.access_token;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('the fee is added on top of the booking, so the farmer is promised the full 10%', async () => {
    const deal = await accepted();
    expect(deal.deposit).toMatchObject({ status: 'pending', amount: CHARGED, booking: BOOKING, commission: COMMISSION });
    // 1.5% of 165,600 is 2,484, and the booking is untouched by it.
    expect(Number(deal.deposit.commission)).toBeCloseTo(EST * 0.015, 2);
    expect(Number(deal.deposit.amount)).toBeCloseTo(Number(BOOKING) + Number(COMMISSION), 2);
    const note = deal.events.find((e: { note: string | null }) => e.note?.includes('platform fee'));
    expect(note.note).toContain('₱16,560.00 held for the farmer');
    expect(note.note).toContain('₱2,484.00 platform fee at 1.5%');
  });

  it('on settlement the farmer receives the booking and the platform keeps the fee', async () => {
    const deal = await accepted();
    await pay(deal.deposit);
    await request(http).post(`/v1/deals/${deal.id}/deliver`).set(auth(buyer)).set(key()).send({ delivered_heads: 10, delivered_weight_kg: '920' }).expect(200);
    await request(http).post(`/v1/deals/${deal.id}/pay`).set(auth(buyer)).set(key()).send({ method: 'gcash' }).expect(200);
    const settled = await request(http).post(`/v1/deals/${deal.id}/confirm-payment`).set(auth(farmer)).set(key()).expect(200);
    expect(settled.body.deposit.status).toBe('released');

    const rows = await ledger(deal.id);
    expect(rows).toEqual([
      { kind: 'deposit_in', amount: CHARGED },
      { kind: 'release', amount: `-${BOOKING}` }, // the farmer's share only
      { kind: 'transfer_fee', amount: '-10.00' },
    ]);
    // What stays in the wallet is the commission less our own transfer cost.
    const balance = rows.reduce((n, r) => n + Number(r.amount), 0);
    expect(balance).toBeCloseTo(Number(COMMISSION) - 10, 2);
  });

  it('a buyer who walks away forfeits the whole charge to the farmer: no fee on a dead deal', async () => {
    const deal = await accepted();
    await pay(deal.deposit);
    const cancelled = await request(http).post(`/v1/deals/${deal.id}/cancel`).set(auth(buyer)).set(key()).send({ reason: 'Found a closer seller' }).expect(200);
    expect(cancelled.body.deposit.status).toBe('forfeited');

    const rows = await ledger(deal.id);
    expect(rows.find((r) => r.kind === 'forfeit_payout')?.amount).toBe(`-${CHARGED}`);
    const balance = rows.reduce((n, r) => n + Number(r.amount), 0);
    expect(balance).toBeCloseTo(-10, 2); // only our transfer cost: the platform earns nothing
  });

  it('a farmer who cancels means the buyer is refunded the fee as well', async () => {
    const deal = await accepted();
    await pay(deal.deposit);
    const cancelled = await request(http).post(`/v1/deals/${deal.id}/cancel`).set(auth(farmer)).set(key()).send({ reason: 'Hogs got sick' }).expect(200);
    expect(cancelled.body.deposit.status).toBe('refunded');
    const rows = await ledger(deal.id);
    expect(rows.find((r) => r.kind === 'refund')?.amount).toBe(`-${CHARGED}`);
    const balance = rows.reduce((n, r) => n + Number(r.amount), 0);
    expect(balance).toBeCloseTo(0, 2); // nothing kept, nothing lost
  });

  it('admin totals and reports count only the commission actually earned', async () => {
    const list = await request(http).get('/v1/admin/deposits').set(auth(admin)).expect(200);
    // One settled, one forfeited, one refunded, one still pending from the first test.
    expect(list.body.totals.commission_earned).toBe(COMMISSION);
    expect(list.body.totals.pending_count).toBe(1);

    const report = await request(http).get('/v1/admin/reports/summary').set(auth(admin)).expect(200);
    expect(report.body.deposits.commission_earned).toBe(COMMISSION);
    expect(report.body.deposits.released).toBe(1);
    expect(report.body.deposits.forfeited).toBe(1);
    expect(report.body.deposits.refunded).toBe(1);
  });
});
