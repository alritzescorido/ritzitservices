import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, type AccessClaims } from '../auth/auth.guard.js';
import { IdempotencyService, requireIdempotencyKey } from '../common/idempotency.js';
import { parseOr } from '../common/problem.js';
import { MarketService } from './market.service.js';

const Uuid = z.string().uuid();
const Psgc = z.string().regex(/^[0-9]{9,10}$/);
const Money = z.string().regex(/^[0-9]+(\.[0-9]{1,2})?$/, 'Pesos as a decimal string, e.g. "185.50"').transform((v) => Number(v).toFixed(2));
const DateZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const SpeciesZ = z.enum(['hog', 'cattle', 'carabao', 'goat', 'native_chicken']);
const Bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const ListQuery = z.object({
  species: SpeciesZ.optional(),
  weight_class_id: z.coerce.number().int().positive().optional(),
  province_code: Psgc.optional(),
  municipality_code: Psgc.optional(),
  verified_only: Bool.optional(),
  mine: Bool.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const ListingInputZ = z.object({
  lot_id: Uuid,
  heads_offered: z.number().int().min(1),
  asking_price: Money,
  available_from: DateZ.optional(),
  pickup_window_end: DateZ.nullable().optional(),
});
const OfferInputZ = z.object({
  price: Money,
  heads: z.number().int().min(1),
  pickup_on: DateZ.nullable().optional(),
  needs_hauler: z.boolean().default(true),
  dropoff_location_code: z.string().regex(/^[0-9]{10}$/, 'PSGC code').nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});
const CounterZ = z.object({ price: Money, heads: z.number().int().min(1), note: z.string().max(300).nullable().optional() });
const RejectZ = z.object({ note: z.string().max(300).nullable().optional() }).optional();

@Controller()
export class MarketController {
  constructor(
    @Inject(MarketService) private readonly market: MarketService,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
  ) {}

  @Get('listings')
  list(@CurrentUser() user: AccessClaims, @Query() query: unknown) {
    return this.market.list(user, parseOr(ListQuery, query, 'query'));
  }

  @Post('listings')
  async create(@CurrentUser() user: AccessClaims, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const input = parseOr(ListingInputZ, body);
    const out = await this.idem.run(user.sub, requireIdempotencyKey(key), input, async () => ({ status: 201, body: await this.market.create(user, input) }));
    res.status(out.status).json(out.body);
  }

  @Get('listings/:listing_id')
  get(@Param('listing_id') id: string) {
    return this.market.get(parseOr(Uuid, id, 'params'));
  }

  @Delete('listings/:listing_id')
  @HttpCode(204)
  async withdraw(@CurrentUser() user: AccessClaims, @Param('listing_id') id: string) {
    await this.market.withdraw(user, parseOr(Uuid, id, 'params'));
  }

  @Get('listings/:listing_id/offers')
  async offers(@CurrentUser() user: AccessClaims, @Param('listing_id') id: string) {
    return { items: await this.market.listOffers(user, parseOr(Uuid, id, 'params')) };
  }

  @Post('listings/:listing_id/offers')
  async makeOffer(@CurrentUser() user: AccessClaims, @Param('listing_id') id: string, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const listingId = parseOr(Uuid, id, 'params');
    const input = parseOr(OfferInputZ, body);
    const out = await this.idem.run(user.sub, requireIdempotencyKey(key), { listingId, ...input }, async () => ({ status: 201, body: await this.market.makeOffer(user, listingId, input) }));
    res.status(out.status).json(out.body);
  }

  @Post('offers/:offer_id/counter')
  async counter(@CurrentUser() user: AccessClaims, @Param('offer_id') id: string, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const offerId = parseOr(Uuid, id, 'params');
    const input = parseOr(CounterZ, body);
    const out = await this.idem.run(user.sub, requireIdempotencyKey(key), { offerId, ...input }, async () => ({ status: 201, body: await this.market.counter(user, offerId, input) }));
    res.status(out.status).json(out.body);
  }

  @Post('offers/:offer_id/accept')
  async accept(@CurrentUser() user: AccessClaims, @Param('offer_id') id: string, @Headers('idempotency-key') key: string | undefined, @Res() res: Response) {
    const offerId = parseOr(Uuid, id, 'params');
    const out = await this.idem.run(user.sub, requireIdempotencyKey(key), { accept: offerId }, async () => ({ status: 201, body: await this.market.accept(user, offerId) }));
    res.status(out.status).json(out.body);
  }

  @Post('offers/:offer_id/reject')
  @HttpCode(200)
  reject(@CurrentUser() user: AccessClaims, @Param('offer_id') id: string, @Body() body: unknown) {
    return this.market.reject(user, parseOr(Uuid, id, 'params'), parseOr(RejectZ, body ?? undefined)?.note);
  }
}
