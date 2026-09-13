import { Inject, Injectable } from '@nestjs/common';
import { dateOnly, int, isoTime, weight } from '../common/format.js';
import { ProblemException } from '../common/problem.js';
import { DbService, type Queryable } from '../db/db.service.js';
import { LocationsService, type LocationWithPathDto } from '../locations/locations.service.js';
import { PricesService, type RunningPriceDto, type Species, type WeightClassDto } from '../prices/prices.service.js';
import { StorageService } from '../storage/storage.service.js';

export interface FarmInput {
  name: string;
  barangay_code: string;
  address_line?: string | null;
  geo?: { lat: number; lng: number } | null;
  farm_type?: 'backyard' | 'commercial' | 'cooperative' | null;
  permit_ref?: string | null;
  photo_keys?: string[];
}

export interface FarmDto extends Required<FarmInput> {
  id: string;
  owner_id: string;
  version: number;
  location: LocationWithPathDto;
  lot_summary: { species: Species; lots: number; heads: number }[];
  created_at: string;
  updated_at: string;
}

export interface LotInput {
  species: Species;
  breed?: string | null;
  head_count: number;
  avg_weight_kg?: string | null;
  weight_class_id?: number | null;
  age_months?: number | null;
  sex?: 'male' | 'female' | 'mixed' | null;
  notes?: string | null;
  photo_keys?: string[];
}

export interface LotDto {
  id: string;
  farm_id: string;
  version: number;
  species: Species;
  breed: string | null;
  head_count: number;
  avg_weight_kg: string | null;
  weight_class_id: number;
  weight_class: WeightClassDto;
  age_months: number | null;
  sex: string | null;
  notes: string | null;
  photo_keys: string[];
  last_vaccination_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface VaccinationDto {
  id: string;
  lot_id: string;
  vaccine: string;
  given_on: string;
  given_by: string | null;
  doc_key: string | null;
  created_at: string;
}

interface FarmRow {
  id: string;
  owner_id: string;
  name: string;
  barangay_code: string;
  address_line: string | null;
  geo_text: string | null;
  farm_type: string | null;
  permit_ref: string | null;
  photo_keys: string[] | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface LotRow {
  id: string;
  farm_id: string;
  species: Species;
  breed: string | null;
  head_count: number;
  avg_weight_kg: string | null;
  weight_class_id: number | null;
  age_months: number | null;
  sex: string | null;
  notes: string | null;
  photo_keys: string[] | null;
  version: number;
  created_at: string;
  updated_at: string;
  last_vaccination_on: string | null;
}

// geo is a geo_point domain: geography on PostGIS, point on plain Postgres.
// The schema defines geo_from_lnglat() and geo_lnglat() for both engines, so
// the API never touches the underlying type.
const FARM_COLS = `f.id, f.owner_id, f.name, f.barangay_code, f.address_line, geo_lnglat(f.geo) as geo_text, f.farm_type,
  f.permit_ref, f.photo_keys, f.version, f.created_at::text as created_at, f.updated_at::text as updated_at`;
const LOT_COLS = `l.id, l.farm_id, l.species::text as species, l.breed, l.head_count, l.avg_weight_kg::text as avg_weight_kg,
  l.weight_class_id, l.age_months, l.sex, l.notes, l.photo_keys, l.version, l.created_at::text as created_at,
  l.updated_at::text as updated_at,
  (select max(v.given_on)::text from vaccination_records v where v.lot_id = l.id) as last_vaccination_on`;

function parseGeo(text: string | null): { lat: number; lng: number } | null {
  if (!text) return null;
  const [lng, lat] = text.split(' ').map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lat, lng };
}

@Injectable()
export class FarmsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(LocationsService) private readonly locations: LocationsService,
    @Inject(PricesService) private readonly prices: PricesService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  // ---- farms ---------------------------------------------------------------

  async listMine(ownerId: string): Promise<FarmDto[]> {
    const { rows } = await this.db.query<FarmRow>(
      `select ${FARM_COLS} from farms f where f.owner_id = $1 and f.archived_at is null order by f.name`,
      [ownerId],
    );
    return Promise.all(rows.map((r) => this.farmDto(r)));
  }

  async getFarm(ownerId: string, farmId: string, q: Queryable = this.db): Promise<FarmDto> {
    const row = (await q.query<FarmRow>(`select ${FARM_COLS} from farms f where f.id = $1 and f.archived_at is null`, [farmId])).rows[0];
    if (!row || row.owner_id !== ownerId) throw ProblemException.notFound('Farm not found');
    return this.farmDto(row, q);
  }

  async createFarm(ownerId: string, input: FarmInput): Promise<FarmDto> {
    await this.assertBarangay(input.barangay_code);
    this.assertPhotoKeys(input.photo_keys, 'farm_photo', ownerId);
    const { rows } = await this.db.query<{ id: string }>(
      `insert into farms (owner_id, name, barangay_code, address_line, geo, farm_type, permit_ref, photo_keys)
       values ($1, $2, $3, $4, geo_from_lnglat($5::double precision, $6::double precision), $7, $8, $9::text[]) returning id`,
      [ownerId, input.name, input.barangay_code, input.address_line ?? null, input.geo?.lng ?? null, input.geo?.lat ?? null, input.farm_type ?? null, input.permit_ref ?? null, input.photo_keys ?? []],
    );
    return this.getFarm(ownerId, rows[0].id);
  }

  async updateFarm(ownerId: string, farmId: string, ifMatch: number, input: FarmInput): Promise<FarmDto> {
    const current = await this.getFarm(ownerId, farmId);
    if (current.version !== ifMatch) throw ProblemException.versionConflict(current);
    await this.assertBarangay(input.barangay_code);
    this.assertPhotoKeys(input.photo_keys, 'farm_photo', ownerId);
    const { rowCount } = await this.db.query(
      `update farms set name = $3, barangay_code = $4, address_line = $5,
              geo = geo_from_lnglat($6::double precision, $7::double precision), farm_type = $8,
              permit_ref = $9, photo_keys = $10::text[]
        where id = $1 and owner_id = $2 and version = $11 and archived_at is null`,
      [farmId, ownerId, input.name, input.barangay_code, input.address_line ?? null, input.geo?.lng ?? null, input.geo?.lat ?? null, input.farm_type ?? null, input.permit_ref ?? null, input.photo_keys ?? [], ifMatch],
    );
    if (rowCount === 0) throw ProblemException.versionConflict(await this.getFarm(ownerId, farmId));
    return this.getFarm(ownerId, farmId);
  }

  async archiveFarm(ownerId: string, farmId: string) {
    await this.getFarm(ownerId, farmId);
    const active = await this.db.one<{ n: number }>(
      `select count(*)::int as n from listings li join livestock_lots l on l.id = li.lot_id where l.farm_id = $1 and li.status = 'active'`,
      [farmId],
    );
    if ((active?.n ?? 0) > 0) throw ProblemException.conflict('Farm has an active listing. Withdraw it first.');
    await this.db.query(`update farms set archived_at = now() where id = $1 and owner_id = $2`, [farmId, ownerId]);
  }

  // ---- lots ----------------------------------------------------------------

  async listLots(ownerId: string, farmId: string, species?: Species): Promise<LotDto[]> {
    await this.getFarm(ownerId, farmId);
    const params: unknown[] = [farmId];
    if (species) params.push(species);
    const { rows } = await this.db.query<LotRow>(
      `select ${LOT_COLS} from livestock_lots l where l.farm_id = $1 ${species ? 'and l.species = $2::species' : ''} order by l.species, l.created_at`,
      params,
    );
    const classes = await this.prices.weightClasses();
    return rows.map((r) => this.lotDto(r, classes));
  }

  async getLot(ownerId: string, lotId: string, q: Queryable = this.db): Promise<LotDto> {
    const row = (
      await q.query<LotRow & { owner_id: string; archived_at: string | null }>(
        `select ${LOT_COLS}, f.owner_id, f.archived_at::text as archived_at from livestock_lots l join farms f on f.id = l.farm_id where l.id = $1`,
        [lotId],
      )
    ).rows[0];
    if (!row || row.owner_id !== ownerId || row.archived_at) throw ProblemException.notFound('Lot not found');
    return this.lotDto(row, await this.prices.weightClasses());
  }

  /** Lot with its vaccinations and the board price for its class at the farm's municipality. */
  async getLotDetail(ownerId: string, lotId: string) {
    const lot = await this.getLot(ownerId, lotId);
    const vaccinations = await this.listVaccinations(lotId);
    const farm = await this.db.one<{ muni: string | null }>(
      `select b.parent_code as muni from farms f join locations b on b.psgc_code = f.barangay_code where f.id = $1`,
      [lot.farm_id],
    );
    let board_price: RunningPriceDto | null = null;
    if (farm?.muni) {
      try {
        board_price = await this.prices.running(farm.muni, lot.species, lot.weight_class_id, new Date().toISOString().slice(0, 10));
      } catch {
        board_price = null;
      }
    }
    return { ...lot, vaccinations, board_price };
  }

  async createLot(ownerId: string, farmId: string, input: LotInput): Promise<LotDto> {
    await this.getFarm(ownerId, farmId);
    this.assertPhotoKeys(input.photo_keys, 'lot_photo', ownerId);
    const wc = await this.resolveWeightClass(input);
    const { rows } = await this.db.query<{ id: string }>(
      `insert into livestock_lots (farm_id, species, breed, head_count, avg_weight_kg, weight_class_id, age_months, sex, notes, photo_keys)
       values ($1, $2::species, $3, $4, $5::numeric, $6, $7, $8, $9, $10::text[]) returning id`,
      [farmId, input.species, input.breed ?? null, input.head_count, input.avg_weight_kg ?? null, wc.id, input.age_months ?? null, input.sex ?? null, input.notes ?? null, input.photo_keys ?? []],
    );
    return this.getLot(ownerId, rows[0].id);
  }

  async updateLot(ownerId: string, lotId: string, ifMatch: number, input: LotInput): Promise<LotDto> {
    const current = await this.getLot(ownerId, lotId);
    if (current.version !== ifMatch) throw ProblemException.versionConflict(current);
    this.assertPhotoKeys(input.photo_keys, 'lot_photo', ownerId);
    const wc = await this.resolveWeightClass(input);
    const { rowCount } = await this.db.query(
      `update livestock_lots set species = $2::species, breed = $3, head_count = $4, avg_weight_kg = $5::numeric, weight_class_id = $6,
              age_months = $7, sex = $8, notes = $9, photo_keys = $10::text[]
        where id = $1 and version = $11`,
      [lotId, input.species, input.breed ?? null, input.head_count, input.avg_weight_kg ?? null, wc.id, input.age_months ?? null, input.sex ?? null, input.notes ?? null, input.photo_keys ?? [], ifMatch],
    );
    if (rowCount === 0) throw ProblemException.versionConflict(await this.getLot(ownerId, lotId));
    return this.getLot(ownerId, lotId);
  }

  async deleteLot(ownerId: string, lotId: string) {
    await this.getLot(ownerId, lotId);
    const active = await this.db.one<{ n: number }>(`select count(*)::int as n from listings where lot_id = $1 and status = 'active'`, [lotId]);
    if ((active?.n ?? 0) > 0) throw ProblemException.conflict('Lot has an active listing. Withdraw it first.');
    await this.db.query(`delete from livestock_lots where id = $1`, [lotId]);
  }

  // ---- vaccinations --------------------------------------------------------

  async listVaccinations(lotId: string): Promise<VaccinationDto[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select id, lot_id, vaccine, given_on::text as given_on, given_by, doc_key, created_at::text as created_at
         from vaccination_records where lot_id = $1 order by given_on desc, created_at desc`,
      [lotId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      lot_id: String(r.lot_id),
      vaccine: String(r.vaccine),
      given_on: dateOnly(r.given_on)!,
      given_by: (r.given_by as string | null) ?? null,
      doc_key: (r.doc_key as string | null) ?? null,
      created_at: isoTime(r.created_at)!,
    }));
  }

  async addVaccination(ownerId: string, lotId: string, input: { vaccine: string; given_on: string; given_by?: string | null; doc_key?: string | null }) {
    await this.getLot(ownerId, lotId);
    if (input.doc_key && !this.storage.isValidKey(input.doc_key)) throw ProblemException.validation([{ field: 'doc_key', message: 'Not a storage key from /uploads' }]);
    const { rows } = await this.db.query<{ id: string }>(
      `insert into vaccination_records (lot_id, vaccine, given_on, given_by, doc_key) values ($1, $2, $3::date, $4, $5) returning id`,
      [lotId, input.vaccine, input.given_on, input.given_by ?? null, input.doc_key ?? null],
    );
    // touch the lot so offline clients see a version change
    await this.db.query(`update livestock_lots set notes = notes where id = $1`, [lotId]);
    return (await this.listVaccinations(lotId)).find((v) => v.id === rows[0].id)!;
  }

  // ---- helpers -------------------------------------------------------------

  private async farmDto(r: FarmRow, q: Queryable = this.db): Promise<FarmDto> {
    const [location, summary] = await Promise.all([
      this.locations.get(r.barangay_code),
      q.query<{ species: Species; lots: number; heads: number }>(
        `select species::text as species, count(*)::int as lots, sum(head_count)::int as heads
           from livestock_lots where farm_id = $1 group by species order by species`,
        [r.id],
      ),
    ]);
    return {
      id: r.id,
      owner_id: r.owner_id,
      name: r.name,
      barangay_code: r.barangay_code,
      address_line: r.address_line,
      geo: parseGeo(r.geo_text),
      farm_type: (r.farm_type as FarmDto['farm_type']) ?? null,
      permit_ref: r.permit_ref,
      photo_keys: r.photo_keys ?? [],
      version: int(r.version),
      location,
      lot_summary: summary.rows.map((s) => ({ species: s.species, lots: int(s.lots), heads: int(s.heads) })),
      created_at: isoTime(r.created_at)!,
      updated_at: isoTime(r.updated_at)!,
    };
  }

  private lotDto(r: LotRow, classes: WeightClassDto[]): LotDto {
    const wc = classes.find((c) => c.id === int(r.weight_class_id));
    if (!wc) throw ProblemException.notFound('Weight class missing for lot');
    return {
      id: r.id,
      farm_id: r.farm_id,
      version: int(r.version),
      species: r.species,
      breed: r.breed,
      head_count: int(r.head_count),
      avg_weight_kg: weight(r.avg_weight_kg),
      weight_class_id: wc.id,
      weight_class: wc,
      age_months: r.age_months === null ? null : int(r.age_months),
      sex: r.sex,
      notes: r.notes,
      photo_keys: r.photo_keys ?? [],
      last_vaccination_on: dateOnly(r.last_vaccination_on),
      created_at: isoTime(r.created_at)!,
      updated_at: isoTime(r.updated_at)!,
    };
  }

  /** Weight class comes from species and average weight unless the client names one. */
  private async resolveWeightClass(input: LotInput): Promise<WeightClassDto> {
    const classes = await this.prices.weightClasses(input.species);
    if (input.weight_class_id != null) {
      const wc = classes.find((c) => c.id === input.weight_class_id);
      if (!wc) throw ProblemException.validation([{ field: 'weight_class_id', message: `Not a ${input.species} weight class` }]);
      return wc;
    }
    if (classes.length === 1) return classes[0];
    const w = input.avg_weight_kg != null ? Number(input.avg_weight_kg) : NaN;
    if (!Number.isFinite(w)) {
      throw ProblemException.validation([{ field: 'avg_weight_kg', message: `Send avg_weight_kg or weight_class_id for ${input.species}` }]);
    }
    const match = classes.find((c) => (c.min_kg === null || w >= Number(c.min_kg)) && (c.max_kg === null || w < Number(c.max_kg)));
    if (!match) throw ProblemException.validation([{ field: 'avg_weight_kg', message: 'No weight class covers this weight' }]);
    return match;
  }

  private async assertBarangay(code: string) {
    const loc = await this.db.one<{ level: string; active: boolean }>(`select level::text as level, active from locations where psgc_code = $1`, [code]);
    if (!loc || loc.level !== 'barangay' || !loc.active) throw ProblemException.validation([{ field: 'barangay_code', message: 'Not an active barangay code' }]);
  }

  private assertPhotoKeys(keys: string[] | undefined, purpose: 'farm_photo' | 'lot_photo', ownerId: string) {
    for (const k of keys ?? []) {
      if (!this.storage.isValidKey(k) || !k.startsWith(`${purpose}/${ownerId}/`)) {
        throw ProblemException.validation([{ field: 'photo_keys', message: `"${k}" is not one of your ${purpose.replace('_', ' ')} uploads` }]);
      }
    }
  }
}
