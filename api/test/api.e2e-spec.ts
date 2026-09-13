import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

type App = Parameters<typeof request>[0];
import { DbService } from '../src/db/db.service.js';

// Whole API against an in-memory PostgreSQL (PGlite): schema applied from
// db/schema.sql, a small location tree and one reference price seeded here.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'pglite://memory';
process.env.DB_AUTO_SCHEMA = 'true';
process.env.SEED_LOCATIONS_PATH = './does-not-exist.sql'; // keep the test DB small
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
process.env.OTP_PEPPER = 'test-pepper-test-pepper';
process.env.OTP_DEV_CODE = '123456';
process.env.OTP_RESEND_AFTER_SECONDS = '0';

const TALAVERA = '0304930000';
const NUEVA_ECIJA = '0304900000';

describe('Livestock Price Board API (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let hogClass: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    http = app.getHttpServer();

    const db = app.get(DbService);
    await db.query(`
      insert into locations (psgc_code, parent_code, level, name) values
        ('0300000000', null, 'region', 'Central Luzon'),
        ('${NUEVA_ECIJA}', '0300000000', 'province', 'Nueva Ecija'),
        ('${TALAVERA}', '${NUEVA_ECIJA}', 'municipality', 'Talavera'),
        ('0304903000', '${NUEVA_ECIJA}', 'municipality', 'City of Cabanatuan'),
        ('0304930001', '${TALAVERA}', 'barangay', 'Bakal I')`);
    await db.query(`insert into users (id, phone_e164, full_name) values ('00000000-0000-0000-0000-00000000aaaa', '+639000000001', 'Admin Test')`);
    await db.query(`insert into user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000aaaa', 'admin')`);
    const wc = await db.one<{ id: number }>(`select id from weight_classes where species = 'hog' and label = '80-100 kg'`);
    hogClass = Number(wc!.id);
    await db.query(
      `insert into reference_prices (province_code, species, weight_class_id, unit, price, source, effective_from, set_by)
       values ('${NUEVA_ECIJA}', 'hog', null, 'per_kg_liveweight', 176, 'PSA farmgate test', current_date - 7, '00000000-0000-0000-0000-00000000aaaa'),
              ('${NUEVA_ECIJA}', 'hog', ${hogClass}, 'per_kg_liveweight', 177, 'PSA farmgate test', current_date - 1, '00000000-0000-0000-0000-00000000aaaa')`,
    );
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/health reports the database', async () => {
    const res = await request(http).get('/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toContain('pglite');
  });

  it('errors are application/problem+json', async () => {
    const res = await request(http).get('/v1/prices/board').expect(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.status).toBe(400);
    expect(res.body.errors[0].field).toBe('municipality_code');
  });

  it('locations: regions, children, search with display path, single with path', async () => {
    const regions = await request(http).get('/v1/locations').expect(200);
    expect(regions.body.items[0].level).toBe('region');
    expect(regions.body.items[0].has_children).toBe(true);

    const munis = await request(http).get(`/v1/locations?parent=${NUEVA_ECIJA}`).expect(200);
    expect(munis.body.items.map((i: { name: string }) => i.name)).toEqual(['City of Cabanatuan', 'Talavera']);

    const search = await request(http).get('/v1/locations/search?q=tala').expect(200);
    expect(search.body.items[0].display_name).toBe('Talavera, Nueva Ecija');

    const one = await request(http).get(`/v1/locations/0304930001`).expect(200);
    expect(one.body.display_name).toBe('Bakal I, Talavera, Nueva Ecija');
    expect(one.body.path.map((p: { level: string }) => p.level)).toEqual(['region', 'province', 'municipality']);

    await request(http).get('/v1/locations/9999999999').expect(404);
  });

  it('weight classes per species', async () => {
    const res = await request(http).get('/v1/weight-classes?species=hog').expect(200);
    expect(res.body.items.length).toBe(5);
    expect(res.body.items[2]).toMatchObject({ label: '80-100 kg', min_kg: '80', max_kg: '100', unit: 'per_kg_liveweight' });
  });

  it('price board falls back to the reference price and labels it', async () => {
    const res = await request(http).get(`/v1/prices/board?municipality_code=${TALAVERA}&species=hog`).expect(200);
    expect(res.headers.etag).toBeDefined();
    expect(res.body.municipality.name).toBe('Talavera');
    expect(res.body.province.name).toBe('Nueva Ecija');
    const row = res.body.items.find((i: { weight_class: { id: number } }) => i.weight_class.id === hogClass);
    expect(row).toMatchObject({
      source: 'reference',
      location_code: NUEVA_ECIJA,
      location_name: 'Nueva Ecija',
      median_price: '177.00',
      sample_count: 0,
      reference_source: 'PSA farmgate test',
      municipality: { median_price: null, sample_count: 0 },
    });
    expect(row.label.en).toContain('Reference price');
    const under60 = res.body.items.find((i: { weight_class: { label: string } }) => i.weight_class.label === 'under 60 kg');
    expect(under60.median_price).toBe('176.00'); // species-wide row covers classes without their own

    await request(http)
      .get(`/v1/prices/board?municipality_code=${TALAVERA}&species=hog`)
      .set('If-None-Match', res.headers.etag)
      .expect(304);
    await request(http).get(`/v1/prices/board?municipality_code=${NUEVA_ECIJA}`).expect(404);
  });

  it('running price for one class, and history is empty without snapshots', async () => {
    const res = await request(http)
      .get(`/v1/prices/running?municipality_code=${TALAVERA}&species=hog&weight_class_id=${hogClass}`)
      .expect(200);
    expect(res.body.median_price).toBe('177.00');
    expect(res.body.window_days).toBe(7);
    const hist = await request(http).get(`/v1/prices/history?location_code=${TALAVERA}&species=hog`).expect(200);
    expect(hist.body.points).toEqual([]);
  });

  it('OTP sign-in: request, wrong code, right code, me, role, refresh rotation, reuse revokes, logout', async () => {
    const phone = '+639171234567';
    const req = await request(http).post('/v1/auth/otp/request').send({ phone }).expect(202);
    expect(req.body.expires_in_seconds).toBe(300);
    const challenge = req.body.challenge_id;

    const wrong = await request(http).post('/v1/auth/otp/verify').send({ challenge_id: challenge, code: '000000' }).expect(401);
    expect(wrong.body.detail).toContain('4 tries left');

    const ok = await request(http)
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: challenge, code: '123456', device: { device_id: 'dev-1', platform: 'android' } })
      .expect(200);
    expect(ok.body.user.phone_masked).toBe('+63917*****67');
    expect(ok.body.user.roles).toEqual([]);
    expect(ok.body.user.full_name).toBe('');
    const access = ok.body.access_token;
    const refresh = ok.body.refresh_token;

    await request(http).post('/v1/auth/otp/verify').send({ challenge_id: challenge, code: '123456' }).expect(401); // consumed

    await request(http).get('/v1/me').expect(401);
    const me = await request(http).get('/v1/me').set('Authorization', `Bearer ${access}`).expect(200);
    expect(me.body.id).toBe(ok.body.user.id);

    const patched = await request(http)
      .patch('/v1/me')
      .set('Authorization', `Bearer ${access}`)
      .send({ full_name: 'Maria Santos', preferred_lang: 'fil' })
      .expect(200);
    expect(patched.body.full_name).toBe('Maria Santos');

    const role = await request(http).post('/v1/me/roles').set('Authorization', `Bearer ${access}`).send({ role: 'farmer' }).expect(200);
    expect(role.body.roles).toEqual(['farmer']);
    await request(http).post('/v1/me/roles').set('Authorization', `Bearer ${access}`).send({ role: 'admin' }).expect(403);

    const rotated = await request(http).post('/v1/auth/refresh').send({ refresh_token: refresh }).expect(200);
    expect(rotated.body.user.roles).toEqual(['farmer']);
    expect(rotated.body.refresh_token).not.toBe(refresh);

    // Reusing the consumed token revokes the family, so the rotated token dies too.
    await request(http).post('/v1/auth/refresh').send({ refresh_token: refresh }).expect(401);
    await request(http).post('/v1/auth/refresh').send({ refresh_token: rotated.body.refresh_token }).expect(401);

    await request(http).post('/v1/auth/logout').set('Authorization', `Bearer ${access}`).send({}).expect(204);
  });

  it('OTP rate limit: 3 per phone per 10 minutes', async () => {
    const phone = '+639170000002';
    for (let i = 0; i < 3; i++) await request(http).post('/v1/auth/otp/request').send({ phone }).expect(202);
    const limited = await request(http).post('/v1/auth/otp/request').send({ phone }).expect(429);
    expect(limited.headers['retry-after']).toBe('600');
  });

  it('five wrong codes lock the challenge', async () => {
    const phone = '+639170000003';
    const { body } = await request(http).post('/v1/auth/otp/request').send({ phone }).expect(202);
    for (let i = 0; i < 4; i++) {
      await request(http).post('/v1/auth/otp/verify').send({ challenge_id: body.challenge_id, code: '999999' }).expect(401);
    }
    await request(http).post('/v1/auth/otp/verify').send({ challenge_id: body.challenge_id, code: '999999' }).expect(423);
    await request(http).post('/v1/auth/otp/verify').send({ challenge_id: body.challenge_id, code: '123456' }).expect(423);
  });
});
