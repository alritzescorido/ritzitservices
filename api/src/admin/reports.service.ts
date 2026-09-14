import { Inject, Injectable } from '@nestjs/common';
import { int, isoTime, money, weight } from '../common/format.js';
import { DbService } from '../db/db.service.js';
import { LocationsService } from '../locations/locations.service.js';
import { UsersService } from '../users/users.service.js';

// Phase 4: the health of the whole system in one call, the users list, and a
// CSV of deals for the province admin's spreadsheet. Everything is computed
// from the same tables the apps write; nothing here is cached.

interface Period {
  from?: string;
  to?: string;
  province_code?: string;
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(LocationsService) private readonly locations: LocationsService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  private range(p: Period) {
    const to = p.to ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    const from = p.from ?? new Date(new Date(to).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    return { from, to };
  }

  async summary(p: Period) {
    const { from, to } = this.range(p);
    const params: unknown[] = [from, to];
    let prov = '';
    if (p.province_code) {
      params.push(p.province_code);
      prov = `and d.province_code = $3`;
    }
    // Deals counted by the date they were accepted; settled figures by settlement date.
    const inPeriod = `d.accepted_at >= $1::date and d.accepted_at < ($2::date + 1) ${prov}`;
    const settledIn = `d.state = 'settled' and d.settled_at >= $1::date and d.settled_at < ($2::date + 1) ${prov}`;

    const byState = await this.db.query<{ state: string; n: string }>(`select d.state::text as state, count(*)::text as n from deals d where ${inPeriod} group by 1 order by 1`, params);
    const bySpecies = await this.db.query<Record<string, string>>(
      `select d.species::text as species, d.unit::text as unit, count(*)::text as deals, sum(coalesce(d.delivered_heads, d.agreed_heads))::text as heads,
              sum(d.delivered_weight_kg)::text as weight_kg,
              sum(case when d.unit = 'per_head' then d.agreed_price * coalesce(d.delivered_heads, d.agreed_heads) else d.agreed_price * coalesce(d.delivered_weight_kg, d.agreed_weight_kg, 0) end)::text as gross_value,
              (percentile_cont(0.5) within group (order by d.agreed_price))::numeric(10,2)::text as median_price
         from deals d where ${settledIn} group by 1, 2 order by 1`,
      params,
    );
    const outliers = await this.db.one<{ n: string }>(`select count(*)::text as n from deals d where d.state = 'settled' and d.outlier_flag and d.outlier_reviewed_by is null ${prov ? 'and d.province_code = $1' : ''}`, prov ? [p.province_code] : []);

    const roles = await this.db.query<Record<string, string>>(
      `select r.role::text as role, count(*)::text as total,
              count(*) filter (where u.verification = 'verified')::text as verified,
              count(*) filter (where u.verification = 'pending')::text as pending,
              count(*) filter (where exists (
                select 1 from refresh_tokens t where t.user_id = u.id and t.created_at >= $1::date and t.created_at < ($2::date + 1)
                union all select 1 from deals d where (d.farmer_id = u.id or d.buyer_id = u.id) and d.accepted_at >= $1::date and d.accepted_at < ($2::date + 1)
                union all select 1 from shipments s where s.hauler_id = u.id and s.created_at >= $1::date and s.created_at < ($2::date + 1)
                union all select 1 from listings l where l.farmer_id = u.id and l.created_at >= $1::date and l.created_at < ($2::date + 1)
                union all select 1 from offers o where o.buyer_id = u.id and o.created_at >= $1::date and o.created_at < ($2::date + 1)
              ))::text as active_in_period
         from user_roles r join users u on u.id = r.user_id group by 1 order by 1`,
      [from, to],
    );

    const settle = await this.db.one<Record<string, string | null>>(
      `select count(*)::text as settled,
              (percentile_cont(0.5) within group (order by extract(epoch from d.settled_at - d.accepted_at) / 3600))::numeric(10,1)::text as median_hours,
              (percentile_cont(0.9) within group (order by extract(epoch from d.settled_at - d.accepted_at) / 3600))::numeric(10,1)::text as p90_hours
         from deals d where ${settledIn}`,
      params,
    );

    const disputes = await this.db.one<Record<string, string>>(
      `select (select count(*) from disputes ds join deals d on d.id = ds.deal_id where ds.created_at >= $1::date and ds.created_at < ($2::date + 1) ${prov})::text as opened,
              (select count(*) from disputes ds join deals d on d.id = ds.deal_id where ds.status in ('open', 'under_review') ${prov})::text as open_now,
              (select count(*) from deals d where d.delivered_at >= $1::date and d.delivered_at < ($2::date + 1) ${prov})::text as delivered`,
      params,
    );

    const deposits = await this.db.one<Record<string, string>>(
      `select count(*)::text as asked,
              count(*) filter (where dp.paid_at is not null)::text as paid,
              count(*) filter (where dp.status = 'lapsed')::text as lapsed,
              count(*) filter (where dp.status = 'released')::text as released,
              count(*) filter (where dp.status = 'forfeited')::text as forfeited,
              count(*) filter (where dp.status = 'refunded')::text as refunded,
              coalesce(sum(dp.net) filter (where dp.status = 'paid'), 0)::text as held_net
         from deposits dp join deals d on d.id = dp.deal_id where dp.created_at >= $1::date and dp.created_at < ($2::date + 1) ${prov}`,
      params,
    );

    const hauling = await this.db.one<Record<string, string>>(
      `select count(*) filter (where d.needs_hauler)::text as needing,
              count(*) filter (where s.id is not null)::text as hauled,
              count(*) filter (where s.picked_up_at is not null and s.shipping_permit_no is not null and s.vet_health_cert_no is not null and s.head_count_at_pickup is not null and cardinality(s.photo_keys) > 0)::text as complete
         from deals d left join shipments s on s.deal_id = d.id and s.status <> 'cancelled' where ${inPeriod}`,
      params,
    );

    const thin = await this.db.query<Record<string, string>>(
      `with recent as (
         select b.parent_code as municipality_code, lot.species::text as species, count(*)::text as listings
           from listings l join livestock_lots lot on lot.id = l.lot_id join farms f on f.id = lot.farm_id join locations b on b.psgc_code = f.barangay_code
          where l.created_at > now() - interval '30 days' group by 1, 2)
       select r.municipality_code, r.species, r.listings,
              (select count(*) from deals d where d.municipality_code = r.municipality_code and d.species = r.species::species and d.state = 'settled' and d.counts_for_price and d.settled_at > now() - interval '30 days')::text as settled
         from recent r join locations m on m.psgc_code = r.municipality_code
        where ($1::text is null or m.parent_code = $1)
        order by r.listings::int desc limit 20`,
      [p.province_code ?? null],
    );
    const needed = await this.db.one<{ n: number }>(`select min_sample_for_level('municipality') as n`);
    const need = int(needed?.n ?? 5);

    return {
      from,
      to,
      province_code: p.province_code ?? null,
      deals: {
        by_state: byState.rows.map((r) => ({ state: r.state, count: int(r.n) })),
        settled_by_species: bySpecies.rows.map((r) => ({
          species: r.species,
          unit: r.unit,
          deals: int(r.deals),
          heads: int(r.heads ?? 0),
          weight_kg: weight(r.weight_kg),
          gross_value: money(r.gross_value ?? 0)!,
          median_price: money(r.median_price),
        })),
        outliers_pending_review: int(outliers?.n ?? 0),
      },
      users: {
        by_role: roles.rows.map((r) => ({ role: r.role, total: int(r.total), verified: int(r.verified), pending: int(r.pending), active_in_period: int(r.active_in_period) })),
      },
      settlement: {
        settled: int(settle?.settled ?? 0),
        median_hours_accept_to_settle: settle?.median_hours == null ? null : Number(settle.median_hours),
        p90_hours_accept_to_settle: settle?.p90_hours == null ? null : Number(settle.p90_hours),
      },
      disputes: {
        opened: int(disputes?.opened ?? 0),
        open_now: int(disputes?.open_now ?? 0),
        rate_pct: int(disputes?.delivered ?? 0) === 0 ? null : Math.round((int(disputes!.opened) / int(disputes!.delivered)) * 1000) / 10,
      },
      deposits: {
        asked: int(deposits?.asked ?? 0),
        paid: int(deposits?.paid ?? 0),
        lapsed: int(deposits?.lapsed ?? 0),
        released: int(deposits?.released ?? 0),
        forfeited: int(deposits?.forfeited ?? 0),
        refunded: int(deposits?.refunded ?? 0),
        held_net: money(deposits?.held_net ?? 0)!,
      },
      hauling: {
        deals_needing_hauler: int(hauling?.needing ?? 0),
        hauled_in_app: int(hauling?.hauled ?? 0),
        checklist_complete_pct: int(hauling?.hauled ?? 0) === 0 ? null : Math.round((int(hauling!.complete) / int(hauling!.hauled)) * 1000) / 10,
      },
      thin_municipalities: (
        await Promise.all(
          thin.rows
            .filter((r) => int(r.settled) < need)
            .map(async (r) => ({ location: await this.locations.get(r.municipality_code), species: r.species, listings_30d: int(r.listings), settled_30d: int(r.settled), needed: need })),
        )
      ).slice(0, 12),
    };
  }

  async listUsers(q: { role?: string; verification?: string; q?: string; cursor?: string; limit: number }) {
    const params: unknown[] = [];
    const where: string[] = ['true'];
    if (q.role) {
      params.push(q.role);
      where.push(`exists (select 1 from user_roles r where r.user_id = u.id and r.role = $${params.length}::user_role)`);
    }
    if (q.verification) {
      params.push(q.verification);
      where.push(`u.verification = $${params.length}::verification_status`);
    }
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`(u.full_name ilike $${params.length} or u.phone_e164 like $${params.length})`);
    }
    if (q.cursor) {
      const [ts, id] = Buffer.from(q.cursor, 'base64url').toString('utf8').split(' ');
      params.push(ts, id);
      where.push(`(u.created_at, u.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(q.limit + 1);
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select u.id, u.created_at::text as created_at,
              (select count(*) from deals d where d.farmer_id = u.id or d.buyer_id = u.id) + (select count(*) from shipments s where s.hauler_id = u.id) as deals_count,
              (select max(t.created_at)::text from refresh_tokens t where t.user_id = u.id) as last_seen_at,
              coalesce(
                (select p.name from farms f join locations b on b.psgc_code = f.barangay_code join locations m on m.psgc_code = b.parent_code join locations p on p.psgc_code = m.parent_code where f.owner_id = u.id order by f.created_at limit 1),
                (select p.name from deals d join locations p on p.psgc_code = d.province_code where d.buyer_id = u.id order by d.accepted_at desc limit 1)
              ) as province_name
         from users u where ${where.join(' and ')} order by u.created_at desc, u.id desc limit $${params.length}`,
      params,
    );
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const items = await Promise.all(
      page.map(async (r) => ({
        ...(await this.users.byId(String(r.id))),
        province_name: (r.province_name as string | null) ?? null,
        deals_count: int(r.deals_count),
        last_seen_at: isoTime(r.last_seen_at),
      })),
    );
    return { items, next_cursor: rows.length > q.limit && last ? Buffer.from(`${last.created_at} ${last.id}`).toString('base64url') : null };
  }

  async dealsCsv(p: Period & { state?: string }) {
    const { from, to } = this.range(p);
    const params: unknown[] = [from, to];
    const where = [`d.accepted_at >= $1::date and d.accepted_at < ($2::date + 1)`];
    if (p.province_code) {
      params.push(p.province_code);
      where.push(`d.province_code = $${params.length}`);
    }
    if (p.state) {
      params.push(p.state);
      where.push(`d.state = $${params.length}::deal_state`);
    }
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select d.id, d.accepted_at::text as accepted_at, d.state::text as state, d.species::text as species, wc.label as weight_class, d.unit::text as unit,
              d.agreed_price::text as agreed_price, d.agreed_heads, d.agreed_weight_kg::text as agreed_weight_kg, d.delivered_heads, d.delivered_weight_kg::text as delivered_weight_kg,
              m.name as municipality, p.name as province, fu.full_name as farmer, bu.full_name as buyer, d.needs_hauler, s.status::text as shipment_status,
              d.deposit_status::text as deposit_status, d.payment_method, d.outlier_flag, d.counts_for_price, d.settled_at::text as settled_at, d.cancel_reason
         from deals d join users fu on fu.id = d.farmer_id join users bu on bu.id = d.buyer_id
         join locations m on m.psgc_code = d.municipality_code join locations p on p.psgc_code = d.province_code
         left join weight_classes wc on wc.id = d.weight_class_id
         left join shipments s on s.deal_id = d.id and s.status <> 'cancelled'
        where ${where.join(' and ')} order by d.accepted_at`,
      params,
    );
    const cols = ['id', 'accepted_at', 'state', 'species', 'weight_class', 'unit', 'agreed_price', 'agreed_heads', 'agreed_weight_kg', 'delivered_heads', 'delivered_weight_kg', 'municipality', 'province', 'farmer', 'buyer', 'needs_hauler', 'shipment_status', 'deposit_status', 'payment_method', 'outlier_flag', 'counts_for_price', 'settled_at', 'cancel_reason'];
    const cell = (v: unknown) => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'string' && /^\d{4}-\d{2}-\d{2} /.test(v) ? (isoTime(v) ?? v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    };
    return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
  }
}
