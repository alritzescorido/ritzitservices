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
process.env.COMMISSION_PERCENT = '0';

const NUEVA_ECIJA = '0304900000';
const TALAVERA = '0304930000';
const BAKAL = '0304930001';

describe('Settings an admin changes without a deploy (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let db: DbService;
  let admin: string;
  let farmer: string;
  let farmId: string;
  let plainUserId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const key = () => ({ 'Idempotency-Key': randomUUID() });
  const person = async (phone: string, name: string, role: string, verify = true) => {
    const req = await request(http).post('/v1/auth/otp/request').send({ phone }).expect(202);
    const ok = await request(http).post('/v1/auth/otp/verify').send({ challenge_id: req.body.challenge_id, code: '123456' }).expect(200);
    await request(http).patch('/v1/me').set(auth(ok.body.access_token)).send({ full_name: name }).expect(200);
    await request(http).post('/v1/me/roles').set(auth(ok.body.access_token)).send({ role }).expect(200);
    if (verify) await db.query(`update users set verification = 'verified', verified_at = now() where id = $1`, [ok.body.user.id]);
    const rotated = await request(http).post('/v1/auth/refresh').send({ refresh_token: ok.body.refresh_token }).expect(200);
    return { token: rotated.body.access_token as string, id: ok.body.user.id as string };
  };
  const setting = (items: Record<string, unknown>[], k: string) => items.find((i) => i.key === k) as Record<string, string & number & boolean> | undefined;

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
    const f = await person('+639170008001', 'Maria Santos', 'farmer');
    farmer = f.token;
    farmId = (await request(http).post('/v1/farms').set(auth(farmer)).set(key()).send({ name: 'Maligaya farm', barangay_code: BAKAL }).expect(201)).body.id;
    // Someone pending with no documents at all.
    plainUserId = (await person('+639170008003', 'Walang Papel', 'farmer', false)).id;
    await app.get(AdminAuthService).createAdmin({ phone: '+639170008009', email: 'admin@example.ph', fullName: 'A. Reyes', password: 'correct horse battery staple' });
    const step = await request(http).post('/v1/admin/auth/login').send({ email: 'admin@example.ph', password: 'correct horse battery staple' }).expect(200);
    admin = (await request(http).post('/v1/admin/auth/totp').send({ step_token: step.body.step_token, code: totpCode(step.body.totp_setup.secret) }).expect(200)).body.access_token;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('starts from the environment and says so, and only an admin may read or write', async () => {
    const r = await request(http).get('/v1/admin/settings').set(auth(admin)).expect(200);
    const commission = setting(r.body.items, 'commission_percent')!;
    expect(commission).toMatchObject({ value: 0, type: 'number', set_by_admin: false, updated_by_name: null });
    expect(commission.label).toBe('Platform commission');
    expect(commission.help).toContain('Never taken from the farmer');
    expect(setting(r.body.items, 'require_documents')).toMatchObject({ value: true, type: 'boolean', set_by_admin: false });

    await request(http).get('/v1/admin/settings').set(auth(farmer)).expect(403);
    await request(http).patch('/v1/admin/settings').set(auth(farmer)).send({ key: 'commission_percent', value: 5 }).expect(403);
  });

  it('the apps can read the ID requirement before anyone signs in, and nothing else', async () => {
    const pub = await request(http).get('/v1/settings').expect(200);
    expect(pub.body).toEqual({ require_documents: true });
    expect(pub.body.commission_percent).toBeUndefined(); // pricing is not public
  });

  it('refuses a rate outside the allowed range and an unknown key', async () => {
    const tooHigh = await request(http).patch('/v1/admin/settings').set(auth(admin)).send({ key: 'commission_percent', value: 25 }).expect(422);
    expect(tooHigh.body.errors[0].field).toBe('commission_percent');
    await request(http).patch('/v1/admin/settings').set(auth(admin)).send({ key: 'commission_percent', value: -1 }).expect(422);
    const unknown = await request(http).patch('/v1/admin/settings').set(auth(admin)).send({ key: 'discount_percent', value: 1 }).expect(422);
    expect(unknown.body.errors[0].message).toContain('Unknown setting');
  });

  it('a rate set in the console is charged on the next deal, and the change is audited', async () => {
    const saved = await request(http).patch('/v1/admin/settings').set(auth(admin)).send({ key: 'commission_percent', value: 2 }).expect(200);
    expect(setting(saved.body.items, 'commission_percent')).toMatchObject({ value: 2, set_by_admin: true, updated_by_name: 'A. Reyes' });

    const lot = (await request(http).post(`/v1/farms/${farmId}/lots`).set(auth(farmer)).set(key()).send({ species: 'hog', head_count: 10, avg_weight_kg: '92' }).expect(201)).body.id;
    const buyer = (await person('+639170008002', 'Juan Dela Cruz', 'buyer')).token;
    const listing = await request(http).post('/v1/listings').set(auth(farmer)).set(key()).send({ lot_id: lot, heads_offered: 10, asking_price: '180' }).expect(201);
    const offer = await request(http).post(`/v1/listings/${listing.body.id}/offers`).set(auth(buyer)).set(key()).send({ price: '180', heads: 10, needs_hauler: false }).expect(201);
    const deal = await request(http).post(`/v1/offers/${offer.body.id}/accept`).set(auth(farmer)).set(key()).expect(201);

    // 10 x 92 kg x 180 = 165,600. Booking is 16,560 and 2% commission is 3,312.
    expect(deal.body.deposit).toMatchObject({ booking: '16560.00', commission: '3312.00', amount: '19872.00' });

    const audit = await request(http).get('/v1/admin/audit-log?action=set_setting').set(auth(admin)).expect(200);
    expect(audit.body.items[0]).toMatchObject({ action: 'set_setting', target_id: 'commission_percent', admin_name: 'A. Reyes' });
    expect(audit.body.items[0].before).toEqual({ value: 0 });
    expect(audit.body.items[0].after).toEqual({ value: 2 });
  });

  it('turning the ID requirement off lets someone with no documents reach the queue', async () => {
    const withRule = await request(http).get('/v1/admin/verification-queue').set(auth(admin)).expect(200);
    expect(withRule.body.items.map((i: { user: { id: string } }) => i.user.id)).not.toContain(plainUserId);

    await request(http).patch('/v1/admin/settings').set(auth(admin)).send({ key: 'require_documents', value: false }).expect(200);
    expect((await request(http).get('/v1/settings').expect(200)).body).toEqual({ require_documents: false });

    const without = await request(http).get('/v1/admin/verification-queue').set(auth(admin)).expect(200);
    expect(without.body.items.map((i: { user: { id: string } }) => i.user.id)).toContain(plainUserId);

    // And the admin can verify them, which is the point of switching it off.
    await request(http).post(`/v1/admin/users/${plainUserId}/verification`).set(auth(admin)).set(key()).send({ status: 'verified', notes: 'Known to the barangay captain' }).expect(200);
    const after = await request(http).get(`/v1/admin/users/${plainUserId}`).set(auth(admin)).expect(200);
    expect(after.body.user.verification).toBe('verified');

    await request(http).patch('/v1/admin/settings').set(auth(admin)).send({ key: 'require_documents', value: true }).expect(200);
  });
});
