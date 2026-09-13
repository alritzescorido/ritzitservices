import { Controller, Get, Header, Inject, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../auth/auth.guard.js';
import { parseOr } from '../common/problem.js';
import { PricesService } from './prices.service.js';

const Psgc = z.string().regex(/^[0-9]{9,10}$/, 'PSGC code is 9 or 10 digits');
const SpeciesZ = z.enum(['hog', 'cattle', 'carabao', 'goat', 'native_chicken']);
const DateZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const today = () => new Date().toISOString().slice(0, 10);

const BoardQuery = z.object({ municipality_code: Psgc, species: SpeciesZ.optional(), as_of: DateZ.optional() });
const RunningQuery = z.object({
  municipality_code: Psgc,
  species: SpeciesZ,
  weight_class_id: z.coerce.number().int().positive().optional(),
  as_of: DateZ.optional(),
});
const HistoryQuery = z.object({
  location_code: Psgc,
  species: SpeciesZ,
  weight_class_id: z.coerce.number().int().positive().optional(),
  days: z.coerce.number().int().min(7).max(365).default(30),
});
const WeightClassQuery = z.object({ species: SpeciesZ.optional() });

@Public()
@Controller()
export class PricesController {
  constructor(@Inject(PricesService) private readonly prices: PricesService) {}

  @Get('weight-classes')
  @Header('Cache-Control', 'public, max-age=86400')
  async weightClasses(@Query() query: unknown) {
    const { species } = parseOr(WeightClassQuery, query, 'query');
    return { items: await this.prices.weightClasses(species) };
  }

  @Get('prices/board')
  async board(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    const { municipality_code, species, as_of } = parseOr(BoardQuery, query, 'query');
    const { body, etag } = await this.prices.board(municipality_code, species, as_of ?? today());
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    return res.json(body);
  }

  @Get('prices/running')
  @Header('Cache-Control', 'public, max-age=300')
  running(@Query() query: unknown) {
    const { municipality_code, species, weight_class_id, as_of } = parseOr(RunningQuery, query, 'query');
    return this.prices.running(municipality_code, species, weight_class_id, as_of ?? today());
  }

  @Get('prices/history')
  @Header('Cache-Control', 'public, max-age=3600')
  history(@Query() query: unknown) {
    const { location_code, species, weight_class_id, days } = parseOr(HistoryQuery, query, 'query');
    return this.prices.history(location_code, species, weight_class_id, days);
  }
}
