import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService, type Queryable } from '../db/db.service.js';
import { ProblemException } from '../common/problem.js';
import { UsersService, type UserDto } from '../users/users.service.js';
import { SMS_PROVIDER, type SmsProvider } from './sms.provider.js';

export interface DeviceInfo {
  device_id: string;
  platform: 'android' | 'ios' | 'web';
  push_token?: string;
  app_version?: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in_seconds: number;
  user: UserDto;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DbService) private readonly db: DbService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private codeHash(challengeId: string, code: string) {
    return sha256(`${this.config.OTP_PEPPER}:${challengeId}:${code}`);
  }

  /**
   * Send a one-time code. The response is identical whether or not the phone
   * is registered, so the endpoint cannot be used to enumerate users.
   * Limits from the contract: 3 per phone per 10 minutes, 10 per IP per hour.
   */
  async requestOtp(phone: string, ip: string | null) {
    const perPhone = await this.db.one<{ n: number; newest: string | null }>(
      `select count(*)::int as n, max(created_at)::text as newest from auth_otp_challenges
        where phone_e164 = $1 and created_at > now() - interval '10 minutes'`,
      [phone],
    );
    if ((perPhone?.n ?? 0) >= this.config.OTP_PER_PHONE_PER_10_MIN) {
      throw ProblemException.rateLimited(600, 'Too many codes requested for this number. Try again in 10 minutes.');
    }
    if (perPhone?.newest) {
      const ageSec = (Date.now() - new Date(perPhone.newest.replace(' ', 'T')).getTime()) / 1000;
      if (ageSec < this.config.OTP_RESEND_AFTER_SECONDS) {
        throw ProblemException.rateLimited(
          Math.ceil(this.config.OTP_RESEND_AFTER_SECONDS - ageSec),
          'A code was just sent. Wait before asking for another.',
        );
      }
    }
    if (ip) {
      const perIp = await this.db.one<{ n: number }>(
        `select count(*)::int as n from auth_otp_challenges where request_ip = $1::inet and created_at > now() - interval '1 hour'`,
        [ip],
      );
      if ((perIp?.n ?? 0) >= this.config.OTP_PER_IP_PER_HOUR) {
        throw ProblemException.rateLimited(3600, 'Too many codes requested from this network.');
      }
    }

    const challengeId = randomUUID();
    const code = this.config.OTP_DEV_CODE ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.query(
      `insert into auth_otp_challenges (id, phone_e164, code_hash, expires_at, request_ip)
       values ($1, $2, $3, now() + ($4 || ' seconds')::interval, $5::inet)`,
      [challengeId, phone, this.codeHash(challengeId, code), String(this.config.OTP_TTL_SECONDS), ip],
    );
    await this.sms.send(phone, `Presyo ng Hayop code: ${code}. Valid ${Math.round(this.config.OTP_TTL_SECONDS / 60)} minutes. Never share it.`);

    return {
      challenge_id: challengeId,
      expires_in_seconds: this.config.OTP_TTL_SECONDS,
      resend_after_seconds: this.config.OTP_RESEND_AFTER_SECONDS,
    };
  }

  /** Exchange the code for tokens. Five wrong codes lock the challenge (423). */
  async verifyOtp(challengeId: string, code: string, device?: DeviceInfo): Promise<TokenPair> {
    // A wrong code must still commit the attempt counter, so the transaction
    // returns an outcome instead of throwing (which would roll the counter back).
    type Outcome = { ok: true; pair: TokenPair } | { ok: false; left: number };
    const outcome = await this.db.tx(async (q): Promise<Outcome> => {
      const ch = await q.query<{
        phone_e164: string;
        code_hash: string;
        attempts: number;
        expired: boolean;
        consumed: boolean;
      }>(
        `select phone_e164, code_hash, attempts, expires_at < now() as expired, consumed_at is not null as consumed
           from auth_otp_challenges where id = $1 for update`,
        [challengeId],
      );
      const c = ch.rows[0];
      if (!c || c.consumed || c.expired) throw ProblemException.unauthorized('Code expired or already used. Ask for a new one.');
      if (c.attempts >= this.config.OTP_MAX_ATTEMPTS) throw ProblemException.locked('Too many wrong codes. Ask for a new one.');

      const expected = Buffer.from(c.code_hash, 'hex');
      const given = Buffer.from(this.codeHash(challengeId, code), 'hex');
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
        const upd = await q.query<{ attempts: number }>(
          `update auth_otp_challenges set attempts = attempts + 1 where id = $1 returning attempts`,
          [challengeId],
        );
        return { ok: false, left: this.config.OTP_MAX_ATTEMPTS - Number(upd.rows[0].attempts) };
      }

      await q.query(`update auth_otp_challenges set consumed_at = now() where id = $1`, [challengeId]);
      const { user, created } = await this.users.findOrCreateByPhone(c.phone_e164, q);
      if (created) this.log.log(`new user ${user.id}`);
      if (device) await this.touchDevice(q, user.id, device);
      return { ok: true, pair: await this.issueTokens(q, user, randomUUID(), device?.device_id) };
    });
    if (outcome.ok) return outcome.pair;
    if (outcome.left <= 0) throw ProblemException.locked('Too many wrong codes. Ask for a new one.');
    throw ProblemException.unauthorized(`That code is not right. ${outcome.left} tries left.`);
  }

  /** Refresh tokens are single use. Reuse of a consumed token revokes its whole family. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    // Same pattern as verifyOtp: a family revocation must commit even though
    // the request itself fails, so the transaction reports instead of throwing.
    type Outcome = { ok: true; pair: TokenPair } | { ok: false; detail: string };
    const outcome = await this.db.tx(async (q): Promise<Outcome> => {
      const row = await q.query<{
        id: string;
        user_id: string;
        family_id: string;
        device_id: string | null;
        expired: boolean;
        consumed: boolean;
        revoked: boolean;
      }>(
        `select id, user_id, family_id, device_id, expires_at < now() as expired,
                consumed_at is not null as consumed, revoked_at is not null as revoked
           from refresh_tokens where token_hash = $1 for update`,
        [sha256(refreshToken)],
      );
      const t = row.rows[0];
      if (!t || t.revoked || t.expired) return { ok: false, detail: 'Refresh token is invalid. Sign in again.' };
      if (t.consumed) {
        await q.query(`update refresh_tokens set revoked_at = now() where family_id = $1 and revoked_at is null`, [t.family_id]);
        this.log.warn(`refresh token reuse, family ${t.family_id} revoked`);
        return { ok: false, detail: 'Refresh token was already used. Sign in again.' };
      }
      await q.query(`update refresh_tokens set consumed_at = now() where id = $1`, [t.id]);
      const user = await this.users.byId(t.user_id, q);
      return { ok: true, pair: await this.issueTokens(q, user, t.family_id, t.device_id ?? undefined) };
    });
    if (outcome.ok) return outcome.pair;
    throw ProblemException.unauthorized(outcome.detail);
  }

  /** Revoke one family (when the client sends its refresh token) or every family of the user. */
  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await this.db.query(
        `update refresh_tokens set revoked_at = now()
          where user_id = $1 and revoked_at is null
            and family_id = (select family_id from refresh_tokens where token_hash = $2)`,
        [userId, sha256(refreshToken)],
      );
    } else {
      await this.db.query(`update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
    }
  }

  private async touchDevice(q: Queryable, userId: string, d: DeviceInfo) {
    await q.query(
      `insert into user_devices (user_id, device_id, platform, push_token, app_version)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, device_id) do update
         set platform = excluded.platform, push_token = coalesce(excluded.push_token, user_devices.push_token),
             app_version = coalesce(excluded.app_version, user_devices.app_version), last_seen_at = now()`,
      [userId, d.device_id, d.platform, d.push_token ?? null, d.app_version ?? null],
    );
  }

  private async issueTokens(q: Queryable, user: UserDto, familyId: string, deviceId?: string): Promise<TokenPair> {
    const access = await this.jwt.signAsync(
      { sub: user.id, roles: user.roles, ver: user.verification, jti: randomUUID() },
      { expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS },
    );
    const refresh = randomBytes(32).toString('base64url');
    await q.query(
      `insert into refresh_tokens (user_id, family_id, token_hash, device_id, expires_at)
       values ($1, $2, $3, $4, now() + ($5 || ' days')::interval)`,
      [user.id, familyId, sha256(refresh), deviceId ?? null, String(this.config.REFRESH_TOKEN_TTL_DAYS)],
    );
    return { access_token: access, refresh_token: refresh, expires_in_seconds: this.config.ACCESS_TOKEN_TTL_SECONDS, user };
  }
}
