import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, type AccessClaims } from '../auth/auth.guard.js';
import { IdempotencyService, requireIdempotencyKey } from '../common/idempotency.js';
import { parseOr } from '../common/problem.js';
import { LogisticsService } from './logistics.service.js';

const Uuid = z.string().uuid();
const Money = z.string().regex(/^[0-9]+(\.[0-9]{1,2})?$/, 'Pesos as a decimal string');
const Psgc = z.string().regex(/^[0-9]{10}$/, 'PSGC code');
const SpeciesZ = z.enum(['hog', 'cattle', 'carabao', 'goat', 'native_chicken']);
const StatusZ = z.enum(['assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled']);
const Geo = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const Keys = z.array(z.string().max(200));

const ProfileZ = z.object({
  vehicle_plate: z.string().trim().min(4).max(12),
  vehicle_type: z.string().trim().min(1).max(40),
  capacity_heads: z.number().int().min(1).max(500),
  capacity_kg: Money.nullable().optional(),
  rate_per_head: Money.nullable().optional(),
  rate_per_trip: Money.nullable().optional(),
  service_area: z.array(Psgc).max(20).optional(),
});
const JobsQuery = z.object({
  species: SpeciesZ.optional(),
  province_code: Psgc.optional(),
  fits_my_truck: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const AcceptZ = z.object({ agreed_fee: Money, scheduled_pickup_at: z.string().datetime({ offset: true }) });
const StartZ = z.object({
  shipping_permit_no: z.string().trim().min(3).max(60),
  vet_health_cert_no: z.string().trim().min(3).max(60),
  head_count: z.number().int().min(1),
  photo_keys: Keys.min(1).max(5),
  note: z.string().max(300).nullable().optional(),
  geo: Geo.nullable().optional(),
});
const PingZ = z.object({ geo: Geo, kind: z.enum(['position', 'checkpoint', 'delay', 'problem']).default('position'), note: z.string().max(300).nullable().optional() });
const DeliveredZ = z.object({ note: z.string().max(300).nullable().optional(), photo_keys: Keys.max(5).optional(), geo: Geo.nullable().optional() }).default({});
const CancelZ = z.object({ reason: z.string().trim().min(3).max(300) });
const ListQuery = z.object({ status: StatusZ.optional() });

@Controller()
export class LogisticsController {
  constructor(
    @Inject(LogisticsService) private readonly logistics: LogisticsService,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
  ) {}

  private async idempotent(user: AccessClaims, key: string | undefined, payload: unknown, res: Response, fn: () => Promise<unknown>, status = 200) {
    const out = await this.idem.run(user.sub, requireIdempotencyKey(key), payload, async () => ({ status, body: await fn() }));
    res.status(out.status).json(out.body);
  }

  @Get('haulers/me')
  profile(@CurrentUser() user: AccessClaims) {
    return this.logistics.getProfile(user);
  }

  @Put('haulers/me')
  putProfile(@CurrentUser() user: AccessClaims, @Body() body: unknown) {
    return this.logistics.putProfile(user, parseOr(ProfileZ, body));
  }

  @Get('haul-jobs')
  jobs(@CurrentUser() user: AccessClaims, @Query() query: unknown) {
    return this.logistics.listJobs(user, parseOr(JobsQuery, query, 'query'));
  }

  @Post('haul-jobs/:deal_id/accept')
  accept(@CurrentUser() user: AccessClaims, @Param('deal_id') id: string, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const dealId = parseOr(Uuid, id, 'params');
    const input = parseOr(AcceptZ, body);
    return this.idempotent(user, key, { accept_job: dealId, ...input }, res, () => this.logistics.accept(user, dealId, input), 201);
  }

  @Get('shipments')
  list(@CurrentUser() user: AccessClaims, @Query() query: unknown) {
    return this.logistics.listMine(user, parseOr(ListQuery, query, 'query').status);
  }

  @Get('shipments/:shipment_id')
  get(@CurrentUser() user: AccessClaims, @Param('shipment_id') id: string) {
    return this.logistics.get(user, parseOr(Uuid, id, 'params'));
  }

  @Post('shipments/:shipment_id/start')
  start(@CurrentUser() user: AccessClaims, @Param('shipment_id') id: string, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const sid = parseOr(Uuid, id, 'params');
    const input = parseOr(StartZ, body);
    return this.idempotent(user, key, { start: sid, ...input }, res, () => this.logistics.start(user, sid, input));
  }

  @Post('shipments/:shipment_id/ping')
  @HttpCode(201)
  async ping(@CurrentUser() user: AccessClaims, @Param('shipment_id') id: string, @Body() body: unknown) {
    await this.logistics.ping(user, parseOr(Uuid, id, 'params'), parseOr(PingZ, body));
    return { recorded: true };
  }

  @Post('shipments/:shipment_id/delivered')
  delivered(@CurrentUser() user: AccessClaims, @Param('shipment_id') id: string, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const sid = parseOr(Uuid, id, 'params');
    const input = parseOr(DeliveredZ, body ?? {});
    return this.idempotent(user, key, { delivered: sid, ...input }, res, () => this.logistics.delivered(user, sid, input));
  }

  @Post('shipments/:shipment_id/cancel')
  cancel(@CurrentUser() user: AccessClaims, @Param('shipment_id') id: string, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const sid = parseOr(Uuid, id, 'params');
    const { reason } = parseOr(CancelZ, body);
    return this.idempotent(user, key, { cancel_shipment: sid, reason }, res, () => this.logistics.cancel(user, sid, reason));
  }
}
