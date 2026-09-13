import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DbService } from '../db/db.service.js';
import { ProblemException } from './problem.js';

// The mobile app queues writes while offline and replays them, sometimes twice.
// Same key + same body returns the stored response; same key + different body
// is a client bug and returns 422. Rows are purged after 48 hours by the
// nightly job (Phase 1 backlog); until then the table just grows slowly.
export interface StoredResponse {
  status: number;
  body: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireIdempotencyKey(header: string | string[] | undefined): string {
  const key = Array.isArray(header) ? header[0] : header;
  if (!key) throw ProblemException.badRequest('Idempotency-Key header is required');
  if (!UUID.test(key)) throw ProblemException.badRequest('Idempotency-Key must be a UUID');
  return key.toLowerCase();
}

@Injectable()
export class IdempotencyService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async run<T>(userId: string, key: string, requestBody: unknown, fn: () => Promise<{ status: number; body: T }>): Promise<StoredResponse> {
    const hash = createHash('sha256').update(JSON.stringify(requestBody ?? null)).digest('hex');
    const existing = await this.db.one<{ request_hash: string; response_code: number; response_body: unknown }>(
      `select request_hash, response_code, response_body from idempotency_keys where user_id = $1 and key = $2`,
      [userId, key],
    );
    if (existing) {
      if (existing.request_hash !== hash) {
        throw new ProblemException(422, 'idempotency-mismatch', 'Idempotency key reused', 'This Idempotency-Key was already used with a different request body');
      }
      return { status: Number(existing.response_code), body: existing.response_body };
    }
    const out = await fn();
    await this.db.query(
      `insert into idempotency_keys (key, user_id, request_hash, response_code, response_body)
       values ($1, $2, $3, $4, $5::jsonb) on conflict (user_id, key) do nothing`,
      [key, userId, hash, out.status, JSON.stringify(out.body ?? null)],
    );
    return out;
  }
}
