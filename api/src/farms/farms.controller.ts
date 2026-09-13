import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Roles, type AccessClaims } from '../auth/auth.guard.js';
import { IdempotencyService, requireIdempotencyKey } from '../common/idempotency.js';
import { parseOr, ProblemException } from '../common/problem.js';
import { FarmsService } from './farms.service.js';

const Uuid = z.string().uuid();
const Psgc = z.string().regex(/^[0-9]{9,10}$/, 'PSGC code is 9 or 10 digits');
const SpeciesZ = z.enum(['hog', 'cattle', 'carabao', 'goat', 'native_chicken']);
const Keys = z.array(z.string().max(200)).max(5).default([]);

export const FarmInputZ = z.object({
  name: z.string().trim().min(2).max(120),
  barangay_code: Psgc,
  address_line: z.string().max(200).nullable().optional(),
  geo: z.object({ lat: z.number().min(4).max(22), lng: z.number().min(116).max(127) }).nullable().optional(),
  farm_type: z.enum(['backyard', 'commercial', 'cooperative']).nullable().optional(),
  permit_ref: z.string().max(80).nullable().optional(),
  photo_keys: Keys,
});

export const LotInputZ = z.object({
  species: SpeciesZ,
  breed: z.string().max(60).nullable().optional(),
  head_count: z.number().int().min(1).max(100000),
  avg_weight_kg: z.string().regex(/^[0-9]+(\.[0-9]{1,2})?$/, 'Kilograms as a decimal string, e.g. "92.5"').nullable().optional(),
  weight_class_id: z.number().int().positive().nullable().optional(),
  age_months: z.number().int().min(0).max(300).nullable().optional(),
  sex: z.enum(['male', 'female', 'mixed']).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  photo_keys: Keys,
});

export const VaccinationInputZ = z.object({
  vaccine: z.string().trim().min(1).max(80),
  given_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  given_by: z.string().max(120).nullable().optional(),
  doc_key: z.string().max(200).nullable().optional(),
});

export function requireIfMatch(header: string | undefined): number {
  if (header === undefined || header === '') throw ProblemException.preconditionRequired();
  const v = Number(header.replace(/"/g, ''));
  if (!Number.isInteger(v) || v < 1) throw ProblemException.badRequest('If-Match must be the integer version you last saw');
  return v;
}

@Controller()
export class FarmsController {
  constructor(
    @Inject(FarmsService) private readonly farms: FarmsService,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
  ) {}

  // ---- farms ---------------------------------------------------------------

  @Get('farms')
  async listFarms(@CurrentUser() user: AccessClaims) {
    return { items: await this.farms.listMine(user.sub) };
  }

  @Post('farms')
  @Roles('farmer')
  async createFarm(@CurrentUser() user: AccessClaims, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res() res: Response) {
    const input = parseOr(FarmInputZ, body);
    const out = await this.idem.run(user.sub, requireIdempotencyKey(key), input, async () => ({
      status: 201,
      body: await this.farms.createFarm(user.sub, input),
    }));
    res.status(out.status).json(out.body);
  }

  @Get('farms/:farm_id')
  getFarm(@CurrentUser() user: AccessClaims, @Param('farm_id') farmId: string) {
    return this.farms.getFarm(user.sub, parseOr(Uuid, farmId, 'params'));
  }

  @Patch('farms/:farm_id')
  updateFarm(@CurrentUser() user: AccessClaims, @Param('farm_id') farmId: string, @Headers('if-match') ifMatch: string | undefined, @Body() body: unknown) {
    return this.farms.updateFarm(user.sub, parseOr(Uuid, farmId, 'params'), requireIfMatch(ifMatch), parseOr(FarmInputZ, body));
  }

  @Delete('farms/:farm_id')
  @HttpCode(204)
  async archiveFarm(@CurrentUser() user: AccessClaims, @Param('farm_id') farmId: string) {
    await this.farms.archiveFarm(user.sub, parseOr(Uuid, farmId, 'params'));
  }

  // ---- lots ----------------------------------------------------------------

  @Get('farms/:farm_id/lots')
  async listLots(@CurrentUser() user: AccessClaims, @Param('farm_id') farmId: string, @Query('species') species?: string) {
    const sp = species ? parseOr(SpeciesZ, species, 'query') : undefined;
    return { items: await this.farms.listLots(user.sub, parseOr(Uuid, farmId, 'params'), sp) };
  }

  @Post('farms/:farm_id/lots')
  async createLot(
    @CurrentUser() user: AccessClaims,
    @Param('farm_id') farmId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const input = parseOr(LotInputZ, body);
    const id = parseOr(Uuid, farmId, 'params');
    const out = await this.idem.run(user.sub, requireIdempotencyKey(key), { farm: id, ...input }, async () => ({
      status: 201,
      body: await this.farms.createLot(user.sub, id, input),
    }));
    res.status(out.status).json(out.body);
  }

  @Get('lots/:lot_id')
  getLot(@CurrentUser() user: AccessClaims, @Param('lot_id') lotId: string) {
    return this.farms.getLotDetail(user.sub, parseOr(Uuid, lotId, 'params'));
  }

  @Patch('lots/:lot_id')
  updateLot(@CurrentUser() user: AccessClaims, @Param('lot_id') lotId: string, @Headers('if-match') ifMatch: string | undefined, @Body() body: unknown) {
    return this.farms.updateLot(user.sub, parseOr(Uuid, lotId, 'params'), requireIfMatch(ifMatch), parseOr(LotInputZ, body));
  }

  @Delete('lots/:lot_id')
  @HttpCode(204)
  async deleteLot(@CurrentUser() user: AccessClaims, @Param('lot_id') lotId: string) {
    await this.farms.deleteLot(user.sub, parseOr(Uuid, lotId, 'params'));
  }

  @Post('lots/:lot_id/vaccinations')
  async addVaccination(
    @CurrentUser() user: AccessClaims,
    @Param('lot_id') lotId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const input = parseOr(VaccinationInputZ, body);
    const id = parseOr(Uuid, lotId, 'params');
    const out = await this.idem.run(user.sub, requireIdempotencyKey(key), { lot: id, ...input }, async () => ({
      status: 201,
      body: await this.farms.addVaccination(user.sub, id, input),
    }));
    res.status(out.status).json(out.body);
  }
}
