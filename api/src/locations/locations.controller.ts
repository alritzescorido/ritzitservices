import { Controller, Get, Header, Inject, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/auth.guard.js';
import { parseOr } from '../common/problem.js';
import { LocationsService } from './locations.service.js';

const Psgc = z.string().regex(/^[0-9]{9,10}$/, 'PSGC code is 9 or 10 digits');
const Level = z.enum(['region', 'province', 'municipality', 'barangay']);
const Limit = z.coerce.number().int().min(1).max(100).default(50);

const ListQuery = z.object({ parent: Psgc.optional(), level: Level.optional(), cursor: z.string().optional(), limit: Limit });
const SearchQuery = z.object({ q: z.string().trim().min(2).max(60), level: Level.optional(), limit: Limit });
const NearestQuery = z.object({ lat: z.coerce.number().min(4).max(22), lng: z.coerce.number().min(116).max(127) });

@Public()
@Controller('locations')
export class LocationsController {
  constructor(@Inject(LocationsService) private readonly locations: LocationsService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=86400')
  list(@Query() query: unknown) {
    return this.locations.list(parseOr(ListQuery, query, 'query'));
  }

  @Get('search')
  @Header('Cache-Control', 'public, max-age=3600')
  search(@Query() query: unknown) {
    const { q, level, limit } = parseOr(SearchQuery, query, 'query');
    return this.locations.search(q, level, limit);
  }

  @Get('nearest')
  nearest(@Query() query: unknown) {
    const { lat, lng } = parseOr(NearestQuery, query, 'query');
    return this.locations.nearest(lat, lng);
  }

  @Get(':psgc_code')
  @Header('Cache-Control', 'public, max-age=86400')
  get(@Param('psgc_code') code: string) {
    return this.locations.get(parseOr(Psgc, code, 'params'));
  }
}
