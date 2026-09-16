import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { isoTime } from '../common/format.js';
import { ProblemException } from '../common/problem.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService } from '../db/db.service.js';

/**
 * Settings an admin changes from the console, without a deploy.
 *
 * The environment supplies the value the first time a key is read; after that
 * `platform_settings` is the truth. That way a pricing change is a decision
 * someone makes and the audit log records, not a redeploy.
 *
 * Values are cached in memory and the cache is dropped on every write. With
 * more than one API node, a node would keep a stale value until its own write
 * or restart; revisit when a second node exists.
 */

// z.coerce.boolean() is Boolean(v), so the string 'false' coerces to true and a
// setting stored as text could never be switched off. Read the word instead.
const BoolZ = z.preprocess((v) => (typeof v === 'string' ? v === 'true' : v), z.boolean());

export type SettingKey = 'commission_percent' | 'require_documents';

interface Definition {
  schema: z.ZodType<unknown>;
  /** Shown in the console, so write it for the admin reading it, not for us. */
  label: string;
  help: string;
  /** True when apps and the public may read it. Pricing internals stay private. */
  publicToClients: boolean;
  fallback: (c: AppConfig) => unknown;
}

const DEFINITIONS: Record<SettingKey, Definition> = {
  commission_percent: {
    schema: z.coerce.number().min(0).max(20),
    label: 'Platform commission',
    help: 'Percent of the deal estimate, added to what the buyer pays on top of the booking deposit. Never taken from the farmer. Earned only when a deal settles. Zero charges nothing. A change applies to deals accepted from now on; deals already struck keep the rate they were agreed at.',
    publicToClients: false,
    fallback: (c) => c.COMMISSION_PERCENT,
  },
  require_documents: {
    schema: BoolZ,
    label: 'Require an ID before verification',
    help: 'On: a farmer, buyer or hauler must upload at least one document before they appear in the verification queue, and the apps mark the upload as required. Off: they can be verified without one, and the apps mark it optional. Turn it off only where an admin has another way to confirm who someone is.',
    publicToClients: true,
    fallback: () => true,
  },
};

export const SETTING_KEYS = Object.keys(DEFINITIONS) as SettingKey[];

@Injectable()
export class SettingsService {
  private readonly log = new Logger(SettingsService.name);
  private cache = new Map<SettingKey, unknown>();

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DbService) private readonly db: DbService,
  ) {}

  private def(key: string): Definition {
    const d = DEFINITIONS[key as SettingKey];
    if (!d) throw ProblemException.validation([{ field: 'key', message: `Unknown setting "${key}"` }]);
    return d;
  }

  private parse(key: SettingKey, raw: unknown): unknown {
    const r = this.def(key).schema.safeParse(raw);
    if (r.success) return r.data;
    throw ProblemException.validation([{ field: key, message: r.error.issues[0]?.message ?? 'Invalid value' }]);
  }

  async get<T = unknown>(key: SettingKey): Promise<T> {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const row = await this.db.one<{ value: string }>(`select value from platform_settings where key = $1`, [key]);
    const value = row ? this.parse(key, row.value) : this.def(key).fallback(this.config);
    this.cache.set(key, value);
    return value as T;
  }

  number(key: SettingKey) {
    return this.get<number>(key);
  }
  bool(key: SettingKey) {
    return this.get<boolean>(key);
  }

  /** Everything the console shows, each with the text explaining what it does. */
  async all() {
    const items = [];
    for (const key of SETTING_KEYS) {
      const d = DEFINITIONS[key];
      const row = await this.db.one<{ value: string; updated_at: string; full_name: string | null }>(
        `select s.value, s.updated_at::text as updated_at, u.full_name from platform_settings s left join users u on u.id = s.updated_by where s.key = $1`,
        [key],
      );
      items.push({
        key,
        value: await this.get(key),
        type: key === 'require_documents' ? 'boolean' : 'number',
        label: d.label,
        help: d.help,
        /** False while the value is still whatever the environment supplied. */
        set_by_admin: Boolean(row),
        updated_by_name: row?.full_name ?? null,
        updated_at: isoTime(row?.updated_at),
      });
    }
    return { items };
  }

  /** Writes the value and an audit row in one transaction, then drops the cache. */
  async set(adminId: string, key: string, raw: unknown) {
    const k = key as SettingKey;
    this.def(k);
    const value = this.parse(k, raw);
    const before = await this.get(k);
    await this.db.tx(async (q) => {
      await q.query(
        `insert into platform_settings (key, value, updated_by, updated_at) values ($1, $2, $3, now())
         on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
        [k, String(value), adminId],
      );
      await q.query(
        `insert into admin_audit_log (admin_id, action, target_type, target_id, before_json, after_json) values ($1, 'set_setting', 'setting', $2, $3::jsonb, $4::jsonb)`,
        [adminId, k, JSON.stringify({ value: before }), JSON.stringify({ value })],
      );
    });
    this.cache.delete(k);
    this.log.log(`${k}: ${JSON.stringify(before)} -> ${JSON.stringify(value)}`);
    return this.all();
  }

  /** The subset the apps may read before anyone has signed in. */
  async publicSettings() {
    const out: Record<string, unknown> = {};
    for (const key of SETTING_KEYS) if (DEFINITIONS[key].publicToClients) out[key] = await this.get(key);
    return out;
  }
}
