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

const uploadDir = mkdtempSync(join(tmpdir(), 'lpb-uploads-'));
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
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(92, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(120, 0x20)]);

describe('Farms, lots, uploads, documents and sync (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let farmerToken: string;
  let farmerId: string;
  let plainToken: string;

  const signIn = async (phone: string) => {
    const req = await request(http).post('/v1/auth/otp/request').send({ phone }).expect(202);
    const ok = await request(http).post('/v1/auth/otp/verify').send({ challenge_id: req.body.challenge_id, code: '123456' }).expect(200);
    return { token: ok.body.access_token as string, id: ok.body.user.id as string };
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const localPath = (url: string) => url.replace('http://api.test', '');

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
    const f = await signIn('+639170000101');
    farmerToken = f.token;
    farmerId = f.id;
    await request(http).post('/v1/me/roles').set(auth(farmerToken)).send({ role: 'farmer' }).expect(200);
    // roles live in the token, so sign in again to carry the farmer role
    farmerToken = (await signIn('+639170000101')).token;
    plainToken = (await signIn('+639170000102')).token;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  let farmId: string;
  let lotId: string;

  it('creates a farm with an idempotency key and replays it safely', async () => {
    const body = { name: 'Maligaya farm', barangay_code: BAKAL, farm_type: 'backyard', geo: { lat: 15.58, lng: 120.92 } };
    await request(http).post('/v1/farms').set(auth(farmerToken)).send(body).expect(400); // key required
    await request(http).post('/v1/farms').set(auth(plainToken)).set('Idempotency-Key', randomUUID()).send(body).expect(403); // needs farmer role

    const key = randomUUID();
    const created = await request(http).post('/v1/farms').set(auth(farmerToken)).set('Idempotency-Key', key).send(body).expect(201);
    farmId = created.body.id;
    expect(created.body).toMatchObject({ version: 1, owner_id: farmerId, farm_type: 'backyard', photo_keys: [], lot_summary: [] });
    expect(created.body.location.display_name).toBe('Bakal I, Talavera, Nueva Ecija');
    expect(created.body.geo).toEqual({ lat: 15.58, lng: 120.92 });

    const replay = await request(http).post('/v1/farms').set(auth(farmerToken)).set('Idempotency-Key', key).send(body).expect(201);
    expect(replay.body.id).toBe(farmId);
    const mismatch = await request(http).post('/v1/farms').set(auth(farmerToken)).set('Idempotency-Key', key).send({ ...body, name: 'Other' }).expect(422);
    expect(mismatch.body.type).toContain('idempotency-mismatch');

    const list = await request(http).get('/v1/farms').set(auth(farmerToken)).expect(200);
    expect(list.body.items).toHaveLength(1);
    await request(http).get(`/v1/farms/${farmId}`).set(auth(plainToken)).expect(404); // not the owner
  });

  it('updates a farm with If-Match and returns the server copy on conflict', async () => {
    const body = { name: 'Maligaya farm', barangay_code: BAKAL, farm_type: 'commercial' };
    await request(http).patch(`/v1/farms/${farmId}`).set(auth(farmerToken)).send(body).expect(428);
    const conflict = await request(http).patch(`/v1/farms/${farmId}`).set(auth(farmerToken)).set('If-Match', '7').send(body).expect(409);
    expect(conflict.body.current.version).toBe(1);
    const ok = await request(http).patch(`/v1/farms/${farmId}`).set(auth(farmerToken)).set('If-Match', '1').send(body).expect(200);
    expect(ok.body.version).toBe(2);
    expect(ok.body.farm_type).toBe('commercial');
    expect(ok.body.geo).toBeNull(); // PATCH is a full replace of the input fields
  });

  it('derives the weight class from species and weight', async () => {
    const key = () => ({ 'Idempotency-Key': randomUUID() });
    const noWeight = await request(http).post(`/v1/farms/${farmId}/lots`).set(auth(farmerToken)).set(key()).send({ species: 'hog', head_count: 10 }).expect(422);
    expect(noWeight.body.errors[0].field).toBe('avg_weight_kg');

    const hog = await request(http)
      .post(`/v1/farms/${farmId}/lots`)
      .set(auth(farmerToken))
      .set(key())
      .send({ species: 'hog', head_count: 14, avg_weight_kg: '92', age_months: 5 })
      .expect(201);
    lotId = hog.body.id;
    expect(hog.body.weight_class.label).toBe('80-100 kg');
    expect(hog.body.avg_weight_kg).toBe('92');
    expect(hog.body.last_vaccination_on).toBeNull();

    const goat = await request(http).post(`/v1/farms/${farmId}/lots`).set(auth(farmerToken)).set(key()).send({ species: 'goat', head_count: 3, avg_weight_kg: '20' }).expect(201);
    expect(goat.body.weight_class.label).toBe('grower');

    const carabao = await request(http).post(`/v1/farms/${farmId}/lots`).set(auth(farmerToken)).set(key()).send({ species: 'carabao', head_count: 1 }).expect(201);
    expect(carabao.body.weight_class.label).toBe('all'); // single class, no weight needed

    const farm = await request(http).get(`/v1/farms/${farmId}`).set(auth(farmerToken)).expect(200);
    expect(farm.body.lot_summary).toEqual([
      { species: 'carabao', lots: 1, heads: 1 },
      { species: 'goat', lots: 1, heads: 3 },
      { species: 'hog', lots: 1, heads: 14 },
    ]);
    const hogsOnly = await request(http).get(`/v1/farms/${farmId}/lots?species=hog`).set(auth(farmerToken)).expect(200);
    expect(hogsOnly.body.items).toHaveLength(1);
  });

  it('records a vaccination and shows the board price on the lot', async () => {
    const vax = await request(http)
      .post(`/v1/lots/${lotId}/vaccinations`)
      .set(auth(farmerToken))
      .set('Idempotency-Key', randomUUID())
      .send({ vaccine: 'Hog cholera', given_on: '2026-08-12', given_by: 'Municipal vet' })
      .expect(201);
    expect(vax.body.given_on).toBe('2026-08-12');

    const detail = await request(http).get(`/v1/lots/${lotId}`).set(auth(farmerToken)).expect(200);
    expect(detail.body.vaccinations).toHaveLength(1);
    expect(detail.body.last_vaccination_on).toBe('2026-08-12');
    expect(detail.body.board_price.source).toBe('reference'); // no deals, no reference rows yet
    expect(detail.body.board_price.location_name).toBe('Nueva Ecija');

    const stale = await request(http).patch(`/v1/lots/${lotId}`).set(auth(farmerToken)).set('If-Match', '1').send({ species: 'hog', head_count: 12, avg_weight_kg: '95' }).expect(409);
    expect(stale.body.current.head_count).toBe(14); // vaccination bumped the lot version
    const upd = await request(http)
      .patch(`/v1/lots/${lotId}`)
      .set(auth(farmerToken))
      .set('If-Match', String(stale.body.current.version))
      .send({ species: 'hog', head_count: 12, avg_weight_kg: '105' })
      .expect(200);
    expect(upd.body.weight_class.label).toBe('100-120 kg');
  });

  it('uploads a photo through a signed URL and attaches it to the farm', async () => {
    const slot = await request(http).post('/v1/uploads').set(auth(farmerToken)).send({ purpose: 'farm_photo', content_type: 'image/png', byte_size: PNG.length }).expect(201);
    expect(slot.body.storage_key.startsWith(`farm_photo/${farmerId}/`)).toBe(true);
    expect(slot.body.headers['Content-Type']).toBe('image/png');

    const path = localPath(slot.body.upload_url);
    await request(http).put(path).set('Content-Type', 'image/png').send(Buffer.from('not a png at all, just text')).expect(400);
    await request(http).put(path).set('Content-Type', 'image/jpeg').send(PNG).expect(400);
    await request(http).put(path).set('Content-Type', 'image/png').send(PNG).expect(200);

    await request(http).post('/v1/uploads').set(auth(farmerToken)).send({ purpose: 'farm_photo', content_type: 'application/pdf', byte_size: 10 }).expect(422);
    await request(http).post('/v1/uploads').set(auth(farmerToken)).send({ purpose: 'farm_photo', content_type: 'image/png', byte_size: 6 * 1024 * 1024 }).expect(413);

    const farm = await request(http).get(`/v1/farms/${farmId}`).set(auth(farmerToken)).expect(200);
    const ok = await request(http)
      .patch(`/v1/farms/${farmId}`)
      .set(auth(farmerToken))
      .set('If-Match', String(farm.body.version))
      .send({ name: 'Maligaya farm', barangay_code: BAKAL, photo_keys: [slot.body.storage_key] })
      .expect(200);
    expect(ok.body.photo_keys).toEqual([slot.body.storage_key]);

    const foreign = await request(http)
      .patch(`/v1/farms/${farmId}`)
      .set(auth(farmerToken))
      .set('If-Match', String(ok.body.version))
      .send({ name: 'Maligaya farm', barangay_code: BAKAL, photo_keys: [`lot_photo/${farmerId}/${randomUUID()}.png`] })
      .expect(422);
    expect(foreign.body.errors[0].field).toBe('photo_keys');
  });

  it('registers a verification document only after the file exists', async () => {
    const slot = await request(http).post('/v1/uploads').set(auth(farmerToken)).send({ purpose: 'user_document', content_type: 'application/pdf', byte_size: PDF.length }).expect(201);
    const early = await request(http)
      .post('/v1/me/documents')
      .set(auth(farmerToken))
      .set('Idempotency-Key', randomUUID())
      .send({ doc_type: 'barangay_clearance', storage_key: slot.body.storage_key })
      .expect(422);
    expect(early.body.errors[0].message).toContain('not uploaded');

    await request(http).put(localPath(slot.body.upload_url)).set('Content-Type', 'application/pdf').send(PDF).expect(200);
    const doc = await request(http)
      .post('/v1/me/documents')
      .set(auth(farmerToken))
      .set('Idempotency-Key', randomUUID())
      .send({ doc_type: 'barangay_clearance', storage_key: slot.body.storage_key })
      .expect(201);
    expect(doc.body.status).toBe('pending');
    const list = await request(http).get('/v1/me/documents').set(auth(farmerToken)).expect(200);
    expect(list.body.items).toHaveLength(1);

    await request(http).post('/v1/me/devices').set(auth(farmerToken)).send({ device_id: 'dev-9', platform: 'android', push_token: 'fcm:abc' }).expect(204);
  });

  it('applies an offline batch with temporary ids and reports per-operation results', async () => {
    const tmpFarm = `tmp:${randomUUID()}`;
    const tmpLot = `tmp:${randomUUID()}`;
    const ops = [
      { op_id: randomUUID(), method: 'POST', path: '/farms', body: { tmp_id: tmpFarm, name: 'Second farm', barangay_code: BAKAL } },
      { op_id: randomUUID(), method: 'POST', path: `/farms/${tmpFarm}/lots`, body: { tmp_id: tmpLot, species: 'hog', head_count: 5, avg_weight_kg: '70' } },
      { op_id: randomUUID(), method: 'PATCH', path: `/lots/${tmpLot}`, if_match: 9, body: { species: 'hog', head_count: 6, avg_weight_kg: '70' } },
      { op_id: randomUUID(), method: 'PATCH', path: `/lots/${tmpLot}`, if_match: 1, body: { species: 'hog', head_count: 6, avg_weight_kg: '70' } },
      { op_id: randomUUID(), method: 'DELETE', path: '/farms/not-an-id', body: {} },
    ];
    const res = await request(http).post('/v1/sync').set(auth(farmerToken)).send({ operations: ops }).expect(200);
    const statuses = res.body.results.map((r: { status: number }) => r.status);
    expect(statuses).toEqual([201, 201, 409, 200, 400]);
    expect(res.body.results[0].id_map[tmpFarm]).toBeDefined();
    expect(res.body.results[1].resource.farm_id).toBe(res.body.results[0].id_map[tmpFarm]);
    expect(res.body.results[2].problem.current.version).toBe(1);
    expect(res.body.results[3].resource.head_count).toBe(6);
    expect(res.body.results[4].problem.status).toBe(400);

    // Replaying the same batch returns the stored outcomes; nothing is created twice.
    const again = await request(http).post('/v1/sync').set(auth(farmerToken)).send({ operations: ops }).expect(200);
    expect(again.body.results.map((r: { status: number }) => r.status)).toEqual([201, 201, 409, 200, 400]);
    const farms = await request(http).get('/v1/farms').set(auth(farmerToken)).expect(200);
    expect(farms.body.items).toHaveLength(2);
  });

  it('archives a farm and removes a lot', async () => {
    await request(http).delete(`/v1/lots/${lotId}`).set(auth(farmerToken)).expect(204);
    await request(http).get(`/v1/lots/${lotId}`).set(auth(farmerToken)).expect(404);
    await request(http).delete(`/v1/farms/${farmId}`).set(auth(farmerToken)).expect(204);
    await request(http).get(`/v1/farms/${farmId}`).set(auth(farmerToken)).expect(404);
  });
});
