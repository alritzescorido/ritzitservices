import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { dateOnly, int, money, weight } from '../common/format.js';
import { ProblemException } from '../common/problem.js';
import { DbService } from '../db/db.service.js';

export type Species = 'hog' | 'cattle' | 'carabao' | 'goat' | 'native_chicken';

export interface WeightClassDto {
  id: number;
  species: Species;
  label: string;
  min_kg: string | null;
  max_kg: string | null;
  unit: string;
  sort: number;
}

export interface RunningPriceDto {
  species: Species;
  weight_class?: WeightClassDto;
  unit: string;
  source: 'municipality' | 'province' | 'reference';
  location_code: string;
  location_name: string;
  median_price: string | null;
  low_price: string | null;
  high_price: string | null;
  sample_count: number;
  change_30d_pct: number | null;
  window_days: number;
  as_of: string;
  reference_source: string | null;
  municipality: { median_price: string | null; sample_count: number };
  label: { fil: string; en: string };
}

interface LadderRow {
  source: 'municipality' | 'province' | 'reference';
  location_code: string | null;
  median_price: string | null;
  low_price: string | null;
  high_price: string | null;
  sample_count: number | null;
  change_30d_pct: string | null;
  muni_median: string | null;
  muni_count: number | null;
}

const WINDOW_DAYS = 7;

function labels(row: LadderRow, muni: string, prov: string): { fil: string; en: string } {
  const n = int(row.sample_count);
  const m = int(row.muni_count);
  switch (row.source) {
    case 'municipality':
      return {
        en: `Based on ${n} sales in ${muni} this week`,
        fil: `Batay sa ${n} bentahan sa ${muni} ngayong linggo`,
      };
    case 'province':
      return {
        en: `Based on ${n} sales in ${prov} this week (only ${m} in ${muni})`,
        fil: `Batay sa ${n} bentahan sa ${prov} ngayong linggo (${m} lang sa ${muni})`,
      };
    default:
      return {
        en: row.median_price ? `Reference price, no recent sales in ${muni}` : `No price yet for ${muni}`,
        fil: row.median_price ? `Sangguniang presyo, walang bentahan sa ${muni} kamakailan` : `Wala pang presyo para sa ${muni}`,
      };
  }
}

@Injectable()
export class PricesService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async weightClasses(species?: Species): Promise<WeightClassDto[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select id, species::text as species, label, min_kg::text as min_kg, max_kg::text as max_kg, unit::text as unit, sort
         from weight_classes ${species ? 'where species = $1::species' : ''} order by species, sort`,
      species ? [species] : [],
    );
    return rows.map((r) => ({
      id: int(r.id),
      species: r.species as Species,
      label: String(r.label),
      min_kg: weight(r.min_kg),
      max_kg: weight(r.max_kg),
      unit: String(r.unit),
      sort: int(r.sort),
    }));
  }

  private async municipalityAndProvince(code: string) {
    const row = await this.db.one<{ code: string; name: string; level: string; pcode: string | null; pname: string | null; plevel: string | null }>(
      `select l.psgc_code as code, l.name, l.level::text as level, p.psgc_code as pcode, p.name as pname, p.level::text as plevel
         from locations l left join locations p on p.psgc_code = l.parent_code where l.psgc_code = $1`,
      [code],
    );
    if (!row) throw ProblemException.notFound('Municipality not found');
    if (row.level !== 'municipality') throw ProblemException.notFound('Code is not a municipality or city');
    return {
      municipality: { psgc_code: row.code, parent_code: row.pcode, level: row.level, name: row.name, centroid: null, has_children: true },
      province: row.pcode
        ? { psgc_code: row.pcode, parent_code: null, level: row.plevel!, name: row.pname!, centroid: null, has_children: true }
        : null,
    };
  }

  private async ladder(species: Species, weightClassId: number | null, muniCode: string, asOf: string) {
    const { rows } = await this.db.query<LadderRow>(`select * from running_price($1::species, $2::smallint, $3, $4::date)`, [
      species,
      weightClassId,
      muniCode,
      asOf,
    ]);
    return rows[0];
  }

  private async referenceSource(provCode: string | null, species: Species, weightClassId: number | null, asOf: string) {
    if (!provCode) return null;
    const row = await this.db.one<{ source: string }>(
      `select source from reference_prices
        where province_code = $1 and species = $2::species
          and (weight_class_id = $3::smallint or weight_class_id is null) and effective_from <= $4::date
        order by (weight_class_id is null), effective_from desc, created_at desc limit 1`,
      [provCode, species, weightClassId, asOf],
    );
    return row?.source ?? null;
  }

  private toDto(
    row: LadderRow,
    species: Species,
    wc: WeightClassDto | undefined,
    muni: { psgc_code: string; name: string },
    prov: { psgc_code: string; name: string } | null,
    asOf: string,
    referenceSource: string | null,
  ): RunningPriceDto {
    const locationCode = row.location_code ?? prov?.psgc_code ?? muni.psgc_code;
    const locationName = locationCode === muni.psgc_code ? muni.name : (prov?.name ?? muni.name);
    return {
      species,
      ...(wc ? { weight_class: wc } : {}),
      unit: wc?.unit ?? 'per_kg_liveweight',
      source: row.source,
      location_code: locationCode,
      location_name: locationName,
      median_price: money(row.median_price),
      low_price: money(row.low_price),
      high_price: money(row.high_price),
      sample_count: int(row.sample_count),
      change_30d_pct: row.change_30d_pct === null ? null : Number(row.change_30d_pct),
      window_days: WINDOW_DAYS,
      as_of: asOf,
      reference_source: row.source === 'reference' ? referenceSource : null,
      municipality: { median_price: money(row.muni_median), sample_count: int(row.muni_count) },
      label: labels(row, muni.name, prov?.name ?? muni.name),
    };
  }

  async running(muniCode: string, species: Species, weightClassId: number | undefined, asOf: string): Promise<RunningPriceDto> {
    const { municipality, province } = await this.municipalityAndProvince(muniCode);
    const classes = await this.weightClasses(species);
    const wc = weightClassId !== undefined ? classes.find((c) => c.id === weightClassId) : undefined;
    if (weightClassId !== undefined && !wc) throw ProblemException.notFound('Weight class not found for this species');
    const row = await this.ladder(species, wc?.id ?? null, muniCode, asOf);
    const ref = row.source === 'reference' ? await this.referenceSource(province?.psgc_code ?? null, species, wc?.id ?? null, asOf) : null;
    return this.toDto(row, species, wc, municipality, province, asOf, ref);
  }

  async board(muniCode: string, species: Species | undefined, asOf: string) {
    const { municipality, province } = await this.municipalityAndProvince(muniCode);
    const classes = await this.weightClasses(species);
    const items = [];
    for (const wc of classes) {
      const row = await this.ladder(wc.species, wc.id, muniCode, asOf);
      const ref = row.source === 'reference' ? await this.referenceSource(province?.psgc_code ?? null, wc.species, wc.id, asOf) : null;
      const dto = this.toDto(row, wc.species, wc, municipality, province, asOf, ref);
      const sparkline = row.source === 'reference' ? [] : await this.sparkline(dto.location_code, wc.species, wc.id, asOf);
      items.push({ ...dto, sparkline });
    }
    const body = { municipality, province, as_of: asOf, items };
    const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 20)}"`;
    return { body, etag };
  }

  /** Last 14 daily medians at the level used, oldest first, null where no snapshot exists. */
  private async sparkline(locationCode: string, species: Species, weightClassId: number, asOf: string): Promise<(number | null)[]> {
    const { rows } = await this.db.query<{ d: string; median: string }>(
      `select snapshot_date::text as d, median_price::text as median from price_snapshots
        where location_code = $1 and species = $2::species and weight_class_id = $3::smallint and window_days = $5
          and snapshot_date > $4::date - 14 and snapshot_date <= $4::date`,
      [locationCode, species, weightClassId, asOf, WINDOW_DAYS],
    );
    const byDay = new Map(rows.map((r) => [r.d.slice(0, 10), Number(r.median)]));
    const end = new Date(`${asOf}T00:00:00Z`);
    const out: (number | null)[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      out.push(byDay.get(day) ?? null);
    }
    return out;
  }

  async history(locationCode: string, species: Species, weightClassId: number | undefined, days: number) {
    const loc = await this.db.one<{ level: string }>(`select level::text as level from locations where psgc_code = $1`, [locationCode]);
    if (!loc) throw ProblemException.notFound('Location not found');
    const classes = await this.weightClasses(species);
    const wc = weightClassId !== undefined ? classes.find((c) => c.id === weightClassId) : classes[0];
    if (!wc) throw ProblemException.notFound('Weight class not found for this species');
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select snapshot_date::text as d, median_price::text as median, low_price::text as lo, high_price::text as hi, sample_count
         from price_snapshots
        where location_code = $1 and species = $2::species and weight_class_id = $3::smallint and window_days = $5
          and snapshot_date > current_date - $4::int
        order by snapshot_date`,
      [locationCode, species, wc.id, days, WINDOW_DAYS],
    );
    return {
      unit: wc.unit,
      points: rows.map((r) => ({
        date: dateOnly(r.d)!,
        median_price: money(r.median)!,
        low_price: money(r.lo),
        high_price: money(r.hi),
        sample_count: int(r.sample_count),
      })),
    };
  }
}
