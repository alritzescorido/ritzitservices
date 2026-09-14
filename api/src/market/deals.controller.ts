import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, type AccessClaims } from '../auth/auth.guard.js';
import { IdempotencyService, requireIdempotencyKey } from '../common/idempotency.js';
import { parseOr } from '../common/problem.js';
import { DealsService } from './deals.service.js';

const Uuid = z.string().uuid();
const Weight = z.string().regex(/^[0-9]+(\.[0-9]{1,2})?$/, 'Kilograms as a decimal string');
const StateZ = z.enum(['accepted', 'hauler_assigned', 'in_transit', 'delivered', 'settled', 'cancelled', 'disputed', 'refunded']);

const ListQuery = z.object({ state: StateZ.optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const DeliverZ = z.object({ delivered_heads: z.number().int().min(0), delivered_weight_kg: Weight.nullable().optional(), note: z.string().max(500).nullable().optional() });
const PayZ = z.object({ method: z.enum(['gcash', 'bank', 'cash']), reference: z.string().max(80).nullable().optional() });
const CancelZ = z.object({ reason: z.string().trim().min(3).max(300) });
const DisputeZ = z.object({ reason: z.enum(['weight_mismatch', 'health', 'non_payment', 'no_show', 'other']), details: z.string().max(1000).nullable().optional() });
const RateZ = z.object({ score: z.number().int().min(1).max(5), comment: z.string().max(300).nullable().optional() });

@Controller('deals')
export class DealsController {
  constructor(
    @Inject(DealsService) private readonly deals: DealsService,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
  ) {}

  private async idempotent(user: AccessClaims, key: string | undefined, payload: unknown, res: Response, fn: () => Promise<unknown>, status = 200) {
    const out = await this.idem.run(user.sub, requireIdempotencyKey(key), payload, async () => ({ status, body: await fn() }));
    res.status(out.status).json(out.body);
  }

  @Get()
  list(@CurrentUser() user: AccessClaims, @Query() query: unknown) {
    return this.deals.listMine(user, parseOr(ListQuery, query, 'query'));
  }

  @Get(':deal_id')
  get(@CurrentUser() user: AccessClaims, @Param('deal_id') id: string) {
    return this.deals.get(user, parseOr(Uuid, id, 'params'));
  }

  @Post(':deal_id/deliver')
  deliver(@CurrentUser() user: AccessClaims, @Param('deal_id') id: string, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const dealId = parseOr(Uuid, id, 'params');
    const input = parseOr(DeliverZ, body);
    return this.idempotent(user, key, { deliver: dealId, ...input }, res, () => this.deals.deliver(user, dealId, input));
  }

  @Post(':deal_id/pay')
  pay(@CurrentUser() user: AccessClaims, @Param('deal_id') id: string, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const dealId = parseOr(Uuid, id, 'params');
    const input = parseOr(PayZ, body);
    return this.idempotent(user, key, { pay: dealId, ...input }, res, () => this.deals.pay(user, dealId, input));
  }

  @Post(':deal_id/confirm-payment')
  confirm(@CurrentUser() user: AccessClaims, @Param('deal_id') id: string, @Headers('idempotency-key') key: string | undefined, @Res() res: Response) {
    const dealId = parseOr(Uuid, id, 'params');
    return this.idempotent(user, key, { confirm: dealId }, res, () => this.deals.confirmPayment(user, dealId));
  }

  @Post(':deal_id/cancel')
  cancel(@CurrentUser() user: AccessClaims, @Param('deal_id') id: string, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const dealId = parseOr(Uuid, id, 'params');
    const { reason } = parseOr(CancelZ, body);
    return this.idempotent(user, key, { cancel: dealId, reason }, res, () => this.deals.cancel(user, dealId, reason));
  }

  @Post(':deal_id/dispute')
  dispute(@CurrentUser() user: AccessClaims, @Param('deal_id') id: string, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const dealId = parseOr(Uuid, id, 'params');
    const input = parseOr(DisputeZ, body);
    return this.idempotent(user, key, { dispute: dealId, ...input }, res, () => this.deals.openDispute(user, dealId, input), 201);
  }

  @Post(':deal_id/ratings')
  @HttpCode(201)
  async rate(@CurrentUser() user: AccessClaims, @Param('deal_id') id: string, @Body() body: unknown) {
    await this.deals.rate(user, parseOr(Uuid, id, 'params'), parseOr(RateZ, body));
    return { rated: true };
  }
}
