import { Inject, Injectable } from '@nestjs/common';
import type { AccessClaims } from '../auth/auth.guard.js';
import { int, isoTime, money, weight } from '../common/format.js';
import { ProblemException } from '../common/problem.js';
import { DbService } from '../db/db.service.js';
import { LocationsService } from '../locations/locations.service.js';
import { DealsService, shipmentSummary } from '../market/deals.service.js';
import type { Species } from '../prices/prices.service.js';
import { StorageService } from '../storage/storage.service.js';

// Phase 3. A hauler keeps one profile (truck, capacity, rates), picks jobs from
// accepted deals that asked for a hauler, and walks a shipment through
// assigned -> in_transit -> delivered. The deal follows through
// DealsService.transition so the same state machine and event log apply.
// Trip start is refused until every pickup checklist item is present: that is
// the gate the blueprint sets for this phase.

export interface HaulerProfileInput {
  vehicle_plate: string;
  vehicle_type: string;
  capacity_heads: number;
  capacity_kg?: string | null;
  rate_per_head?: string | null;
  rate_per_trip?: string | null;
  service_area?: string[];
}
export interface GeoInput {
  lat: number;
  lng: number;
}
export type ShipmentStatus = 'assigned' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled';

// Deals whose species is under an active movement restriction at the farm, its
// province, or the delivery point are not offered to haulers.
const NOT_RESTRICTED = `not exists (
  select 1 from restricted_zones rz
   where rz.species = d.species
     and rz.location_code in (d.municipality_code, d.province_code, d.dropoff_location_code)
     and rz.starts_on <= current_date and (rz.ends_on is null or rz.ends_on >= current_date))`;

const JOB_SQL = `
  select d.id, d.species::text as species, d.weight_class_id, d.agreed_heads, d.agreed_weight_kg::text as agreed_weight_kg,
         d.municipality_code, d.province_code, d.dropoff_location_code, d.accepted_at::text as accepted_at,
         o.pickup_on::text as pickup_on, f.name as farm_name
    from deals d join offers o on o.id = d.offer_id join listings l on l.id = d.listing_id
    join livestock_lots lot on lot.id = l.lot_id join farms f on f.id = lot.farm_id`;

const SHIPMENT_SQL = `
  select s.id, s.deal_id, s.status::text as status, s.hauler_id, hu.full_name as hauler_name, s.vehicle_plate,
         s.shipping_permit_no, s.vet_health_cert_no, s.head_count_at_pickup, s.agreed_fee::text as agreed_fee,
         s.scheduled_pickup_at::text as scheduled_pickup_at, s.picked_up_at::text as picked_up_at, s.delivered_at::text as delivered_at,
         s.photo_keys, s.cancel_reason, s.created_at::text as created_at,
         d.species::text as species, d.agreed_heads, d.municipality_code, d.dropoff_location_code, d.state::text as deal_state,
         d.farmer_id, fu.full_name as farmer_name, d.buyer_id, bu.full_name as buyer_name, f.name as farm_name
    from shipments s join users hu on hu.id = s.hauler_id join deals d on d.id = s.deal_id
    join users fu on fu.id = d.farmer_id join users bu on bu.id = d.buyer_id
    join listings l on l.id = d.listing_id join livestock_lots lot on lot.id = l.lot_id join farms f on f.id = lot.farm_id`;

@Injectable()
export class LogisticsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(LocationsService) private readonly locations: LocationsService,
    @Inject(DealsService) private readonly deals: DealsService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  private requireHauler(user: AccessClaims, verified: boolean) {
    if (!user.roles.includes('hauler')) throw ProblemException.forbidden('Hauler role required');
    if (verified && user.ver !== 'verified') throw ProblemException.forbidden('Your hauler account is not verified yet. Verification usually takes 2 working days.');
  }

  // ---- profile -------------------------------------------------------------

  private profileDto(r: Record<string, unknown>) {
    return {
      user_id: String(r.user_id),
      hauler_name: String(r.hauler_name),
      verified: r.verification === 'verified',
      vehicle_plate: String(r.vehicle_plate),
      vehicle_type: String(r.vehicle_type),
      capacity_heads: int(r.capacity_heads),
      capacity_kg: weight(r.capacity_kg),
      rate_per_head: money(r.rate_per_head),
      rate_per_trip: money(r.rate_per_trip),
      service_area: (r.service_area as string[] | null) ?? [],
      created_at: isoTime(r.created_at)!,
    };
  }

  private async profileRow(userId: string) {
    return this.db.one<Record<string, unknown>>(
      `select hp.*, u.full_name as hauler_name, u.verification::text as verification
         from hauler_profiles hp join users u on u.id = hp.user_id where hp.user_id = $1`,
      [userId],
    );
  }

  async getProfile(user: AccessClaims) {
    const r = await this.profileRow(user.sub);
    if (!r) throw ProblemException.notFound('No hauler profile yet');
    return this.profileDto(r);
  }

  async putProfile(user: AccessClaims, input: HaulerProfileInput) {
    this.requireHauler(user, false);
    const area = input.service_area ?? [];
    if (area.length) {
      const { rows } = await this.db.query<{ n: string }>(`select count(*)::text as n from locations where psgc_code = any($1::text[])`, [area]);
      if (int(rows[0].n) !== new Set(area).size) throw ProblemException.validation([{ field: 'service_area', message: 'Unknown location code' }]);
    }
    await this.db.query(
      `insert into hauler_profiles (user_id, vehicle_plate, vehicle_type, capacity_heads, capacity_kg, rate_per_head, rate_per_trip, service_area)
       values ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8::text[])
       on conflict (user_id) do update set vehicle_plate = excluded.vehicle_plate, vehicle_type = excluded.vehicle_type, capacity_heads = excluded.capacity_heads,
         capacity_kg = excluded.capacity_kg, rate_per_head = excluded.rate_per_head, rate_per_trip = excluded.rate_per_trip, service_area = excluded.service_area`,
      [user.sub, input.vehicle_plate.toUpperCase().replace(/\s+/g, ' ').trim(), input.vehicle_type, input.capacity_heads, input.capacity_kg ?? null, input.rate_per_head ?? null, input.rate_per_trip ?? null, area],
    );
    return this.getProfile(user);
  }

  // ---- job board -----------------------------------------------------------

  private async jobDto(r: Record<string, unknown>, capacity: number | null) {
    return {
      deal_id: String(r.id),
      species: r.species as Species,
      heads: int(r.agreed_heads),
      estimated_weight_kg: weight(r.agreed_weight_kg),
      pickup: await this.locations.get(String(r.municipality_code)),
      farm_name: String(r.farm_name),
      dropoff: r.dropoff_location_code ? await this.locations.get(String(r.dropoff_location_code)) : null,
      pickup_on: (r.pickup_on as string | null)?.slice(0, 10) ?? null,
      fits_capacity: capacity === null ? null : int(r.agreed_heads) <= capacity,
      needs: ['LGU shipping permit', 'veterinary health certificate', 'load photo at pickup'],
      accepted_at: isoTime(r.accepted_at)!,
    };
  }

  async listJobs(user: AccessClaims, q: { species?: Species; province_code?: string; fits_my_truck?: boolean; limit: number }) {
    this.requireHauler(user, false);
    const profile = await this.profileRow(user.sub);
    const capacity = profile ? int(profile.capacity_heads) : null;
    const params: unknown[] = [];
    const where = [`d.state = 'accepted'`, 'd.needs_hauler', NOT_RESTRICTED];
    if (q.species) {
      params.push(q.species);
      where.push(`d.species = $${params.length}::species`);
    }
    if (q.province_code) {
      params.push(q.province_code);
      where.push(`d.province_code = $${params.length}`);
    }
    if (q.fits_my_truck && capacity !== null) {
      params.push(capacity);
      where.push(`d.agreed_heads <= $${params.length}`);
    }
    params.push(q.limit);
    // Jobs inside the hauler's declared service area come first, then soonest pickup.
    const area = (profile?.service_area as string[] | null) ?? [];
    params.push(area);
    const { rows } = await this.db.query<Record<string, unknown>>(
      `${JOB_SQL} where ${where.join(' and ')}
        order by (d.municipality_code = any($${params.length}::text[]) or d.province_code = any($${params.length}::text[])) desc,
                 o.pickup_on nulls last, d.accepted_at
        limit $${params.length - 1}`,
      params,
    );
    return { items: await Promise.all(rows.map((r) => this.jobDto(r, capacity))) };
  }

  async accept(user: AccessClaims, dealId: string, input: { agreed_fee: string; scheduled_pickup_at: string }) {
    this.requireHauler(user, true);
    const profile = await this.profileRow(user.sub);
    if (!profile) throw ProblemException.conflict('Add your truck under Profile before taking jobs');
    const job = await this.db.one<Record<string, unknown>>(`${JOB_SQL} where d.id = $1 and d.state = 'accepted' and d.needs_hauler and ${NOT_RESTRICTED}`, [dealId]);
    if (!job) throw ProblemException.conflict('This job is no longer available or is inside a restricted zone');
    if (int(job.agreed_heads) > int(profile.capacity_heads)) {
      throw ProblemException.conflict(`This job is ${job.agreed_heads} heads; your truck is registered for ${profile.capacity_heads}`);
    }
    const deal = await this.deals.row(dealId);
    if (deal.farmer_id === user.sub || deal.buyer_id === user.sub) throw ProblemException.forbidden('You cannot haul your own deal');
    const id = await this.db.tx(async (q) => {
      const { rows } = await q.query<{ id: string }>(
        `insert into shipments (deal_id, hauler_id, agreed_fee, scheduled_pickup_at, vehicle_plate) values ($1, $2, $3::numeric, $4::timestamptz, $5) returning id`,
        [dealId, user.sub, input.agreed_fee, input.scheduled_pickup_at, profile.vehicle_plate],
      );
      await q.query(`insert into shipment_events (shipment_id, status, kind, note) values ($1, 'assigned', 'accepted', $2)`, [rows[0].id, `job accepted, pickup ${input.scheduled_pickup_at}`]);
      await this.deals.transition(q, dealId, 'hauler_assigned', user.sub, `hauler ${profile.hauler_name} (${profile.vehicle_plate}) accepted the job`);
      return rows[0].id;
    });
    const when = new Date(input.scheduled_pickup_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
    for (const uid of [String(deal.farmer_id), String(deal.buyer_id)]) {
      void this.deals.notify(uid, `Presyo ng Hayop: hauler ${profile.hauler_name} (${profile.vehicle_plate}) will pick up on ${when}.`);
    }
    return this.get(user, id);
  }

  // ---- shipments -----------------------------------------------------------

  private async shipmentRow(id: string) {
    const r = await this.db.one<Record<string, unknown>>(`${SHIPMENT_SQL} where s.id = $1`, [id]);
    if (!r) throw ProblemException.notFound('Shipment not found');
    return r;
  }

  private party(r: Record<string, unknown>, user: AccessClaims): 'hauler' | 'farmer' | 'buyer' | 'admin' {
    if (r.hauler_id === user.sub) return 'hauler';
    if (r.farmer_id === user.sub) return 'farmer';
    if (r.buyer_id === user.sub) return 'buyer';
    if (user.roles.includes('admin')) return 'admin';
    throw ProblemException.notFound('Shipment not found');
  }

  private async dto(r: Record<string, unknown>, withEvents: boolean) {
    const events = withEvents
      ? (
          await this.db.query<Record<string, unknown>>(
            `select status::text as status, kind, note, geo_lnglat(geo) as ll, photo_key, created_at::text as created_at from shipment_events where shipment_id = $1 order by id`,
            [r.id],
          )
        ).rows.map((e) => {
          const ll = e.ll ? String(e.ll).split(' ').map(Number) : null;
          return {
            status: String(e.status),
            kind: (e.kind as string | null) ?? null,
            note: (e.note as string | null) ?? null,
            geo: ll && ll.length === 2 ? { lng: ll[0], lat: ll[1] } : null,
            photo_key: (e.photo_key as string | null) ?? null,
            created_at: isoTime(e.created_at)!,
          };
        })
      : undefined;
    const last = events?.filter((e) => e.geo).at(-1);
    return {
      id: String(r.id),
      deal_id: String(r.deal_id),
      status: r.status as ShipmentStatus,
      hauler_id: String(r.hauler_id),
      hauler_name: String(r.hauler_name),
      vehicle_plate: (r.vehicle_plate as string | null) ?? null,
      species: r.species as Species,
      heads: int(r.agreed_heads),
      pickup: await this.locations.get(String(r.municipality_code)),
      farm_name: String(r.farm_name),
      farmer_name: String(r.farmer_name),
      buyer_name: String(r.buyer_name),
      dropoff: r.dropoff_location_code ? await this.locations.get(String(r.dropoff_location_code)) : null,
      shipping_permit_no: (r.shipping_permit_no as string | null) ?? null,
      vet_health_cert_no: (r.vet_health_cert_no as string | null) ?? null,
      head_count_at_pickup: r.head_count_at_pickup == null ? null : int(r.head_count_at_pickup),
      agreed_fee: money(r.agreed_fee),
      scheduled_pickup_at: isoTime(r.scheduled_pickup_at),
      picked_up_at: isoTime(r.picked_up_at),
      delivered_at: isoTime(r.delivered_at),
      photo_keys: (r.photo_keys as string[] | null) ?? [],
      cancel_reason: (r.cancel_reason as string | null) ?? null,
      deal_state: String(r.deal_state),
      last_ping: last?.geo ? { ...last.geo, at: last.created_at } : null,
      ...(events ? { events } : {}),
      created_at: isoTime(r.created_at)!,
    };
  }

  async get(user: AccessClaims, id: string) {
    const r = await this.shipmentRow(id);
    this.party(r, user);
    return this.dto(r, true);
  }

  async listMine(user: AccessClaims, status?: ShipmentStatus) {
    this.requireHauler(user, false);
    const params: unknown[] = [user.sub];
    if (status) params.push(status);
    const { rows } = await this.db.query<Record<string, unknown>>(
      `${SHIPMENT_SQL} where s.hauler_id = $1 ${status ? 'and s.status = $2::shipment_status' : ''}
        order by case s.status when 'in_transit' then 0 when 'picked_up' then 0 when 'assigned' then 1 else 2 end, s.scheduled_pickup_at nulls last, s.created_at desc`,
      params,
    );
    return { items: await Promise.all(rows.map((r) => this.dto(r, false))) };
  }

  private mine(r: Record<string, unknown>, user: AccessClaims, expected: ShipmentStatus[]) {
    if (r.hauler_id !== user.sub) throw ProblemException.forbidden('This shipment is assigned to another hauler');
    if (!expected.includes(r.status as ShipmentStatus)) throw ProblemException.conflict(`The shipment is ${r.status}`);
  }

  private geoSql(geo: GeoInput | null | undefined, params: unknown[]) {
    if (!geo) return 'null';
    params.push(geo.lng, geo.lat);
    return `geo_from_lnglat($${params.length - 1}::double precision, $${params.length}::double precision)`;
  }

  private async checkPhotos(user: AccessClaims, keys: string[]) {
    for (const k of keys) {
      if (!this.storage.isValidKey(k) || !k.startsWith(`shipment_photo/${user.sub}/`)) throw ProblemException.validation([{ field: 'photo_keys', message: `Not one of your shipment photos: ${k}` }]);
      if (!(await this.storage.exists(k))) throw ProblemException.validation([{ field: 'photo_keys', message: `Photo was not uploaded: ${k}` }]);
    }
  }

  /** Pickup checklist complete: permit, vet certificate, head count, load photo. Trip starts. */
  async start(user: AccessClaims, id: string, input: { shipping_permit_no: string; vet_health_cert_no: string; head_count: number; photo_keys: string[]; note?: string | null; geo?: GeoInput | null }) {
    const r = await this.shipmentRow(id);
    this.mine(r, user, ['assigned']);
    await this.checkPhotos(user, input.photo_keys);
    const shortfall = int(r.agreed_heads) - input.head_count;
    const note = [input.note, shortfall > 0 ? `${shortfall} fewer heads than agreed (${input.head_count} of ${r.agreed_heads})` : null].filter(Boolean).join('. ') || null;
    await this.db.tx(async (q) => {
      await q.query(
        `update shipments set status = 'in_transit', shipping_permit_no = $2, vet_health_cert_no = $3, head_count_at_pickup = $4, picked_up_at = now(),
                photo_keys = photo_keys || $5::text[], updated_at = now() where id = $1`,
        [id, input.shipping_permit_no.trim(), input.vet_health_cert_no.trim(), input.head_count, input.photo_keys],
      );
      const params: unknown[] = [id, note];
      const geo = this.geoSql(input.geo, params);
      params.push(input.photo_keys[0]);
      await q.query(`insert into shipment_events (shipment_id, status, kind, note, geo, photo_key) values ($1, 'in_transit', 'pickup', $2, ${geo}, $${params.length})`, params);
      await this.deals.transition(q, String(r.deal_id), 'in_transit', user.sub, `picked up ${input.head_count} heads; permit ${input.shipping_permit_no.trim()}, vet cert ${input.vet_health_cert_no.trim()}`);
    });
    void this.deals.notify(String(r.buyer_id), `Presyo ng Hayop: ${input.head_count} ${r.species} loaded at ${r.farm_name}, on the way. Track in the app.`);
    void this.deals.notify(String(r.farmer_id), `Presyo ng Hayop: the hauler recorded ${input.head_count} heads picked up${shortfall > 0 ? ` (${shortfall} fewer than agreed)` : ''}.`);
    return this.get(user, id);
  }

  async ping(user: AccessClaims, id: string, input: { geo: GeoInput; kind: 'position' | 'checkpoint' | 'delay' | 'problem'; note?: string | null }) {
    const r = await this.shipmentRow(id);
    this.mine(r, user, ['in_transit', 'picked_up']);
    const params: unknown[] = [id, input.kind, input.note ?? null];
    const geo = this.geoSql(input.geo, params);
    await this.db.query(`insert into shipment_events (shipment_id, status, kind, note, geo) values ($1, 'in_transit', $2, $3, ${geo})`, params);
    if (input.kind === 'delay' || input.kind === 'problem') {
      void this.deals.notify(String(r.buyer_id), `Presyo ng Hayop: hauler reports a ${input.kind}${input.note ? `: ${input.note}` : ''}.`);
    }
  }

  /** Hauler hands over. The buyer still confirms count and weight on the deal. */
  async delivered(user: AccessClaims, id: string, input: { note?: string | null; photo_keys?: string[]; geo?: GeoInput | null }) {
    const r = await this.shipmentRow(id);
    this.mine(r, user, ['in_transit', 'picked_up']);
    const keys = input.photo_keys ?? [];
    await this.checkPhotos(user, keys);
    await this.db.tx(async (q) => {
      await q.query(`update shipments set status = 'delivered', delivered_at = now(), photo_keys = photo_keys || $2::text[], updated_at = now() where id = $1`, [id, keys]);
      const params: unknown[] = [id, input.note ?? null];
      const geo = this.geoSql(input.geo, params);
      params.push(keys[0] ?? null);
      await q.query(`insert into shipment_events (shipment_id, status, kind, note, geo, photo_key) values ($1, 'delivered', 'handover', $2, ${geo}, $${params.length})`, params);
    });
    void this.deals.notify(String(r.buyer_id), 'Presyo ng Hayop: the hauler marked the load as handed over. Count and weigh, then confirm delivery in the app.');
    return this.get(user, id);
  }

  /** Hauler withdraws before pickup; the deal returns to accepted and the job reopens. */
  async cancel(user: AccessClaims, id: string, reason: string) {
    const r = await this.shipmentRow(id);
    this.mine(r, user, ['assigned']);
    await this.db.tx(async (q) => {
      await q.query(`update shipments set status = 'cancelled', cancel_reason = $2, updated_at = now() where id = $1`, [id, reason]);
      await q.query(`insert into shipment_events (shipment_id, status, kind, note) values ($1, 'cancelled', 'cancelled', $2)`, [id, reason]);
      await this.deals.transition(q, String(r.deal_id), 'accepted', user.sub, `hauler withdrew: ${reason}. Job reopened`);
    });
    for (const uid of [String(r.farmer_id), String(r.buyer_id)]) {
      void this.deals.notify(uid, `Presyo ng Hayop: the hauler withdrew (${reason}). The job is open to other haulers again.`);
    }
    return this.get(user, id);
  }

  /** For the console: the deal's shipment as the deal DTO shows it. */
  summaryFor(r: Record<string, unknown>) {
    return shipmentSummary(r);
  }
}
