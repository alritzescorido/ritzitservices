import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import type { AccessClaims } from '../auth/auth.guard.js';
import { SMS_PROVIDER, type SmsProvider } from '../auth/sms.provider.js';
import { int, isoTime, money, weight } from '../common/format.js';
import { ProblemException } from '../common/problem.js';
import { DbService, type Queryable } from '../db/db.service.js';
import { LocationsService } from '../locations/locations.service.js';
import { PricesService, type Species } from '../prices/prices.service.js';

// Deals move only along deal_transition_allowed() in the database; this
// service decides who may push which transition and records who did it.
// Only a settled deal feeds the price board, and settlement refreshes today's
// snapshot immediately ("updated after every sale").

export type DealState = 'accepted' | 'hauler_assigned' | 'in_transit' | 'delivered' | 'settled' | 'cancelled' | 'disputed' | 'refunded';

/** Booking-deposit follow-ups, registered by DepositsService when a payment provider is on. Called after commits. */
export interface DepositHooks {
  afterAccepted(dealId: string): Promise<void>;
  afterSettled(dealId: string): Promise<void>;
  afterCancelled(dealId: string, who: 'farmer' | 'buyer' | 'system'): Promise<void>;
  afterDisputeResolved(dealId: string, decision: 'release_to_farmer' | 'refund_to_buyer' | 'hold'): Promise<void>;
}

const DEAL_SQL = `
  select d.id, d.listing_id, d.offer_id, d.farmer_id, fu.full_name as farmer_name, d.buyer_id, bu.full_name as buyer_name,
         d.species::text as species, d.weight_class_id, d.unit::text as unit, d.state::text as state,
         d.agreed_price::text as agreed_price, d.agreed_heads, d.agreed_weight_kg::text as agreed_weight_kg,
         d.delivered_heads, d.delivered_weight_kg::text as delivered_weight_kg, d.delivery_note, d.cancel_reason,
         d.municipality_code, d.dropoff_location_code, d.needs_hauler, d.deposit_required, d.deposit_status::text as deposit_status, d.payment_method, d.payment_reference,
         d.buyer_paid_at::text as buyer_paid_at, d.farmer_confirmed_at::text as farmer_confirmed_at,
         d.outlier_flag, d.counts_for_price,
         d.accepted_at::text as accepted_at, d.delivered_at::text as delivered_at, d.settled_at::text as settled_at, d.cancelled_at::text as cancelled_at,
         s.id as shipment_id, s.status::text as shipment_status, s.hauler_id, hu.full_name as hauler_name, s.vehicle_plate,
         s.shipping_permit_no, s.vet_health_cert_no, s.head_count_at_pickup, s.agreed_fee::text as agreed_fee,
         s.scheduled_pickup_at::text as scheduled_pickup_at, s.picked_up_at::text as picked_up_at, s.delivered_at::text as shipment_delivered_at,
         lp.ll as last_ping_ll, lp.at as last_ping_at,
         dp.id as deposit_id, dp.amount::text as deposit_amount, dp.booking::text as deposit_booking, dp.commission::text as deposit_commission, dp.expires_at::text as deposit_expires_at, dp.paid_at::text as deposit_paid_at, dp.closed_at::text as deposit_closed_at
    from deals d join users fu on fu.id = d.farmer_id join users bu on bu.id = d.buyer_id
    left join shipments s on s.deal_id = d.id and s.status <> 'cancelled' left join users hu on hu.id = s.hauler_id
    left join lateral (select geo_lnglat(e.geo) as ll, e.created_at::text as at from shipment_events e where e.shipment_id = s.id and e.geo is not null order by e.id desc limit 1) lp on true
    left join lateral (select * from deposits x where x.deal_id = d.id order by x.created_at desc limit 1) dp on true`;

/** Shipment fields as they appear inside a deal; the full record lives in LogisticsService. */
export function shipmentSummary(r: Record<string, unknown>) {
  if (!r.shipment_id) return null;
  const ll = r.last_ping_ll ? String(r.last_ping_ll).split(' ').map(Number) : null;
  return {
    id: String(r.shipment_id),
    status: String(r.shipment_status),
    hauler_id: String(r.hauler_id),
    hauler_name: String(r.hauler_name),
    vehicle_plate: (r.vehicle_plate as string | null) ?? null,
    shipping_permit_no: (r.shipping_permit_no as string | null) ?? null,
    vet_health_cert_no: (r.vet_health_cert_no as string | null) ?? null,
    head_count_at_pickup: r.head_count_at_pickup == null ? null : int(r.head_count_at_pickup),
    agreed_fee: money(r.agreed_fee),
    scheduled_pickup_at: isoTime(r.scheduled_pickup_at),
    picked_up_at: isoTime(r.picked_up_at),
    delivered_at: isoTime(r.shipment_delivered_at),
    last_ping: ll && ll.length === 2 ? { lng: ll[0], lat: ll[1], at: isoTime(r.last_ping_at)! } : null,
  };
}

@Injectable()
export class DealsService {
  private readonly log = new Logger(DealsService.name);

  /** Set by DepositsService when PAYMENTS_PROVIDER is not off. */
  depositHooks: DepositHooks | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DbService) private readonly db: DbService,
    @Inject(LocationsService) private readonly locations: LocationsService,
    @Inject(PricesService) private readonly prices: PricesService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private hook(fn: (h: DepositHooks) => Promise<void>) {
    if (!this.depositHooks) return Promise.resolve();
    return fn(this.depositHooks).catch((e) => this.log.error(`deposit hook: ${(e as Error).message}`));
  }

  /** MarketService calls this once the accept transaction has committed. */
  afterAccepted(dealId: string) {
    return this.hook((h) => h.afterAccepted(dealId));
  }

  // ---- read ----------------------------------------------------------------

  private async dto(r: Record<string, unknown>, withEvents: boolean) {
    const classes = await this.prices.weightClasses(r.species as Species);
    const price = Number(r.agreed_price);
    const perHead = r.unit === 'per_head';
    const est = perHead ? price * int(r.agreed_heads) : r.agreed_weight_kg ? price * Number(r.agreed_weight_kg) : null;
    const fin = r.delivered_heads == null ? null : perHead ? price * int(r.delivered_heads) : r.delivered_weight_kg ? price * Number(r.delivered_weight_kg) : null;
    const events = withEvents
      ? (
          await this.db.query<Record<string, unknown>>(
            `select from_state::text as from_state, to_state::text as to_state, actor_id, note, created_at::text as created_at from deal_events where deal_id = $1 order by id`,
            [r.id],
          )
        ).rows.map((e) => ({
          from_state: (e.from_state as string | null) ?? null,
          to_state: String(e.to_state),
          actor_id: (e.actor_id as string | null) ?? null,
          note: (e.note as string | null) ?? null,
          created_at: isoTime(e.created_at)!,
        }))
      : undefined;
    return {
      id: String(r.id),
      listing_id: String(r.listing_id),
      offer_id: String(r.offer_id),
      farmer_id: String(r.farmer_id),
      farmer_name: String(r.farmer_name),
      buyer_id: String(r.buyer_id),
      buyer_name: String(r.buyer_name),
      species: r.species as Species,
      weight_class: classes.find((c) => c.id === int(r.weight_class_id)),
      unit: r.unit as 'per_kg_liveweight' | 'per_head',
      state: r.state as DealState,
      agreed_price: money(r.agreed_price)!,
      agreed_heads: int(r.agreed_heads),
      agreed_weight_kg: weight(r.agreed_weight_kg),
      estimated_total: est === null ? null : money(est),
      delivered_heads: r.delivered_heads == null ? null : int(r.delivered_heads),
      delivered_weight_kg: weight(r.delivered_weight_kg),
      final_total: fin === null ? null : money(fin),
      delivery_note: (r.delivery_note as string | null) ?? null,
      cancel_reason: (r.cancel_reason as string | null) ?? null,
      needs_hauler: Boolean(r.needs_hauler),
      payment_method: (r.payment_method as string | null) ?? null,
      payment_reference: (r.payment_reference as string | null) ?? null,
      buyer_paid_at: isoTime(r.buyer_paid_at),
      farmer_confirmed_at: isoTime(r.farmer_confirmed_at),
      outlier_flag: Boolean(r.outlier_flag),
      counts_for_price: Boolean(r.counts_for_price),
      location: await this.locations.get(String(r.municipality_code)),
      dropoff: r.dropoff_location_code ? await this.locations.get(String(r.dropoff_location_code)) : null,
      shipment: shipmentSummary(r),
      deposit_required: Boolean(r.deposit_required),
      deposit: r.deposit_id
        ? {
            id: String(r.deposit_id),
            status: String(r.deposit_status),
            amount: money(r.deposit_amount)!,
            booking: money(r.deposit_booking ?? r.deposit_amount)!,
            commission: money(r.deposit_commission ?? 0)!,
            expires_at: isoTime(r.deposit_expires_at)!,
            paid_at: isoTime(r.deposit_paid_at),
            closed_at: isoTime(r.deposit_closed_at),
          }
        : null,
      ...(events ? { events } : {}),
      accepted_at: isoTime(r.accepted_at)!,
      delivered_at: isoTime(r.delivered_at),
      settled_at: isoTime(r.settled_at),
      cancelled_at: isoTime(r.cancelled_at),
    };
  }

  async row(dealId: string, q: Queryable = this.db) {
    const { rows } = await q.query<Record<string, unknown>>(`${DEAL_SQL} where d.id = $1`, [dealId]);
    if (!rows[0]) throw ProblemException.notFound('Deal not found');
    return rows[0];
  }

  party(r: Record<string, unknown>, user: AccessClaims): 'farmer' | 'buyer' | 'admin' {
    if (r.farmer_id === user.sub) return 'farmer';
    if (r.buyer_id === user.sub) return 'buyer';
    if (user.roles.includes('admin')) return 'admin';
    throw ProblemException.notFound('Deal not found');
  }

  async get(user: AccessClaims, dealId: string) {
    const r = await this.row(dealId);
    this.party(r, user);
    return this.dto(r, true);
  }

  async listMine(user: AccessClaims, q: { state?: DealState; cursor?: string; limit: number }) {
    const params: unknown[] = [user.sub];
    const where = ['(d.farmer_id = $1 or d.buyer_id = $1)'];
    if (q.state) {
      params.push(q.state);
      where.push(`d.state = $${params.length}::deal_state`);
    }
    if (q.cursor) {
      const [ts, id] = Buffer.from(q.cursor, 'base64url').toString('utf8').split(' ');
      params.push(ts, id);
      where.push(`(d.accepted_at, d.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(q.limit + 1);
    const { rows } = await this.db.query<Record<string, unknown>>(`${DEAL_SQL} where ${where.join(' and ')} order by d.accepted_at desc, d.id desc limit $${params.length}`, params);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: await Promise.all(page.map((r) => this.dto(r, false))),
      next_cursor: rows.length > q.limit && last ? Buffer.from(`${last.accepted_at} ${last.id}`).toString('base64url') : null,
    };
  }

  /** Admin console: every deal, filterable, newest first. */
  async adminList(q: { state?: DealState; species?: Species; province_code?: string; outliers_only?: boolean; cursor?: string; limit: number }) {
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.state) add('d.state = ?::deal_state', q.state);
    if (q.species) add('d.species = ?::species', q.species);
    if (q.province_code) add('d.province_code = ?', q.province_code);
    if (q.outliers_only) where.push('d.outlier_flag');
    if (q.cursor) {
      const [ts, id] = Buffer.from(q.cursor, 'base64url').toString('utf8').split(' ');
      params.push(ts, id);
      where.push(`(d.accepted_at, d.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(q.limit + 1);
    const { rows } = await this.db.query<Record<string, unknown>>(
      `${DEAL_SQL} ${where.length ? `where ${where.join(' and ')}` : ''} order by d.accepted_at desc, d.id desc limit $${params.length}`,
      params,
    );
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: await Promise.all(page.map((r) => this.dto(r, false))),
      next_cursor: rows.length > q.limit && last ? Buffer.from(`${last.accepted_at} ${last.id}`).toString('base64url') : null,
    };
  }

  // ---- create (called by MarketService inside its transaction) --------------

  async createFromOffer(
    q: Queryable,
    o: { offerId: string; listingId: string; lotId: string; farmerId: string; buyerId: string; price: string; heads: number; needsHauler: boolean; dropoffCode: string | null; actorId: string },
  ): Promise<string> {
    const lot = (
      await q.query<{ species: Species; weight_class_id: number; unit: string; avg_weight_kg: string | null; muni: string | null; prov: string | null }>(
        `select lot.species::text as species, lot.weight_class_id, wc.unit::text as unit, lot.avg_weight_kg::text as avg_weight_kg,
                b.parent_code as muni, m.parent_code as prov
           from livestock_lots lot join farms f on f.id = lot.farm_id join locations b on b.psgc_code = f.barangay_code
           left join locations m on m.psgc_code = b.parent_code join weight_classes wc on wc.id = lot.weight_class_id
          where lot.id = $1`,
        [o.lotId],
      )
    ).rows[0];
    if (!lot?.muni || !lot.prov) throw ProblemException.conflict('The farm location is incomplete; the farmer must fix the barangay first');
    const agreedWeight = lot.avg_weight_kg ? Number(lot.avg_weight_kg) * o.heads : null;
    const { rows } = await q.query<{ id: string }>(
      `insert into deals (listing_id, offer_id, farmer_id, buyer_id, species, weight_class_id, unit, agreed_price, agreed_heads, agreed_weight_kg,
                          municipality_code, province_code, needs_hauler, dropoff_location_code)
       values ($1, $2, $3, $4, $5::species, $6, $7::price_unit, $8::numeric, $9, $10::numeric, $11, $12, $13, $14) returning id`,
      [o.listingId, o.offerId, o.farmerId, o.buyerId, lot.species, lot.weight_class_id, lot.unit, o.price, o.heads, agreedWeight, lot.muni, lot.prov, o.needsHauler, o.dropoffCode],
    );
    await q.query(`insert into deal_events (deal_id, from_state, to_state, actor_id, note) values ($1, null, 'accepted', $2, 'offer accepted')`, [rows[0].id, o.actorId]);
    return rows[0].id;
  }

  // ---- transitions ---------------------------------------------------------

  /** Set state through the trigger, then stamp the actor on the event it wrote. Also used by LogisticsService. */
  async transition(q: Queryable, dealId: string, to: DealState, actorId: string, note: string | null, extraSet = '', extraParams: unknown[] = []) {
    const params = [dealId, to, ...extraParams];
    try {
      await q.query(`update deals set state = $2::deal_state ${extraSet} where id = $1`, params);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('cannot move from')) throw ProblemException.conflict(msg.replace(/^deal [0-9a-f-]+ /, 'The deal '));
      throw e;
    }
    await q.query(
      `update deal_events set actor_id = $2, note = $3 where id = (select max(id) from deal_events where deal_id = $1)`,
      [dealId, actorId, note],
    );
  }

  async deliver(user: AccessClaims, dealId: string, input: { delivered_heads: number; delivered_weight_kg?: string | null; note?: string | null }) {
    const r = await this.row(dealId);
    if (this.party(r, user) !== 'buyer') throw ProblemException.forbidden('Only the buyer confirms delivery');
    if (!['accepted', 'in_transit'].includes(String(r.state))) throw ProblemException.conflict(`The deal is ${r.state}, not awaiting delivery`);
    const note = r.needs_hauler && r.state === 'accepted' ? `${input.note ?? ''} (delivered without an in-app hauler record)`.trim() : input.note ?? null;
    await this.db.tx((q) =>
      this.transition(q, dealId, 'delivered', user.sub, note, `, delivered_heads = $3, delivered_weight_kg = $4::numeric, delivery_note = $5`, [
        input.delivered_heads,
        input.delivered_weight_kg ?? null,
        input.note ?? null,
      ]),
    );
    void this.notify(String(r.farmer_id), 'Presyo ng Hayop: the buyer confirmed delivery. Confirm in the app once the payment reaches you.');
    return this.get(user, dealId);
  }

  async pay(user: AccessClaims, dealId: string, input: { method: 'gcash' | 'bank' | 'cash'; reference?: string | null }) {
    const r = await this.row(dealId);
    if (this.party(r, user) !== 'buyer') throw ProblemException.forbidden('Only the buyer records the payment');
    if (r.state !== 'delivered') throw ProblemException.conflict(`The deal is ${r.state}; record payment after delivery`);
    await this.db.query(`update deals set payment_method = $2, payment_reference = $3, buyer_paid_at = now(), updated_at = now() where id = $1`, [dealId, input.method, input.reference ?? null]);
    void this.notify(String(r.farmer_id), `Presyo ng Hayop: the buyer says they paid by ${input.method}${input.reference ? ` (ref ${input.reference})` : ''}. Confirm in the app when it arrives.`);
    return this.get(user, dealId);
  }

  async confirmPayment(user: AccessClaims, dealId: string) {
    const r = await this.row(dealId);
    if (this.party(r, user) !== 'farmer') throw ProblemException.forbidden('Only the farmer confirms the payment arrived');
    if (r.state !== 'delivered') throw ProblemException.conflict(`The deal is ${r.state}`);
    if (!r.buyer_paid_at) throw ProblemException.conflict('The buyer has not recorded a payment yet');
    // Phase 4: a buyer settling more than the weekly limit is held out of the board until an admin looks (manipulation guard).
    const recent = await this.db.one<{ n: string }>(
      `select count(*)::text as n from deals where buyer_id = $1 and state = 'settled' and settled_at > now() - interval '7 days'`,
      [r.buyer_id],
    );
    const overLimit = int(recent?.n ?? 0) >= this.config.SETTLEMENTS_PER_BUYER_PER_WEEK;
    await this.db.tx(async (q) => {
      await this.transition(q, dealId, 'settled', user.sub, 'payment confirmed by farmer', `, farmer_confirmed_at = now()`);
      if (overLimit) {
        await q.query(`update deals set outlier_flag = true, counts_for_price = false where id = $1`, [dealId]);
        await q.query(`insert into deal_events (deal_id, from_state, to_state, note) values ($1, 'settled', 'settled', $2)`, [
          dealId,
          `held out of the board: buyer settled ${recent?.n} deals in 7 days (limit ${this.config.SETTLEMENTS_PER_BUYER_PER_WEEK}); admin review`,
        ]);
      }
      await q.query(`select refresh_price_snapshots(current_date, 7)`); // "updated after every sale"
    });
    void this.notify(String(r.buyer_id), 'Presyo ng Hayop: the farmer confirmed your payment. Deal settled. You can rate each other in the app.');
    await this.hook((h) => h.afterSettled(dealId));
    return this.get(user, dealId);
  }

  async cancel(user: AccessClaims, dealId: string, reason: string) {
    const r = await this.row(dealId);
    const who = this.party(r, user);
    if (who === 'admin') throw ProblemException.forbidden('Admins resolve disputes; parties cancel');
    if (!['accepted', 'hauler_assigned'].includes(String(r.state))) throw ProblemException.conflict(`The deal is ${r.state} and can no longer be cancelled`);
    await this.db.tx(async (q) => {
      await this.transition(q, dealId, 'cancelled', user.sub, `${who} cancelled: ${reason}`, `, cancel_reason = $3`, [reason]);
      await q.query(`update listings set status = 'active', updated_at = now() where id = $1 and status = 'matched'`, [r.listing_id]);
    });
    void this.notify(String(who === 'farmer' ? r.buyer_id : r.farmer_id), `Presyo ng Hayop: the ${who} cancelled the deal. Reason: ${reason}`);
    await this.hook((h) => h.afterCancelled(dealId, who));
    return this.get(user, dealId);
  }

  /** The platform cancels (a booking deposit was not paid in time). The listing returns to the board. */
  async systemCancel(dealId: string, reason: string) {
    const r = await this.row(dealId);
    if (!['accepted', 'hauler_assigned'].includes(String(r.state))) return;
    await this.db.tx(async (q) => {
      await q.query(`update deals set state = 'cancelled', cancel_reason = $2 where id = $1`, [dealId, reason]);
      await q.query(`update deal_events set note = $2 where id = (select max(id) from deal_events where deal_id = $1)`, [dealId, `system cancelled: ${reason}`]);
      await q.query(`update listings set status = 'active', updated_at = now() where id = $1 and status = 'matched'`, [r.listing_id]);
    });
    void this.notify(String(r.farmer_id), `Presyo ng Hayop: the buyer did not pay the booking deposit in time. Your listing is back on the board.`);
    void this.notify(String(r.buyer_id), `Presyo ng Hayop: the booking deposit was not paid in time and the deal lapsed. The animals are available to other buyers again.`);
  }

  async openDispute(user: AccessClaims, dealId: string, input: { reason: string; details?: string | null }) {
    const r = await this.row(dealId);
    const who = this.party(r, user);
    if (who === 'admin') throw ProblemException.forbidden('Parties open disputes');
    if (r.state !== 'delivered') throw ProblemException.conflict(`Disputes are opened after delivery; the deal is ${r.state}`);
    const id = await this.db.tx(async (q) => {
      await this.transition(q, dealId, 'disputed', user.sub, `${who} disputed: ${input.reason}`);
      const { rows } = await q.query<{ id: string }>(`insert into disputes (deal_id, raised_by, reason, details) values ($1, $2, $3, $4) returning id`, [dealId, user.sub, input.reason, input.details ?? null]);
      return rows[0].id;
    });
    void this.notify(String(who === 'farmer' ? r.buyer_id : r.farmer_id), `Presyo ng Hayop: a dispute was opened on your deal (${input.reason}). An admin will review it.`);
    return this.dispute(id);
  }

  async rate(user: AccessClaims, dealId: string, input: { score: number; comment?: string | null }) {
    const r = await this.row(dealId);
    const who = this.party(r, user);
    if (who === 'admin') throw ProblemException.forbidden('Parties rate each other');
    if (r.state !== 'settled') throw ProblemException.conflict('Rate after the deal settles');
    const ratee = who === 'farmer' ? String(r.buyer_id) : String(r.farmer_id);
    const dup = await this.db.one(`select 1 from ratings where deal_id = $1 and rater_id = $2`, [dealId, user.sub]);
    if (dup) throw ProblemException.conflict('You already rated this deal');
    await this.db.query(`insert into ratings (deal_id, rater_id, ratee_id, score, comment) values ($1, $2, $3, $4, $5)`, [dealId, user.sub, ratee, input.score, input.comment ?? null]);
  }

  // ---- disputes (admin) ----------------------------------------------------

  async dispute(id: string) {
    const r = await this.db.one<Record<string, unknown>>(
      `select ds.*, case when ds.raised_by = d.farmer_id then 'farmer' else 'buyer' end as raised_by_role
         from disputes ds join deals d on d.id = ds.deal_id where ds.id = $1`,
      [id],
    );
    if (!r) throw ProblemException.notFound('Dispute not found');
    return {
      id: String(r.id),
      deal_id: String(r.deal_id),
      raised_by: String(r.raised_by),
      raised_by_role: r.raised_by_role as 'farmer' | 'buyer',
      reason: String(r.reason),
      details: (r.details as string | null) ?? null,
      status: String(r.status),
      resolution: (r.resolution as string | null) ?? null,
      resolved_by: (r.resolved_by as string | null) ?? null,
      deal: await this.dto(await this.row(String(r.deal_id)), true),
      created_at: isoTime(r.created_at)!,
      resolved_at: isoTime(r.resolved_at),
    };
  }

  async listDisputes(status?: string) {
    const { rows } = await this.db.query<{ id: string }>(
      `select id from disputes ${status ? 'where status = $1::dispute_status' : ''}
        order by case status when 'open' then 0 when 'under_review' then 1 else 2 end, created_at`,
      status ? [status] : [],
    );
    return Promise.all(rows.map((r) => this.dispute(r.id)));
  }

  async resolveDispute(
    adminId: string,
    disputeId: string,
    input: { outcome: 'settled' | 'refunded' | 'dismissed'; resolution: string; delivered_weight_kg?: string | null; deposit?: 'release_to_farmer' | 'refund_to_buyer' | 'hold' | null },
  ) {
    const ds = await this.db.one<{ deal_id: string; status: string }>(`select deal_id, status::text as status from disputes where id = $1`, [disputeId]);
    if (!ds) throw ProblemException.notFound('Dispute not found');
    if (!['open', 'under_review'].includes(ds.status)) throw ProblemException.conflict(`Dispute is already ${ds.status}`);
    const deal = await this.row(ds.deal_id);
    await this.db.tx(async (q) => {
      if (input.delivered_weight_kg) await q.query(`update deals set delivered_weight_kg = $2::numeric where id = $1`, [ds.deal_id, input.delivered_weight_kg]);
      const to: DealState = input.outcome === 'settled' ? 'settled' : input.outcome === 'refunded' ? 'refunded' : 'delivered';
      await this.transition(q, ds.deal_id, to, adminId, `admin resolved dispute: ${input.outcome}. ${input.resolution}`);
      if (to === 'settled') {
        await q.query(`update deals set farmer_confirmed_at = coalesce(farmer_confirmed_at, now()) where id = $1`, [ds.deal_id]);
        await q.query(`select refresh_price_snapshots(current_date, 7)`);
      }
      await q.query(
        `update disputes set status = $2::dispute_status, resolution = $3, resolved_by = $4, resolved_at = now() where id = $1`,
        [disputeId, input.outcome === 'settled' ? 'resolved_settled' : input.outcome === 'refunded' ? 'resolved_refunded' : 'dismissed', input.resolution, adminId],
      );
      await q.query(
        `insert into admin_audit_log (admin_id, action, target_type, target_id, before_json, after_json) values ($1, 'resolve_dispute', 'dispute', $2, $3::jsonb, $4::jsonb)`,
        [adminId, disputeId, JSON.stringify({ deal_state: deal.state, dispute_status: ds.status }), JSON.stringify(input)],
      );
    });
    for (const uid of [String(deal.farmer_id), String(deal.buyer_id)]) {
      void this.notify(uid, `Presyo ng Hayop: your dispute was resolved (${input.outcome}). ${input.resolution}`);
    }
    const decision = input.deposit ?? (input.outcome === 'settled' ? 'release_to_farmer' : input.outcome === 'refunded' ? 'refund_to_buyer' : 'hold');
    await this.hook((h) => h.afterDisputeResolved(ds.deal_id, decision));
    return this.dispute(disputeId);
  }

  async reviewOutlier(adminId: string, dealId: string, countsForPrice: boolean, note?: string | null) {
    const r = await this.row(dealId);
    if (r.state !== 'settled') throw ProblemException.conflict('Only settled deals are reviewed for the board');
    await this.db.tx(async (q) => {
      await q.query(`update deals set counts_for_price = $2, outlier_reviewed_by = $3, updated_at = now() where id = $1`, [dealId, countsForPrice, adminId]);
      await q.query(
        `insert into admin_audit_log (admin_id, action, target_type, target_id, before_json, after_json) values ($1, 'review_outlier', 'deal', $2, $3::jsonb, $4::jsonb)`,
        [adminId, dealId, JSON.stringify({ counts_for_price: r.counts_for_price }), JSON.stringify({ counts_for_price: countsForPrice, note: note ?? null })],
      );
      await q.query(`select refresh_price_snapshots(current_date, 7)`);
    });
    return this.dto(await this.row(dealId), true);
  }

  async notify(userId: string, message: string) {
    try {
      const row = await this.db.one<{ phone_e164: string }>(`select phone_e164 from users where id = $1`, [userId]);
      if (row) await this.sms.send(row.phone_e164, message);
    } catch (e) {
      this.log.warn(`notify failed: ${(e as Error).message}`);
    }
  }
}
