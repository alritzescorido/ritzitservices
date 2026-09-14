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

const NUEVA_ECIJA = '0304900000';
const TALAVERA = '0304930000';
const BAKAL = '0304930001';

describe('Marketplace: listings, offers, deals, disputes (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let db: DbService;
  let farmer: string;
  let farmerId: string;
  let buyer: string;
  let buyerId: string;
  let buyer2: string;
  let admin: string;
  let lotId: string;
  let secondLotId: string;

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
        ('${BAKAL}', '${TALAVERA}', 'barangay', 'Bakal I')`);

    const f = await person('+639170004001', 'Maria Santos', 'farmer', true);
    farmer = f.token;
    farmerId = f.id;
    const b = await person('+639170004002', 'Juan Dela Cruz', 'buyer', true);
    buyer = b.token;
    buyerId = b.id;
    buyer2 = (await person('+639170004003', 'Golden Hog Buyers', 'buyer', true)).token;

    const farm = await request(http).post('/v1/farms').set(auth(farmer)).set(key()).send({ name: 'Maligaya farm', barangay_code: BAKAL }).expect(201);
    lotId = (await request(http).post(`/v1/farms/${farm.body.id}/lots`).set(auth(farmer)).set(key()).send({ species: 'hog', head_count: 14, avg_weight_kg: '92' }).expect(201)).body.id;
    secondLotId = (await request(http).post(`/v1/farms/${farm.body.id}/lots`).set(auth(farmer)).set(key()).send({ species: 'goat', head_count: 6, avg_weight_kg: '20' }).expect(201)).body.id;

    await db.query(
      `insert into reference_prices (province_code, species, weight_class_id, unit, price, source, effective_from, set_by)
       values ('${NUEVA_ECIJA}', 'hog', null, 'per_kg_liveweight', 178, 'PSA test', current_date - 1, $1)`,
      [farmerId],
    );
    await app.get(AdminAuthService).createAdmin({ phone: '+639170004009', email: 'admin@example.ph', fullName: 'A. Reyes', password: 'correct horse battery staple' });
    const step = await request(http).post('/v1/admin/auth/login').send({ email: 'admin@example.ph', password: 'correct horse battery staple' }).expect(200);
    admin = (await request(http).post('/v1/admin/auth/totp').send({ step_token: step.body.step_token, code: totpCode(step.body.totp_setup.secret) }).expect(200)).body.access_token;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  let listingId: string;
  let dealId: string;

  it('a verified farmer lists a lot and buyers see it against the board', async () => {
    const unverified = await person('+639170004004', 'New Farmer', 'farmer', false);
    const nope = await request(http).post('/v1/listings').set(auth(unverified.token)).set(key()).send({ lot_id: lotId, heads_offered: 10, asking_price: '180' }).expect(403);
    expect(nope.body.detail).toContain('not verified');

    const tooMany = await request(http).post('/v1/listings').set(auth(farmer)).set(key()).send({ lot_id: lotId, heads_offered: 99, asking_price: '180' }).expect(422);
    expect(tooMany.body.errors[0].field).toBe('heads_offered');

    const created = await request(http).post('/v1/listings').set(auth(farmer)).set(key()).send({ lot_id: lotId, heads_offered: 10, asking_price: '180' }).expect(201);
    listingId = created.body.id;
    expect(created.body).toMatchObject({ status: 'active', species: 'hog', unit: 'per_kg_liveweight', asking_price: '180.00', head_count: 14, farmer_verified: true, pending_offers: 0 });
    expect(created.body.weight_class.label).toBe('80-100 kg');
    expect(created.body.board_price).toBe('178.00');
    expect(created.body.vs_board_pct).toBeCloseTo(1.1, 1);
    expect(created.body.estimated_total).toBe('165600.00'); // 10 × 92 kg × ₱180
    expect(created.body.location.display_name).toBe('Talavera, Nueva Ecija');

    await request(http).post('/v1/listings').set(auth(farmer)).set(key()).send({ lot_id: lotId, heads_offered: 4, asking_price: '180' }).expect(409); // one open listing per lot

    const browse = await request(http).get(`/v1/listings?species=hog&province_code=${NUEVA_ECIJA}`).set(auth(buyer)).expect(200);
    expect(browse.body.items.map((i: { id: string }) => i.id)).toEqual([listingId]);
    const mine = await request(http).get('/v1/listings?mine=true').set(auth(farmer)).expect(200);
    expect(mine.body.items).toHaveLength(1);
  });

  it('offer, counter, accept: the deal is created and the listing matched', async () => {
    await request(http).post(`/v1/listings/${listingId}/offers`).set(auth(farmer)).set(key()).send({ price: '176', heads: 10 }).expect(403); // own listing
    const tooMany = await request(http).post(`/v1/listings/${listingId}/offers`).set(auth(buyer)).set(key()).send({ price: '176', heads: 20 }).expect(422);
    expect(tooMany.body.errors[0].field).toBe('heads');

    const first = await request(http).post(`/v1/listings/${listingId}/offers`).set(auth(buyer)).set(key()).send({ price: '170', heads: 10, needs_hauler: false }).expect(201);
    const offer = await request(http).post(`/v1/listings/${listingId}/offers`).set(auth(buyer)).set(key()).send({ price: '176', heads: 10, needs_hauler: false, pickup_on: '2026-09-20' }).expect(201);
    expect(offer.body).toMatchObject({ offered_by: 'buyer', status: 'pending', price: '176.00', estimated_total: '161920.00' });
    const rival = await request(http).post(`/v1/listings/${listingId}/offers`).set(auth(buyer2)).set(key()).send({ price: '172', heads: 10 }).expect(201);

    const farmerSees = await request(http).get(`/v1/listings/${listingId}/offers`).set(auth(farmer)).expect(200);
    expect(farmerSees.body.items.map((o: { status: string }) => o.status).sort()).toEqual(['pending', 'pending', 'rejected']); // first offer replaced
    const buyerSees = await request(http).get(`/v1/listings/${listingId}/offers`).set(auth(buyer)).expect(200);
    expect(buyerSees.body.items.every((o: { buyer_id: string }) => o.buyer_id === buyerId)).toBe(true);
    void first;

    await request(http).post(`/v1/offers/${offer.body.id}/counter`).set(auth(buyer)).set(key()).send({ price: '178', heads: 10 }).expect(403); // only the other party
    const counter = await request(http).post(`/v1/offers/${offer.body.id}/counter`).set(auth(farmer)).set(key()).send({ price: '180', heads: 10, note: 'firm at board' }).expect(201);
    expect(counter.body).toMatchObject({ offered_by: 'farmer', parent_offer_id: offer.body.id, price: '180.00', needs_hauler: false });
    await request(http).post(`/v1/offers/${offer.body.id}/accept`).set(auth(farmer)).set(key()).expect(409); // original is countered

    await request(http).post(`/v1/offers/${counter.body.id}/accept`).set(auth(farmer)).set(key()).expect(403); // farmer cannot accept own counter
    const deal = await request(http).post(`/v1/offers/${counter.body.id}/accept`).set(auth(buyer)).set(key()).expect(201);
    dealId = deal.body.id;
    expect(deal.body).toMatchObject({
      state: 'accepted',
      agreed_price: '180.00',
      agreed_heads: 10,
      agreed_weight_kg: '920',
      estimated_total: '165600.00',
      needs_hauler: false,
      farmer_name: 'Maria Santos',
      buyer_name: 'Juan Dela Cruz',
    });
    expect(deal.body.events).toHaveLength(1);
    expect(deal.body.events[0]).toMatchObject({ from_state: null, to_state: 'accepted', actor_id: buyerId });

    const listing = await request(http).get(`/v1/listings/${listingId}`).set(auth(buyer)).expect(200);
    expect(listing.body.status).toBe('matched');
    const rivalNow = await request(http).get(`/v1/listings/${listingId}/offers`).set(auth(buyer2)).expect(200);
    expect(rivalNow.body.items[0].status).toBe('rejected');
    void rival;
    await request(http).delete(`/v1/listings/${listingId}`).set(auth(farmer)).expect(409); // matched, cancel the deal instead
  });

  it('deliver, pay, confirm: the deal settles and the price reaches the board', async () => {
    await request(http).post(`/v1/deals/${dealId}/deliver`).set(auth(farmer)).set(key()).send({ delivered_heads: 10 }).expect(403);
    await request(http).post(`/v1/deals/${dealId}/confirm-payment`).set(auth(farmer)).set(key()).expect(409); // not delivered yet

    const delivered = await request(http).post(`/v1/deals/${dealId}/deliver`).set(auth(buyer)).set(key()).send({ delivered_heads: 10, delivered_weight_kg: '918' }).expect(200);
    expect(delivered.body.state).toBe('delivered');
    expect(delivered.body.final_total).toBe('165240.00'); // 918 × 180

    const early = await request(http).post(`/v1/deals/${dealId}/confirm-payment`).set(auth(farmer)).set(key()).expect(409);
    expect(early.body.detail).toContain('not recorded a payment');
    const paid = await request(http).post(`/v1/deals/${dealId}/pay`).set(auth(buyer)).set(key()).send({ method: 'gcash', reference: '1029 3847 56' }).expect(200);
    expect(paid.body.buyer_paid_at).toBeTruthy();

    const settled = await request(http).post(`/v1/deals/${dealId}/confirm-payment`).set(auth(farmer)).set(key()).expect(200);
    expect(settled.body.state).toBe('settled');
    expect(settled.body.counts_for_price).toBe(true);
    expect(settled.body.events.map((e: { to_state: string }) => e.to_state)).toEqual(['accepted', 'delivered', 'settled']);
    expect(settled.body.events[2].actor_id).toBe(farmerId);

    // On-settle refresh wrote a municipality snapshot (one deal, below the 5-deal threshold, so the board still shows the reference)
    const snap = await db.one<{ n: number; median: string }>(`select count(*)::int as n, min(median_price)::text as median from price_snapshots where location_code = $1 and species = 'hog'`, [TALAVERA]);
    expect(snap!.n).toBe(1);
    expect(snap!.median).toBe('180.00');
    const board = await request(http).get(`/v1/prices/running?municipality_code=${TALAVERA}&species=hog&weight_class_id=${settled.body.weight_class.id}`).expect(200);
    expect(board.body.source).toBe('reference');
    expect(board.body.municipality).toEqual({ median_price: '180.00', sample_count: 1 });

    await request(http).post(`/v1/deals/${dealId}/ratings`).set(auth(buyer)).send({ score: 5, comment: 'Healthy hogs, honest weight' }).expect(201);
    await request(http).post(`/v1/deals/${dealId}/ratings`).set(auth(buyer)).send({ score: 4 }).expect(409);
    await request(http).post(`/v1/deals/${dealId}/ratings`).set(auth(farmer)).send({ score: 5 }).expect(201);

    const mine = await request(http).get('/v1/deals?state=settled').set(auth(buyer)).expect(200);
    expect(mine.body.items.map((d: { id: string }) => d.id)).toEqual([dealId]);
    await request(http).get(`/v1/deals/${dealId}`).set(auth(buyer2)).expect(404); // not a party
    await request(http).get(`/v1/deals/${dealId}`).set(auth(admin)).expect(200); // admins may look
  });

  it('a delivered deal can be disputed and resolved by an admin as refunded, leaving the board untouched', async () => {
    const listing = await request(http).post('/v1/listings').set(auth(farmer)).set(key()).send({ lot_id: secondLotId, heads_offered: 6, asking_price: '4500' }).expect(201);
    expect(listing.body.unit).toBe('per_head');
    const offer = await request(http).post(`/v1/listings/${listing.body.id}/offers`).set(auth(buyer2)).set(key()).send({ price: '4200', heads: 6, needs_hauler: false }).expect(201);
    const deal = await request(http).post(`/v1/offers/${offer.body.id}/accept`).set(auth(farmer)).set(key()).expect(201);
    expect(deal.body.estimated_total).toBe('25200.00'); // per head: 6 × 4200

    await request(http).post(`/v1/deals/${deal.body.id}/dispute`).set(auth(buyer2)).set(key()).send({ reason: 'health' }).expect(409); // only after delivery
    await request(http).post(`/v1/deals/${deal.body.id}/deliver`).set(auth(buyer2)).set(key()).send({ delivered_heads: 5, note: 'one goat sick, refused' }).expect(200);
    const dispute = await request(http).post(`/v1/deals/${deal.body.id}/dispute`).set(auth(buyer2)).set(key()).send({ reason: 'health', details: 'One goat down at unloading' }).expect(201);
    expect(dispute.body).toMatchObject({ status: 'open', raised_by_role: 'buyer', reason: 'health' });
    expect(dispute.body.deal.state).toBe('disputed');

    await request(http).post(`/v1/deals/${deal.body.id}/pay`).set(auth(buyer2)).set(key()).send({ method: 'cash' }).expect(409); // frozen

    const open = await request(http).get('/v1/admin/disputes?status=open').set(auth(admin)).expect(200);
    expect(open.body.items.map((d: { id: string }) => d.id)).toEqual([dispute.body.id]);
    await request(http).get('/v1/admin/disputes').set(auth(buyer2)).expect(403);

    const resolved = await request(http)
      .post(`/v1/admin/disputes/${dispute.body.id}/resolve`)
      .set(auth(admin))
      .set(key())
      .send({ outcome: 'refunded', resolution: 'Vet confirmed illness before pickup; buyer refunded, farmer warned.' })
      .expect(200);
    expect(resolved.body.status).toBe('resolved_refunded');
    expect(resolved.body.deal.state).toBe('refunded');
    expect(resolved.body.deal.counts_for_price).toBe(false);
    await request(http).post(`/v1/admin/disputes/${dispute.body.id}/resolve`).set(auth(admin)).set(key()).send({ outcome: 'settled', resolution: 'again' }).expect(409);

    const audit = await request(http).get('/v1/admin/audit-log?action=resolve_dispute').set(auth(admin)).expect(200);
    expect(audit.body.items).toHaveLength(1);
    const goatSnaps = await db.one<{ n: number }>(`select count(*)::int as n from price_snapshots where species = 'goat'`);
    expect(goatSnaps!.n).toBe(0);
  });

  it('a deal can be cancelled before delivery and the listing reopens; an admin can review an outlier', async () => {
    const farm2 = await request(http).post('/v1/farms').set(auth(farmer)).set(key()).send({ name: 'Second farm', barangay_code: BAKAL }).expect(201);
    const lot = await request(http).post(`/v1/farms/${farm2.body.id}/lots`).set(auth(farmer)).set(key()).send({ species: 'hog', head_count: 5, avg_weight_kg: '70' }).expect(201);
    const listing = await request(http).post('/v1/listings').set(auth(farmer)).set(key()).send({ lot_id: lot.body.id, heads_offered: 5, asking_price: '182' }).expect(201);
    const offer = await request(http).post(`/v1/listings/${listing.body.id}/offers`).set(auth(buyer)).set(key()).send({ price: '182', heads: 5 }).expect(201);
    const deal = await request(http).post(`/v1/offers/${offer.body.id}/accept`).set(auth(farmer)).set(key()).expect(201);

    const cancelled = await request(http).post(`/v1/deals/${deal.body.id}/cancel`).set(auth(buyer)).set(key()).send({ reason: 'Truck broke down, cannot pick up this week' }).expect(200);
    expect(cancelled.body.state).toBe('cancelled');
    expect(cancelled.body.cancel_reason).toContain('Truck');
    const reopened = await request(http).get(`/v1/listings/${listing.body.id}`).set(auth(buyer)).expect(200);
    expect(reopened.body.status).toBe('active');
    await request(http).post(`/v1/deals/${deal.body.id}/cancel`).set(auth(buyer)).set(key()).send({ reason: 'twice' }).expect(409);

    // Outlier review on the settled deal: keep it out, then let it count again.
    const out = await request(http).post(`/v1/admin/deals/${dealId}/outlier-review`).set(auth(admin)).send({ counts_for_price: false, note: 'checking' }).expect(200);
    expect(out.body.counts_for_price).toBe(false);
    const back = await request(http).post(`/v1/admin/deals/${dealId}/outlier-review`).set(auth(admin)).send({ counts_for_price: true }).expect(200);
    expect(back.body.counts_for_price).toBe(true);
    await request(http).post(`/v1/admin/deals/${dealId}/outlier-review`).set(auth(buyer)).send({ counts_for_price: true }).expect(403);
  });

  it('expired pending offers are closed by the hourly job', async () => {
    const listing = await request(http).post('/v1/listings').set(auth(farmer)).set(key()).send({ lot_id: secondLotId, heads_offered: 2, asking_price: '4000' }).expect(201);
    const offer = await request(http).post(`/v1/listings/${listing.body.id}/offers`).set(auth(buyer)).set(key()).send({ price: '3900', heads: 2 }).expect(201);
    await db.query(`update offers set expires_at = now() - interval '1 minute' where id = $1`, [offer.body.id]);
    await request(http).post(`/v1/offers/${offer.body.id}/accept`).set(auth(farmer)).set(key()).expect(409);
    const { MarketService } = await import('../src/market/market.service.js');
    expect(await app.get(MarketService).expireOffers()).toBe(1);
    const after = await request(http).get(`/v1/listings/${listing.body.id}/offers`).set(auth(farmer)).expect(200);
    expect(after.body.items[0].status).toBe('expired');
  });
});
