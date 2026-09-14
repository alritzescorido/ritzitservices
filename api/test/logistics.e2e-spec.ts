import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DbService } from '../src/db/db.service.js';

type App = Parameters<typeof request>[0];

const uploadDir = mkdtempSync(join(tmpdir(), 'lpb-haul-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'pglite://memory';
process.env.DB_AUTO_SCHEMA = 'true';
process.env.SEED_LOCATIONS_PATH = './does-not-exist.sql';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
process.env.OTP_PEPPER = 'test-pepper-test-pepper';
process.env.OTP_DEV_CODE = '123456';
process.env.OTP_RESEND_AFTER_SECONDS = '0';
process.env.SCHEDULER_ENABLED = 'false';
process.env.UPLOAD_DIR = uploadDir;
process.env.PUBLIC_BASE_URL = 'http://api.test';

const NUEVA_ECIJA = '0304900000';
const TALAVERA = '0304930000';
const BAKAL = '0304930001';
const CABANATUAN = '0304903000';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(92, 1)]);

describe('Logistics: hauler profile, job board, pickup checklist, transit, handover (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let db: DbService;
  let farmer: string;
  let farmerId: string;
  let buyer: string;
  let hauler: string;
  let haulerId: string;
  let smallTruck: string;
  let lotId: string;
  let lotId2: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const key = () => ({ 'Idempotency-Key': randomUUID() });
  const signIn = async (phone: string) => {
    const req = await request(http).post('/v1/auth/otp/request').send({ phone }).expect(202);
    const ok = await request(http).post('/v1/auth/otp/verify').send({ challenge_id: req.body.challenge_id, code: '123456' }).expect(200);
    return { token: ok.body.access_token as string, refresh: ok.body.refresh_token as string, id: ok.body.user.id as string };
  };
  const person = async (phone: string, name: string, role: string, verified: boolean) => {
    const s = await signIn(phone);
    await request(http).patch('/v1/me').set(auth(s.token)).send({ full_name: name }).expect(200);
    await request(http).post('/v1/me/roles').set(auth(s.token)).send({ role }).expect(200);
    if (verified) await db.query(`update users set verification = 'verified', verified_at = now() where id = $1`, [s.id]);
    const rotated = await request(http).post('/v1/auth/refresh').send({ refresh_token: s.refresh }).expect(200);
    return { token: rotated.body.access_token as string, id: s.id };
  };
  /** Farmer lists, buyer offers with a hauler wanted, farmer accepts: one job on the board. */
  const bookedDeal = async (lot: string, heads: number, dropoff: string | null = CABANATUAN) => {
    const listing = await request(http).post('/v1/listings').set(auth(farmer)).set(key()).send({ lot_id: lot, heads_offered: heads, asking_price: '180' }).expect(201);
    const offer = await request(http)
      .post(`/v1/listings/${listing.body.id}/offers`)
      .set(auth(buyer))
      .set(key())
      .send({ price: '180', heads, needs_hauler: true, pickup_on: '2026-09-20', dropoff_location_code: dropoff })
      .expect(201);
    const deal = await request(http).post(`/v1/offers/${offer.body.id}/accept`).set(auth(farmer)).set(key()).expect(201);
    return deal.body.id as string;
  };
  const uploadPhoto = async (token: string) => {
    const slot = await request(http).post('/v1/uploads').set(auth(token)).send({ purpose: 'shipment_photo', content_type: 'image/png', byte_size: PNG.length }).expect(201);
    await request(http).put(slot.body.upload_url.replace('http://api.test', '')).set('Content-Type', 'image/png').send(PNG).expect(200);
    return slot.body.storage_key as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    http = app.getHttpServer();
    db = app.get(DbService);
    await db.query(`
      insert into locations (psgc_code, parent_code, level, name) values
        ('0300000000', null, 'region', 'Central Luzon'),
        ('${NUEVA_ECIJA}', '0300000000', 'province', 'Nueva Ecija'),
        ('${TALAVERA}', '${NUEVA_ECIJA}', 'municipality', 'Talavera'),
        ('${CABANATUAN}', '${NUEVA_ECIJA}', 'municipality', 'Cabanatuan City'),
        ('${BAKAL}', '${TALAVERA}', 'barangay', 'Bakal I')`);

    const f = await person('+639170005001', 'Maria Santos', 'farmer', true);
    farmer = f.token;
    farmerId = f.id;
    buyer = (await person('+639170005002', 'Juan Dela Cruz', 'buyer', true)).token;
    const h = await person('+639170005003', 'Rey Santos', 'hauler', true);
    hauler = h.token;
    haulerId = h.id;
    smallTruck = (await person('+639170005004', 'Lito Cruz', 'hauler', true)).token;

    const farm = await request(http).post('/v1/farms').set(auth(farmer)).set(key()).send({ name: 'Maligaya farm', barangay_code: BAKAL }).expect(201);
    lotId = (await request(http).post(`/v1/farms/${farm.body.id}/lots`).set(auth(farmer)).set(key()).send({ species: 'hog', head_count: 60, avg_weight_kg: '92' }).expect(201)).body.id;
    lotId2 = (await request(http).post(`/v1/farms/${farm.body.id}/lots`).set(auth(farmer)).set(key()).send({ species: 'goat', head_count: 8, avg_weight_kg: '22' }).expect(201)).body.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('a hauler registers a truck; the profile is theirs to replace', async () => {
    await request(http).get('/v1/haulers/me').set(auth(hauler)).expect(404);
    const nope = await request(http).put('/v1/haulers/me').set(auth(farmer)).send({ vehicle_plate: 'ABC 1234', vehicle_type: 'Elf truck', capacity_heads: 20 }).expect(403);
    expect(nope.body.detail).toContain('Hauler role');

    const bad = await request(http).put('/v1/haulers/me').set(auth(hauler)).send({ vehicle_plate: 'NEB 4521', vehicle_type: 'Elf truck', capacity_heads: 20, service_area: ['9999999999'] }).expect(422);
    expect(bad.body.errors[0].field).toBe('service_area');

    const saved = await request(http)
      .put('/v1/haulers/me')
      .set(auth(hauler))
      .send({ vehicle_plate: 'neb 4521', vehicle_type: 'Elf truck', capacity_heads: 20, capacity_kg: '2000', rate_per_head: '150', service_area: [NUEVA_ECIJA] })
      .expect(200);
    expect(saved.body).toMatchObject({ user_id: haulerId, hauler_name: 'Rey Santos', verified: true, vehicle_plate: 'NEB 4521', capacity_heads: 20, capacity_kg: '2000', rate_per_head: '150.00', rate_per_trip: null, service_area: [NUEVA_ECIJA] });

    const again = await request(http).put('/v1/haulers/me').set(auth(hauler)).send({ vehicle_plate: 'NEB 4521', vehicle_type: 'Elf truck', capacity_heads: 24 }).expect(200);
    expect(again.body.capacity_heads).toBe(24);
    expect(again.body.service_area).toEqual([]);

    await request(http).put('/v1/haulers/me').set(auth(smallTruck)).send({ vehicle_plate: 'UVW 88', vehicle_type: 'Multicab', capacity_heads: 4 }).expect(200);
  });

  let dealId: string;
  let shipmentId: string;

  it('the job board shows booked deals that want a hauler, outside restricted zones', async () => {
    dealId = await bookedDeal(lotId, 10);
    const ownTruck = await bookedDeal(lotId2, 2, null);
    await db.query(`update deals set needs_hauler = false where id = $1`, [ownTruck]);

    const board = await request(http).get('/v1/haul-jobs').set(auth(hauler)).expect(200);
    expect(board.body.items.map((j: { deal_id: string }) => j.deal_id)).toEqual([dealId]);
    expect(board.body.items[0]).toMatchObject({
      species: 'hog',
      heads: 10,
      estimated_weight_kg: '920',
      farm_name: 'Maligaya farm',
      pickup_on: '2026-09-20',
      fits_capacity: true,
    });
    expect(board.body.items[0].pickup.display_name).toBe('Talavera, Nueva Ecija');
    expect(board.body.items[0].dropoff.name).toBe('Cabanatuan City');
    expect(board.body.items[0].needs).toContain('veterinary health certificate');

    const small = await request(http).get('/v1/haul-jobs?fits_my_truck=true').set(auth(smallTruck)).expect(200);
    expect(small.body.items).toHaveLength(0);
    const smallAll = await request(http).get('/v1/haul-jobs').set(auth(smallTruck)).expect(200);
    expect(smallAll.body.items[0].fits_capacity).toBe(false);

    await request(http).get('/v1/haul-jobs').set(auth(buyer)).expect(403);

    // An ASF restriction on the farm's municipality hides the job until it ends.
    await db.query(
      `insert into restricted_zones (location_code, species, reason, starts_on, set_by) values ($1, 'hog', 'ASF red zone', current_date, $2)`,
      [TALAVERA, farmerId],
    );
    const hidden = await request(http).get('/v1/haul-jobs').set(auth(hauler)).expect(200);
    expect(hidden.body.items).toHaveLength(0);
    const refused = await request(http).post(`/v1/haul-jobs/${dealId}/accept`).set(auth(hauler)).set(key()).send({ agreed_fee: '1500', scheduled_pickup_at: '2026-09-20T06:00:00+08:00' }).expect(409);
    expect(refused.body.detail).toContain('restricted');
    await db.query(`update restricted_zones set ends_on = current_date - 1`);
    expect((await request(http).get('/v1/haul-jobs').set(auth(hauler)).expect(200)).body.items).toHaveLength(1);
  });

  it('accepting needs a verified hauler with a big enough truck; the deal becomes hauler_assigned', async () => {
    const unverified = await person('+639170005005', 'New Hauler', 'hauler', false);
    await request(http).put('/v1/haulers/me').set(auth(unverified.token)).send({ vehicle_plate: 'XYZ 1111', vehicle_type: 'Truck', capacity_heads: 50 }).expect(200);
    const nv = await request(http).post(`/v1/haul-jobs/${dealId}/accept`).set(auth(unverified.token)).set(key()).send({ agreed_fee: '1500', scheduled_pickup_at: '2026-09-20T06:00:00+08:00' }).expect(403);
    expect(nv.body.detail).toContain('not verified');

    const tooSmall = await request(http).post(`/v1/haul-jobs/${dealId}/accept`).set(auth(smallTruck)).set(key()).send({ agreed_fee: '1500', scheduled_pickup_at: '2026-09-20T06:00:00+08:00' }).expect(409);
    expect(tooSmall.body.detail).toContain('registered for 4');

    await request(http).post(`/v1/haul-jobs/${dealId}/accept`).set(auth(hauler)).send({ agreed_fee: '1500', scheduled_pickup_at: '2026-09-20T06:00:00+08:00' }).expect(400); // Idempotency-Key required

    const accepted = await request(http).post(`/v1/haul-jobs/${dealId}/accept`).set(auth(hauler)).set(key()).send({ agreed_fee: '1500.00', scheduled_pickup_at: '2026-09-20T06:00:00+08:00' }).expect(201);
    shipmentId = accepted.body.id;
    expect(accepted.body).toMatchObject({
      deal_id: dealId,
      status: 'assigned',
      hauler_name: 'Rey Santos',
      vehicle_plate: 'NEB 4521',
      heads: 10,
      agreed_fee: '1500.00',
      scheduled_pickup_at: '2026-09-19T22:00:00.000Z',
      deal_state: 'hauler_assigned',
      farmer_name: 'Maria Santos',
      buyer_name: 'Juan Dela Cruz',
    });
    expect(accepted.body.events.map((e: { kind: string }) => e.kind)).toEqual(['accepted']);

    // Gone from the board; a second hauler cannot take it.
    expect((await request(http).get('/v1/haul-jobs').set(auth(smallTruck)).expect(200)).body.items).toHaveLength(0);
    await request(http).post(`/v1/haul-jobs/${dealId}/accept`).set(auth(smallTruck)).set(key()).send({ agreed_fee: '900', scheduled_pickup_at: '2026-09-20T06:00:00+08:00' }).expect(409);

    // Everyone on the deal sees the shipment; a stranger does not.
    const deal = await request(http).get(`/v1/deals/${dealId}`).set(auth(buyer)).expect(200);
    expect(deal.body.state).toBe('hauler_assigned');
    expect(deal.body.shipment).toMatchObject({ id: shipmentId, status: 'assigned', hauler_name: 'Rey Santos', vehicle_plate: 'NEB 4521', last_ping: null });
    expect(deal.body.dropoff.name).toBe('Cabanatuan City');
    expect(deal.body.events.at(-1).to_state).toBe('hauler_assigned');
    await request(http).get(`/v1/shipments/${shipmentId}`).set(auth(farmer)).expect(200);
    await request(http).get(`/v1/shipments/${shipmentId}`).set(auth(smallTruck)).expect(404);

    const mine = await request(http).get('/v1/shipments').set(auth(hauler)).expect(200);
    expect(mine.body.items.map((s: { id: string }) => s.id)).toEqual([shipmentId]);
  });

  it('a hauler can withdraw before pickup; the job reopens and another hauler takes it', async () => {
    const withdrawn = await request(http).post(`/v1/shipments/${shipmentId}/cancel`).set(auth(hauler)).set(key()).send({ reason: 'Truck broke down' }).expect(200);
    expect(withdrawn.body).toMatchObject({ status: 'cancelled', cancel_reason: 'Truck broke down', deal_state: 'accepted' });
    expect((await request(http).get('/v1/haul-jobs').set(auth(hauler)).expect(200)).body.items).toHaveLength(1);
    const deal = await request(http).get(`/v1/deals/${dealId}`).set(auth(farmer)).expect(200);
    expect(deal.body.shipment).toBeNull();

    const again = await request(http).post(`/v1/haul-jobs/${dealId}/accept`).set(auth(hauler)).set(key()).send({ agreed_fee: '1500', scheduled_pickup_at: '2026-09-21T06:00:00+08:00' }).expect(201);
    shipmentId = again.body.id;
    expect(again.body.deal_state).toBe('hauler_assigned');
    // Only the live shipment counts for the hauler's list order; the cancelled one is still visible in history.
    const mine = await request(http).get('/v1/shipments').set(auth(hauler)).expect(200);
    expect(mine.body.items.map((s: { status: string }) => s.status)).toEqual(['assigned', 'cancelled']);
  });

  it('the trip cannot start until the pickup checklist is complete', async () => {
    const photo = await uploadPhoto(hauler);
    const strangersPhoto = await uploadPhoto(smallTruck);
    const base = { shipping_permit_no: 'SP-2026-0917', vet_health_cert_no: 'VHC-NE-4471', head_count: 10 };

    const noPhoto = await request(http).post(`/v1/shipments/${shipmentId}/start`).set(auth(hauler)).set(key()).send({ ...base, photo_keys: [] }).expect(422);
    expect(noPhoto.body.errors[0].field).toBe('photo_keys');
    const noPermit = await request(http).post(`/v1/shipments/${shipmentId}/start`).set(auth(hauler)).set(key()).send({ ...base, shipping_permit_no: '', photo_keys: [photo] }).expect(422);
    expect(noPermit.body.errors[0].field).toBe('shipping_permit_no');
    const notMine = await request(http).post(`/v1/shipments/${shipmentId}/start`).set(auth(hauler)).set(key()).send({ ...base, photo_keys: [strangersPhoto] }).expect(422);
    expect(notMine.body.errors[0].message).toContain('Not one of your shipment photos');
    const notUploaded = await request(http).post(`/v1/shipments/${shipmentId}/start`).set(auth(hauler)).set(key()).send({ ...base, photo_keys: [`shipment_photo/${haulerId}/${randomUUID()}.jpg`] }).expect(422);
    expect(notUploaded.body.errors[0].message).toContain('not uploaded');
    await request(http).post(`/v1/shipments/${shipmentId}/start`).set(auth(smallTruck)).set(key()).send({ ...base, photo_keys: [strangersPhoto] }).expect(403);

    // Pinging before the trip started is refused.
    await request(http).post(`/v1/shipments/${shipmentId}/ping`).set(auth(hauler)).send({ geo: { lat: 15.58, lng: 120.92 } }).expect(409);

    const started = await request(http)
      .post(`/v1/shipments/${shipmentId}/start`)
      .set(auth(hauler))
      .set(key())
      .send({ ...base, head_count: 9, photo_keys: [photo], geo: { lat: 15.5843, lng: 120.9187 }, note: 'One hog held back by the farmer' })
      .expect(200);
    expect(started.body).toMatchObject({ status: 'in_transit', shipping_permit_no: 'SP-2026-0917', vet_health_cert_no: 'VHC-NE-4471', head_count_at_pickup: 9, photo_keys: [photo], deal_state: 'in_transit' });
    expect(started.body.picked_up_at).not.toBeNull();
    const pickup = started.body.events.at(-1);
    expect(pickup).toMatchObject({ status: 'in_transit', kind: 'pickup', photo_key: photo });
    expect(pickup.geo.lat).toBeCloseTo(15.5843, 4);
    expect(pickup.note).toContain('1 fewer heads than agreed');

    const deal = await request(http).get(`/v1/deals/${dealId}`).set(auth(buyer)).expect(200);
    expect(deal.body.state).toBe('in_transit');
    expect(deal.body.shipment.head_count_at_pickup).toBe(9);
    expect(deal.body.shipment.last_ping.lat).toBeCloseTo(15.5843, 4);
    expect(deal.body.events.at(-1).note).toContain('permit SP-2026-0917');

    await request(http).post(`/v1/shipments/${shipmentId}/cancel`).set(auth(hauler)).set(key()).send({ reason: 'changed my mind' }).expect(409); // no withdrawing after pickup
  });

  it('transit pings and hand-over; the buyer still confirms the count on the deal', async () => {
    await request(http).post(`/v1/shipments/${shipmentId}/ping`).set(auth(hauler)).send({ geo: { lat: 15.55, lng: 120.93 } }).expect(201);
    await request(http).post(`/v1/shipments/${shipmentId}/ping`).set(auth(hauler)).send({ geo: { lat: 15.52, lng: 120.95 }, kind: 'delay', note: 'Checkpoint queue at Sta. Rosa' }).expect(201);
    await request(http).post(`/v1/shipments/${shipmentId}/ping`).set(auth(buyer)).send({ geo: { lat: 15.52, lng: 120.95 } }).expect(403);

    const tracked = await request(http).get(`/v1/shipments/${shipmentId}`).set(auth(buyer)).expect(200);
    expect(tracked.body.events.map((e: { kind: string }) => e.kind)).toEqual(['accepted', 'pickup', 'position', 'delay']);
    expect(tracked.body.last_ping.lng).toBeCloseTo(120.95, 4);

    // Buyer cannot close the deal before the hauler hands over? They can: the deal allows in_transit -> delivered.
    // But the hauler's own hand-over record comes first in the normal flow.
    const handover = await uploadPhoto(hauler);
    const delivered = await request(http).post(`/v1/shipments/${shipmentId}/delivered`).set(auth(hauler)).set(key()).send({ photo_keys: [handover], geo: { lat: 15.4868, lng: 120.9676 }, note: 'Unloaded at Cabanatuan public market' }).expect(200);
    expect(delivered.body).toMatchObject({ status: 'delivered', deal_state: 'in_transit' });
    expect(delivered.body.delivered_at).not.toBeNull();
    expect(delivered.body.photo_keys).toHaveLength(2);
    expect(delivered.body.events.at(-1)).toMatchObject({ status: 'delivered', kind: 'handover', photo_key: handover });

    await request(http).post(`/v1/shipments/${shipmentId}/ping`).set(auth(hauler)).send({ geo: { lat: 15.4, lng: 120.9 } }).expect(409);

    const confirmed = await request(http).post(`/v1/deals/${dealId}/deliver`).set(auth(buyer)).set(key()).send({ delivered_heads: 9, delivered_weight_kg: '826.5' }).expect(200);
    expect(confirmed.body.state).toBe('delivered');
    expect(confirmed.body.final_total).toBe('148770.00');
    expect(confirmed.body.shipment.status).toBe('delivered');
    expect(confirmed.body.delivery_note).toBeNull(); // hauled in-app: no "without hauler record" note

    const done = await request(http).get('/v1/shipments?status=delivered').set(auth(hauler)).expect(200);
    expect(done.body.items).toHaveLength(1);
  });
});
