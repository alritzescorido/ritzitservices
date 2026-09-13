import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DbService } from '../src/db/db.service.js';

type App = Parameters<typeof request>[0];

const uploadDir = mkdtempSync(join(tmpdir(), 'lpb-admin-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'pglite://memory';
process.env.DB_AUTO_SCHEMA = 'true';
process.env.SEED_LOCATIONS_PATH = './does-not-exist.sql';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
process.env.OTP_PEPPER = 'test-pepper-test-pepper';
process.env.OTP_DEV_CODE = '123456';
process.env.OTP_RESEND_AFTER_SECONDS = '0';
process.env.UPLOAD_DIR = uploadDir;
process.env.PUBLIC_BASE_URL = 'http://api.test';

const NUEVA_ECIJA = '0304900000';
const TALAVERA = '0304930000';
const BAKAL = '0304930001';
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0x20)]);
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe('Admin console endpoints (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let adminToken: string;
  let farmerToken: string;
  let farmerId: string;
  let documentId: string;

  const signIn = async (phone: string) => {
    const req = await request(http).post('/v1/auth/otp/request').send({ phone }).expect(202);
    const ok = await request(http).post('/v1/auth/otp/verify').send({ challenge_id: req.body.challenge_id, code: '123456' }).expect(200);
    return { token: ok.body.access_token as string, id: ok.body.user.id as string };
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const key = () => ({ 'Idempotency-Key': randomUUID() });

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
        ('${BAKAL}', '${TALAVERA}', 'barangay', 'Bakal I')`);

    // Admin: created out of band (no self-registration), then signs in by OTP like everyone else for now.
    const admin = await signIn('+639170000201');
    await db.query(`update users set full_name = 'A. Reyes', verification = 'verified' where id = $1`, [admin.id]);
    await db.query(`insert into user_roles (user_id, role) values ($1, 'admin')`, [admin.id]);
    adminToken = (await signIn('+639170000201')).token;

    // Farmer with a farm and one pending document.
    const farmer = await signIn('+639170000202');
    farmerId = farmer.id;
    await request(http).post('/v1/me/roles').set(auth(farmer.token)).send({ role: 'farmer' }).expect(200);
    farmerToken = (await signIn('+639170000202')).token;
    await request(http).post('/v1/farms').set(auth(farmerToken)).set(key()).send({ name: 'Maligaya farm', barangay_code: BAKAL }).expect(201);
    const slot = await request(http).post('/v1/uploads').set(auth(farmerToken)).send({ purpose: 'user_document', content_type: 'application/pdf', byte_size: PDF.length }).expect(201);
    await request(http).put(slot.body.upload_url.replace('http://api.test', '')).set('Content-Type', 'application/pdf').send(PDF).expect(200);
    const doc = await request(http).post('/v1/me/documents').set(auth(farmerToken)).set(key()).send({ doc_type: 'barangay_clearance', storage_key: slot.body.storage_key }).expect(201);
    documentId = doc.body.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('admin routes need the admin role', async () => {
    await request(http).get('/v1/admin/verification-queue').set(auth(farmerToken)).expect(403);
    await request(http).get('/v1/admin/verification-queue').expect(401);
  });

  it('lists the verification queue and the case detail', async () => {
    const queue = await request(http).get('/v1/admin/verification-queue?role=farmer').set(auth(adminToken)).expect(200);
    expect(queue.body.items).toHaveLength(1);
    expect(queue.body.items[0].user.id).toBe(farmerId);
    expect(queue.body.items[0].documents[0].status).toBe('pending');
    expect(queue.body.items[0].farms[0].name).toBe('Maligaya farm');
    expect(queue.body.items[0].oldest_pending_at).toBeTruthy();

    const byProvince = await request(http).get(`/v1/admin/verification-queue?province_code=${NUEVA_ECIJA}`).set(auth(adminToken)).expect(200);
    expect(byProvince.body.items).toHaveLength(1);
    const other = await request(http).get('/v1/admin/verification-queue?province_code=9999999999').set(auth(adminToken)).expect(200);
    expect(other.body.items).toHaveLength(0);
  });

  it('reviews a document, views its file through a signed URL, and verifies the user', async () => {
    const file = await request(http).get(`/v1/admin/documents/${documentId}/file`).set(auth(adminToken)).expect(200);
    const fetched = await request(http).get(file.body.url.replace('http://api.test', '')).expect(200);
    expect(fetched.headers['content-type']).toContain('application/pdf');

    const reviewed = await request(http).post(`/v1/admin/documents/${documentId}/review`).set(auth(adminToken)).send({ status: 'verified' }).expect(200);
    expect(reviewed.body.status).toBe('verified');

    const k = randomUUID();
    const verified = await request(http)
      .post(`/v1/admin/users/${farmerId}/verification`)
      .set(auth(adminToken))
      .set('Idempotency-Key', k)
      .send({ status: 'verified' })
      .expect(200);
    expect(verified.body.verification).toBe('verified');
    expect(verified.body.verified_at).toBeTruthy();

    const gone = await request(http).get('/v1/admin/verification-queue').set(auth(adminToken)).expect(200);
    expect(gone.body.items).toHaveLength(0);

    const rejected = await request(http)
      .post(`/v1/admin/users/${farmerId}/verification`)
      .set(auth(adminToken))
      .set(key())
      .send({ status: 'rejected', notes: 'Permit photo unreadable' })
      .expect(200);
    expect(rejected.body.verification_notes).toBe('Permit photo unreadable');
    const me = await request(http).get('/v1/me').set(auth(farmerToken)).expect(200);
    expect(me.body.verification_notes).toBe('Permit photo unreadable');
  });

  it('sets reference prices, flags large changes, and feeds the board', async () => {
    const first = await request(http)
      .post('/v1/admin/reference-prices')
      .set(auth(adminToken))
      .set(key())
      .send({ province_code: NUEVA_ECIJA, species: 'hog', unit: 'per_kg_liveweight', price: '177.00', source: 'PSA farmgate week 36', effective_from: today })
      .expect(201);
    expect(first.body.large_change).toBe(false);
    expect(first.body.previous_price).toBeNull();

    const big = await request(http)
      .post('/v1/admin/reference-prices')
      .set(auth(adminToken))
      .set(key())
      .send({ province_code: NUEVA_ECIJA, species: 'hog', unit: 'per_kg_liveweight', price: '250.00', source: 'typo test', effective_from: today })
      .expect(201);
    expect(big.body.large_change).toBe(true);
    expect(big.body.previous_price).toBe('177.00');

    const old = await request(http)
      .post('/v1/admin/reference-prices')
      .set(auth(adminToken))
      .set(key())
      .send({ province_code: NUEVA_ECIJA, species: 'hog', unit: 'per_kg_liveweight', price: '170.00', source: 'x', effective_from: daysAgo(30) })
      .expect(422);
    expect(old.body.errors[0].field).toBe('effective_from');

    const notProvince = await request(http)
      .post('/v1/admin/reference-prices')
      .set(auth(adminToken))
      .set(key())
      .send({ province_code: TALAVERA, species: 'hog', unit: 'per_kg_liveweight', price: '170.00', source: 'x', effective_from: today })
      .expect(422);
    expect(notProvince.body.errors[0].field).toBe('province_code');

    const current = await request(http).get(`/v1/admin/reference-prices?province_code=${NUEVA_ECIJA}`).set(auth(adminToken)).expect(200);
    expect(current.body.items).toHaveLength(1);
    expect(current.body.items[0].price).toBe('250.00');
    const history = await request(http).get(`/v1/admin/reference-prices?province_code=${NUEVA_ECIJA}&include_history=true`).set(auth(adminToken)).expect(200);
    expect(history.body.items).toHaveLength(2);

    const board = await request(http).get(`/v1/prices/running?municipality_code=${TALAVERA}&species=hog`).expect(200);
    expect(board.body.median_price).toBe('250.00');
    expect(board.body.reference_source).toBe('typo test');
  });

  it('imports a CSV as a whole or not at all', async () => {
    const bad = `province_code,species,weight_class_label,unit,price,effective_from,source
${NUEVA_ECIJA},hog,80-100 kg,per_kg_liveweight,177.00,${today},PSA
${NUEVA_ECIJA},hog,giant,per_kg_liveweight,177.00,${today},PSA
${NUEVA_ECIJA},hog,,per_kg_liveweight,abc,${today},PSA`;
    const res = await request(http).post('/v1/admin/reference-prices/import').set(auth(adminToken)).set('Content-Type', 'text/csv').send(bad).expect(422);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(['line 3', 'line 4']);
    const before = await request(http).get(`/v1/admin/reference-prices?include_history=true`).set(auth(adminToken)).expect(200);
    expect(before.body.items).toHaveLength(2); // nothing written

    const good = `province_code,species,weight_class_label,unit,price,effective_from,source
${NUEVA_ECIJA},hog,80-100 kg,per_kg_liveweight,177.00,${today},PSA farmgate week 36
${NUEVA_ECIJA},goat,,per_head,4500.00,${today},trader survey`;
    const ok = await request(http).post('/v1/admin/reference-prices/import').set(auth(adminToken)).set('Content-Type', 'text/csv').send(good).expect(201);
    expect(ok.body.inserted).toBe(2);
    expect(ok.body.large_changes).toEqual([]);
  });

  it('manages restricted zones and refreshes snapshots, all audited', async () => {
    const zone = await request(http)
      .post('/v1/admin/restricted-zones')
      .set(auth(adminToken))
      .set(key())
      .send({ location_code: TALAVERA, species: 'hog', reason: 'ASF red zone, BAI memo 2026-41', starts_on: daysAgo(2) })
      .expect(201);
    expect(zone.body.location.display_name).toBe('Talavera, Nueva Ecija');
    expect(zone.body.ends_on).toBeNull();

    const active = await request(http).get(`/v1/admin/restricted-zones?active_on=${today}`).set(auth(adminToken)).expect(200);
    expect(active.body.items).toHaveLength(1);
    const ended = await request(http).patch(`/v1/admin/restricted-zones/${zone.body.id}`).set(auth(adminToken)).send({ ends_on: daysAgo(1) }).expect(200);
    expect(ended.body.ends_on).toBe(daysAgo(1));
    const none = await request(http).get(`/v1/admin/restricted-zones?active_on=${today}`).set(auth(adminToken)).expect(200);
    expect(none.body.items).toHaveLength(0);

    const refreshed = await request(http).post('/v1/admin/price-snapshots/refresh').set(auth(adminToken)).send({}).expect(200);
    expect(refreshed.body.rows).toBe(0); // no settled deals yet

    const log = await request(http).get('/v1/admin/audit-log?limit=100').set(auth(adminToken)).expect(200);
    const actions = log.body.items.map((i: { action: string }) => i.action);
    for (const a of ['view_document', 'review_document', 'set_verification', 'set_reference_price', 'import_reference_prices', 'create_restricted_zone', 'end_restricted_zone', 'refresh_snapshots']) {
      expect(actions).toContain(a);
    }
    expect(log.body.items[0].admin_name).toBe('A. Reyes');
    const filtered = await request(http).get('/v1/admin/audit-log?action=set_verification').set(auth(adminToken)).expect(200);
    expect(filtered.body.items).toHaveLength(2);
  });
});
