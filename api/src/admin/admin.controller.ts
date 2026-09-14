import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Roles, type AccessClaims } from '../auth/auth.guard.js';
import { IdempotencyService, requireIdempotencyKey } from '../common/idempotency.js';
import { parseOr } from '../common/problem.js';
import { DealsService } from '../market/deals.service.js';
import { AdminService } from './admin.service.js';

const Uuid = z.string().uuid();
const Psgc = z.string().regex(/^[0-9]{9,10}$/);
const SpeciesZ = z.enum(['hog', 'cattle', 'carabao', 'goat', 'native_chicken']);
const DateZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const Limit = z.coerce.number().int().min(1).max(100).default(50);

const QueueQuery = z.object({ role: z.enum(['farmer', 'buyer', 'hauler', 'admin']).optional(), province_code: Psgc.optional(), cursor: z.string().optional(), limit: Limit });
const SetVerification = z.object({ status: z.enum(['verified', 'rejected', 'suspended']), notes: z.string().max(1000).optional() });
const ReviewDocument = z.object({ status: z.enum(['verified', 'rejected']), notes: z.string().max(1000).optional() });
const RefQuery = z.object({ province_code: Psgc.optional(), species: SpeciesZ.optional(), include_history: z.coerce.boolean().default(false) });
const RefInput = z.object({
  province_code: Psgc,
  species: SpeciesZ,
  weight_class_id: z.number().int().positive().nullable().optional(),
  unit: z.enum(['per_kg_liveweight', 'per_head']),
  price: z.string().regex(/^[0-9]+\.[0-9]{2}$/, 'Pesos as a decimal string with two decimals, e.g. "185.50"'),
  source: z.string().trim().min(1).max(200),
  effective_from: DateZ,
});
const ZoneInput = z.object({ location_code: Psgc, species: SpeciesZ, reason: z.string().trim().min(1).max(200), starts_on: DateZ, ends_on: DateZ.nullable().optional() });
const ZoneEnd = z.object({ ends_on: DateZ });
const Refresh = z.object({ date: DateZ.optional(), window_days: z.number().int().min(1).max(60).default(7) }).default({ window_days: 7 });
const AuditQuery = z.object({ admin_id: Uuid.optional(), action: z.string().max(60).optional(), target_id: z.string().max(200).optional(), cursor: z.string().regex(/^\d+$/).optional(), limit: Limit });
const DisputeStatus = z.enum(['open', 'under_review', 'resolved_settled', 'resolved_refunded', 'dismissed']);
const Resolve = z.object({
  outcome: z.enum(['settled', 'refunded', 'dismissed']),
  resolution: z.string().trim().min(3).max(1000),
  delivered_weight_kg: z.string().regex(/^[0-9]+(\.[0-9]{1,2})?$/).nullable().optional(),
});
const OutlierReview = z.object({ counts_for_price: z.boolean(), note: z.string().max(500).nullable().optional() });
const DealsQuery = z.object({
  state: z.enum(['accepted', 'hauler_assigned', 'in_transit', 'delivered', 'settled', 'cancelled', 'disputed', 'refunded']).optional(),
  species: SpeciesZ.optional(),
  province_code: Psgc.optional(),
  outliers_only: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  cursor: z.string().optional(),
  limit: Limit,
});

@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(DealsService) private readonly deals: DealsService,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
  ) {}

  @Get('disputes')
  async disputes(@Query('status') status?: string) {
    return { items: await this.deals.listDisputes(status ? parseOr(DisputeStatus, status, 'query') : undefined) };
  }

  @Post('disputes/:dispute_id/resolve')
  async resolveDispute(@CurrentUser() admin: AccessClaims, @Param('dispute_id') id: string, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const disputeId = parseOr(Uuid, id, 'params');
    const input = parseOr(Resolve, body);
    const out = await this.idem.run(admin.sub, requireIdempotencyKey(key), { disputeId, ...input }, async () => ({
      status: 200,
      body: await this.deals.resolveDispute(admin.sub, disputeId, input),
    }));
    res.status(out.status).json(out.body);
  }

  @Get('deals')
  listDeals(@Query() query: unknown) {
    return this.deals.adminList(parseOr(DealsQuery, query, 'query'));
  }

  @Post('deals/:deal_id/outlier-review')
  @HttpCode(200)
  reviewOutlier(@CurrentUser() admin: AccessClaims, @Param('deal_id') id: string, @Body() body: unknown) {
    const input = parseOr(OutlierReview, body);
    return this.deals.reviewOutlier(admin.sub, parseOr(Uuid, id, 'params'), input.counts_for_price, input.note);
  }

  @Get('verification-queue')
  queue(@Query() query: unknown) {
    return this.admin.verificationQueue(parseOr(QueueQuery, query, 'query'));
  }

  @Get('users/:user_id')
  user(@Param('user_id') id: string) {
    return this.admin.verificationCase(parseOr(Uuid, id, 'params'));
  }

  @Post('users/:user_id/verification')
  async setVerification(
    @CurrentUser() admin: AccessClaims,
    @Param('user_id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const userId = parseOr(Uuid, id, 'params');
    const input = parseOr(SetVerification, body);
    const out = await this.idem.run(admin.sub, requireIdempotencyKey(key), { userId, ...input }, async () => ({
      status: 200,
      body: await this.admin.setVerification(admin.sub, userId, input.status, input.notes),
    }));
    res.status(out.status).json(out.body);
  }

  @Post('documents/:document_id/review')
  @HttpCode(200)
  reviewDocument(@CurrentUser() admin: AccessClaims, @Param('document_id') id: string, @Body() body: unknown) {
    const input = parseOr(ReviewDocument, body);
    return this.admin.reviewDocument(admin.sub, parseOr(Uuid, id, 'params'), input.status, input.notes);
  }

  @Get('documents/:document_id/file')
  documentFile(@CurrentUser() admin: AccessClaims, @Param('document_id') id: string) {
    return this.admin.documentFileUrl(admin.sub, parseOr(Uuid, id, 'params'));
  }

  @Get('reference-prices')
  async referencePrices(@Query() query: unknown) {
    return { items: await this.admin.listReferencePrices(parseOr(RefQuery, query, 'query')) };
  }

  @Post('reference-prices')
  async setReferencePrice(@CurrentUser() admin: AccessClaims, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const input = parseOr(RefInput, body);
    const out = await this.idem.run(admin.sub, requireIdempotencyKey(key), input, async () => ({
      status: 201,
      body: await this.admin.setReferencePrice(admin.sub, input),
    }));
    res.status(out.status).json(out.body);
  }

  /** Body is text/csv; the default JSON parser leaves it on the stream, so read it here. */
  @Post('reference-prices/import')
  @HttpCode(201)
  async importReferencePrices(@CurrentUser() admin: AccessClaims, @Req() req: Request) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return this.admin.importReferencePrices(admin.sub, Buffer.concat(chunks).toString('utf8'));
  }

  @Get('restricted-zones')
  async zones(@Query('active_on') activeOn?: string) {
    return { items: await this.admin.listRestrictedZones(activeOn ? parseOr(DateZ, activeOn, 'query') : undefined) };
  }

  @Post('restricted-zones')
  async createZone(@CurrentUser() admin: AccessClaims, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const input = parseOr(ZoneInput, body);
    const out = await this.idem.run(admin.sub, requireIdempotencyKey(key), input, async () => ({
      status: 201,
      body: await this.admin.createRestrictedZone(admin.sub, input),
    }));
    res.status(out.status).json(out.body);
  }

  @Patch('restricted-zones/:zone_id')
  endZone(@CurrentUser() admin: AccessClaims, @Param('zone_id') id: string, @Body() body: unknown) {
    return this.admin.endRestrictedZone(admin.sub, parseOr(Uuid, id, 'params'), parseOr(ZoneEnd, body).ends_on);
  }

  @Post('price-snapshots/refresh')
  @HttpCode(200)
  refresh(@CurrentUser() admin: AccessClaims, @Body() body: unknown) {
    const { date, window_days } = parseOr(Refresh, body ?? {});
    return this.admin.refreshSnapshots(admin.sub, date, window_days);
  }

  @Get('audit-log')
  audit(@Query() query: unknown) {
    return this.admin.auditLog(parseOr(AuditQuery, query, 'query'));
  }
}
