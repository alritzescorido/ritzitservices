import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService } from '../db/db.service.js';
import { MarketService } from '../market/market.service.js';

// The two housekeeping jobs the API needs before Phase 2 adds on-settle
// refreshes: the 5:00 AM Manila snapshot that the board promises ("Updated
// 5:00 AM and after every sale"), and an hourly purge of expired auth and
// idempotency rows. Plain timers, one instance: when the API runs on more than
// one node, set SCHEDULER_ENABLED=true on exactly one of them or move these to
// the platform's cron. Every run is written to job_runs so ops can see it.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SchedulerService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DbService) private readonly db: DbService,
    @Inject(MarketService) private readonly market: MarketService,
  ) {}

  onModuleInit() {
    if (!this.config.SCHEDULER_ENABLED) {
      this.log.log('scheduler disabled (SCHEDULER_ENABLED=false)');
      return;
    }
    this.scheduleDaily();
    this.timers.push(setInterval(() => void this.runJob('purge_expired', () => this.purgeExpired()), HOUR));
    this.log.log(`scheduler on: nightly snapshots at ${String(this.config.SNAPSHOT_HOUR_MANILA).padStart(2, '0')}:00 Asia/Manila, purge hourly`);
  }

  onModuleDestroy() {
    for (const t of this.timers) clearTimeout(t);
  }

  /** Next occurrence of SNAPSHOT_HOUR_MANILA, in ms from now. Manila has no DST, so a fixed offset is exact. */
  msUntilNextSnapshot(now = Date.now()): number {
    const manila = new Date(now + MANILA_OFFSET_MS);
    const next = new Date(manila);
    next.setUTCHours(this.config.SNAPSHOT_HOUR_MANILA, 0, 0, 0);
    if (next.getTime() <= manila.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - manila.getTime();
  }

  private scheduleDaily() {
    const t = setTimeout(async () => {
      await this.runJob('nightly_snapshots', () => this.refreshSnapshots());
      this.scheduleDaily();
    }, this.msUntilNextSnapshot());
    this.timers.push(t);
  }

  /** Recompute today's and yesterday's snapshots (late settlements land on yesterday's window). */
  async refreshSnapshots() {
    const today = new Date(Date.now() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() + MANILA_OFFSET_MS - 86_400_000).toISOString().slice(0, 10);
    const a = await this.db.one<{ n: number }>(`select refresh_price_snapshots($1::date, 7) as n`, [yesterday]);
    const b = await this.db.one<{ n: number }>(`select refresh_price_snapshots($1::date, 7) as n`, [today]);
    return { yesterday: Number(a?.n ?? 0), today: Number(b?.n ?? 0) };
  }

  /** Idempotency keys after 48 h, OTP challenges after 24 h, dead refresh tokens after 7 days; pending offers past expiry. */
  async purgeExpired() {
    const offers = await this.market.expireOffers();
    const keys = await this.db.query(`delete from idempotency_keys where created_at < now() - interval '48 hours'`);
    const otps = await this.db.query(`delete from auth_otp_challenges where created_at < now() - interval '24 hours'`);
    const tokens = await this.db.query(
      `delete from refresh_tokens where (expires_at < now() - interval '7 days') or (revoked_at is not null and revoked_at < now() - interval '7 days')`,
    );
    return { idempotency_keys: keys.rowCount, otp_challenges: otps.rowCount, refresh_tokens: tokens.rowCount, offers_expired: offers };
  }

  async runJob(name: string, fn: () => Promise<unknown>) {
    const started = Date.now();
    try {
      const detail = await fn();
      await this.record(name, 'ok', detail, Date.now() - started);
      this.log.log(`${name}: ${JSON.stringify(detail)} in ${Date.now() - started} ms`);
      return detail;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.record(name, 'failed', { error: message }, Date.now() - started).catch(() => undefined);
      this.log.error(`${name} failed: ${message}`);
      throw e;
    }
  }

  private async record(name: string, status: 'ok' | 'failed', detail: unknown, ms: number) {
    await this.db.query(`insert into job_runs (job, status, detail, duration_ms) values ($1, $2, $3::jsonb, $4)`, [
      name,
      status,
      JSON.stringify(detail ?? null),
      ms,
    ]);
  }
}
