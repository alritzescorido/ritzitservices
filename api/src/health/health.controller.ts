import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../auth/auth.guard.js';
import { dateOnly } from '../common/format.js';
import { DbService } from '../db/db.service.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Get()
  async health() {
    let dbStatus = 'ok';
    let lastSnapshot: string | null = null;
    try {
      const row = await this.db.one<{ d: string | null }>(`select max(snapshot_date)::text as d from price_snapshots`);
      lastSnapshot = dateOnly(row?.d ?? null);
    } catch (e) {
      dbStatus = `error: ${(e as Error).message}`;
    }
    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      db: dbStatus === 'ok' ? `ok (${this.db.kind})` : dbStatus,
      redis: 'not configured',
      last_snapshot_date: lastSnapshot,
    };
  }
}
