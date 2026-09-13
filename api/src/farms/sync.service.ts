import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { IdempotencyService } from '../common/idempotency.js';
import { ProblemException, type ProblemBody } from '../common/problem.js';
import { FarmInputZ, LotInputZ, VaccinationInputZ } from './farms.controller.js';
import { FarmsService } from './farms.service.js';

// The mobile app replays its offline queue here, in order. Each operation is
// one of the farm, lot or vaccination writes, keyed by its own op_id (which is
// its idempotency key) and carrying the version the device last saw. A create
// may use a temporary id (`tmp:<uuid>`); later operations in the same batch
// refer to it and are rewritten once the server id is known.

export const SyncOperationZ = z.object({
  op_id: z.string().uuid(),
  method: z.enum(['POST', 'PATCH', 'DELETE']),
  path: z.string().min(1).max(200),
  if_match: z.number().int().positive().nullable().optional(),
  body: z.record(z.string(), z.unknown()).default({}),
  recorded_at: z.string().optional(),
});
export type SyncOperation = z.infer<typeof SyncOperationZ>;

export interface SyncResult {
  op_id: string;
  status: number;
  resource?: unknown;
  id_map?: Record<string, string>;
  problem?: ProblemBody;
}

const ROUTES: { re: RegExp; kind: string }[] = [
  { re: /^\/farms$/, kind: 'farms' },
  { re: /^\/farms\/([^/]+)$/, kind: 'farm' },
  { re: /^\/farms\/([^/]+)\/lots$/, kind: 'farm-lots' },
  { re: /^\/lots\/([^/]+)$/, kind: 'lot' },
  { re: /^\/lots\/([^/]+)\/vaccinations$/, kind: 'lot-vaccinations' },
];

@Injectable()
export class SyncService {
  constructor(
    @Inject(FarmsService) private readonly farms: FarmsService,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
  ) {}

  async apply(userId: string, roles: string[], ops: SyncOperation[]): Promise<SyncResult[]> {
    const idMap = new Map<string, string>(); // tmp:<uuid> -> server uuid, within this batch
    const results: SyncResult[] = [];
    for (const op of ops) {
      try {
        const out = await this.idem.run(userId, op.op_id, { method: op.method, path: op.path, if_match: op.if_match ?? null, body: op.body }, () =>
          this.applyOne(userId, roles, op, idMap),
        );
        const body = out.body as { resource?: unknown; id_map?: Record<string, string> } | null;
        // A replayed create must still teach this batch its id mapping.
        if (body?.id_map) for (const [k, v] of Object.entries(body.id_map)) idMap.set(k, v);
        results.push({ op_id: op.op_id, status: out.status, ...body });
      } catch (e) {
        const p = e instanceof ProblemException ? e : new ProblemException(500, 'internal', 'Internal server error');
        results.push({ op_id: op.op_id, status: p.status, problem: p.toBody(op.path) });
      }
    }
    return results;
  }

  private resolve(id: string, idMap: Map<string, string>): string {
    if (id.startsWith('tmp:')) {
      const real = idMap.get(id);
      if (!real) throw ProblemException.badRequest(`Temporary id ${id} was not created earlier in this batch`);
      return real;
    }
    const r = z.string().uuid().safeParse(id);
    if (!r.success) throw ProblemException.badRequest(`Not an id: ${id}`);
    return id;
  }

  private tmpId(body: Record<string, unknown>): string | null {
    const t = body.tmp_id;
    return typeof t === 'string' && t.startsWith('tmp:') ? t : null;
  }

  private async applyOne(userId: string, roles: string[], op: SyncOperation, idMap: Map<string, string>): Promise<{ status: number; body: unknown }> {
    const route = ROUTES.find((r) => r.re.test(op.path));
    if (!route) throw ProblemException.badRequest(`Path not allowed in sync: ${op.path}`);
    const m = op.path.match(route.re)!;
    const parse = <T>(schema: z.ZodType<T>) => {
      const { tmp_id: _tmp, ...rest } = op.body;
      const r = schema.safeParse(rest);
      if (r.success) return r.data;
      throw ProblemException.validation(r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    };
    const ifMatch = () => {
      if (op.if_match == null) throw ProblemException.preconditionRequired('if_match is required for PATCH');
      return op.if_match;
    };
    const created = (resource: { id: string }) => {
      const tmp = this.tmpId(op.body);
      const id_map = tmp ? { [tmp]: resource.id } : undefined;
      if (tmp) idMap.set(tmp, resource.id);
      return { status: 201, body: { resource, ...(id_map ? { id_map } : {}) } };
    };

    switch (`${op.method} ${route.kind}`) {
      case 'POST farms':
        if (!roles.includes('farmer')) throw ProblemException.forbidden('Farmer role required');
        return created(await this.farms.createFarm(userId, parse(FarmInputZ)));
      case 'PATCH farm':
        return { status: 200, body: { resource: await this.farms.updateFarm(userId, this.resolve(m[1], idMap), ifMatch(), parse(FarmInputZ)) } };
      case 'DELETE farm':
        await this.farms.archiveFarm(userId, this.resolve(m[1], idMap));
        return { status: 204, body: null };
      case 'POST farm-lots':
        return created(await this.farms.createLot(userId, this.resolve(m[1], idMap), parse(LotInputZ)));
      case 'PATCH lot':
        return { status: 200, body: { resource: await this.farms.updateLot(userId, this.resolve(m[1], idMap), ifMatch(), parse(LotInputZ)) } };
      case 'DELETE lot':
        await this.farms.deleteLot(userId, this.resolve(m[1], idMap));
        return { status: 204, body: null };
      case 'POST lot-vaccinations':
        return created(await this.farms.addVaccination(userId, this.resolve(m[1], idMap), parse(VaccinationInputZ)));
      default:
        throw ProblemException.badRequest(`${op.method} ${op.path} is not a sync operation`);
    }
  }
}
