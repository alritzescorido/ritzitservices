import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG, type AppConfig } from '../config.js';

// One small interface over two engines:
//   - pg Pool against PostgreSQL + PostGIS (staging, production, CI)
//   - PGlite, Postgres compiled to WebAssembly, in-process (local dev on a
//     machine without Docker, and the e2e tests)
// Every SQL statement in this codebase is written once and runs on both.
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

interface Engine extends Queryable {
  /** Run a multi-statement SQL script (schema, seeds). No parameters. */
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'postgres' | 'pglite';
}

async function pgEngine(url: string): Promise<Engine> {
  const pg = await import('pg');
  const { Pool, types } = pg.default;
  // Dates and timestamps come back as text; the API formats them itself so
  // both engines behave the same. numeric already arrives as a string.
  types.setTypeParser(1082, (v: string) => v); // date
  types.setTypeParser(1114, (v: string) => v); // timestamp
  types.setTypeParser(1184, (v: string) => v); // timestamptz
  types.setTypeParser(20, (v: string) => Number(v)); // int8
  const pool = new Pool({ connectionString: url, max: 10 });
  const wrap = (c: { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> }): Queryable => ({
    async query<T>(text: string, params?: unknown[]) {
      const r = await c.query(text, params);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? r.rows.length };
    },
  });
  return {
    kind: 'postgres',
    query: (t, p) => wrap(pool).query(t, p),
    exec: async (sql) => {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(wrap(client));
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function pgliteEngine(url: string): Promise<Engine> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const target = url.slice('pglite://'.length);
  const parsers = {
    1082: (v: string) => v, // date as text
    1114: (v: string) => v,
    1184: (v: string) => v,
    1700: (v: string) => v, // numeric as text, like pg
  };
  const db = target === 'memory' ? new PGlite({ extensions: { pgcrypto }, parsers }) : new PGlite(resolve(target), { extensions: { pgcrypto }, parsers });
  await db.waitReady;
  const wrap = (c: { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> }): Queryable => ({
    async query<T>(text: string, params?: unknown[]) {
      const r = await c.query(text, params);
      return { rows: r.rows as T[], rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  return {
    kind: 'pglite',
    query: (t, p) => wrap(db).query(t, p),
    exec: async (sql) => {
      await db.exec(sql);
    },
    tx: (fn) => db.transaction((t) => fn(wrap(t))),
    close: () => db.close(),
  };
}

@Injectable()
export class DbService implements Queryable, OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DbService.name);
  private engine!: Engine;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  get kind() {
    return this.engine.kind;
  }

  async onModuleInit() {
    const url = this.config.DATABASE_URL;
    this.engine = url.startsWith('pglite://') ? await pgliteEngine(url) : await pgEngine(url);
    this.log.log(`database engine: ${this.engine.kind}`);
    if (this.config.DB_AUTO_SCHEMA) await this.ensureSchema();
  }

  async onModuleDestroy() {
    await this.engine?.close();
  }

  query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
    return this.engine.query<T>(text, params);
  }

  tx<T>(fn: (q: Queryable) => Promise<T>) {
    return this.engine.tx(fn);
  }

  /** Multi-statement script, e.g. db/schema.sql or a seed file. */
  exec(sql: string) {
    return this.engine.exec(sql);
  }

  async one<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null> {
    const { rows } = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  /** Apply db/schema.sql when the database is empty. Local and CI convenience only. */
  private async ensureSchema() {
    const { rows } = await this.query<{ ok: boolean }>(`select to_regclass('locations') is not null as ok`);
    if (rows[0]?.ok) return;
    const schemaPath = resolve(process.cwd(), this.config.SCHEMA_PATH);
    if (!existsSync(schemaPath)) throw new Error(`DB_AUTO_SCHEMA is on but ${schemaPath} does not exist`);
    this.log.warn(`empty database, applying ${schemaPath}`);
    await this.exec(readFileSync(schemaPath, 'utf8'));
    const seedPath = resolve(process.cwd(), this.config.SEED_LOCATIONS_PATH);
    if (existsSync(seedPath)) {
      this.log.warn(`loading PSGC locations from ${seedPath}`);
      await this.exec(readFileSync(seedPath, 'utf8'));
    }
  }
}
