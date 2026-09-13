import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { AuthService, type TokenPair } from '../auth/auth.service.js';
import { ProblemException } from '../common/problem.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService } from '../db/db.service.js';
import { UsersService } from '../users/users.service.js';
import { hashPassword, newTotpSecret, otpauthUrl, totpMatches, verifyPassword } from './totp.js';

// Console sign-in (decision 5, assumed): work email + password, then a
// 6-digit authenticator code. Two steps joined by a 5-minute step token.
// Lockout: 5 failures (either step) lock the account for 15 minutes.

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const STEP_TTL_SECONDS = 300;
const ISSUER = 'Livestock Price Board';

interface CredRow {
  user_id: string;
  email: string;
  password_hash: string;
  totp_secret: string | null;
  totp_confirmed_at: string | null;
  failed_attempts: number;
  lock_seconds: number; // seconds until the lock ends, 0 when not locked; computed in SQL so clocks agree
  is_admin: boolean;
}

const CRED_COLS = `c.user_id, c.email, c.password_hash, c.totp_secret, c.totp_confirmed_at::text as totp_confirmed_at, c.failed_attempts,
  greatest(0, coalesce(extract(epoch from c.locked_until - now()), 0))::int as lock_seconds`;

@Injectable()
export class AdminAuthService {
  private readonly log = new Logger(AdminAuthService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DbService) private readonly db: DbService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private async load(email: string): Promise<CredRow | null> {
    return this.db.one<CredRow>(
      `select ${CRED_COLS},
              exists (select 1 from user_roles r where r.user_id = c.user_id and r.role = 'admin') as is_admin
         from admin_credentials c where c.email = $1`,
      [email.trim().toLowerCase()],
    );
  }

  private lockedFor(row: CredRow): number {
    return Number(row.lock_seconds) || 0;
  }

  private async fail(userId: string) {
    const r = await this.db.one<{ failed_attempts: number }>(
      `update admin_credentials
          set failed_attempts = failed_attempts + 1,
              locked_until = case when failed_attempts + 1 >= $2 then now() + ($3 || ' minutes')::interval else locked_until end,
              updated_at = now()
        where user_id = $1 returning failed_attempts`,
      [userId, MAX_FAILURES, String(LOCK_MINUTES)],
    );
    if ((r?.failed_attempts ?? 0) >= MAX_FAILURES) {
      this.log.warn(`admin ${userId} locked after ${MAX_FAILURES} failures`);
      throw new ProblemException(423, 'locked', 'Account locked', `Too many failed attempts. Locked for ${LOCK_MINUTES} minutes.`, undefined, {
        'Retry-After': String(LOCK_MINUTES * 60),
      });
    }
  }

  /** Step one. Same 401 for unknown email and wrong password; 423 only when the account is locked. */
  async login(email: string, password: string) {
    const row = await this.load(email);
    if (!row || !row.is_admin) {
      // Burn the same time as a real check so timing does not reveal the email.
      await verifyPassword(password, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      throw ProblemException.unauthorized('Email or password is not right');
    }
    const lock = this.lockedFor(row);
    if (lock > 0) throw new ProblemException(423, 'locked', 'Account locked', `Too many failed attempts. Try again in ${Math.ceil(lock / 60)} minutes.`, undefined, { 'Retry-After': String(lock) });
    if (!(await verifyPassword(password, row.password_hash))) {
      await this.fail(row.user_id);
      throw ProblemException.unauthorized('Email or password is not right');
    }

    let totp_setup: { secret: string; otpauth_url: string } | null = null;
    let secret = row.totp_secret;
    if (!row.totp_confirmed_at) {
      // First sign-in (or a reset): issue a secret to enrol; the first valid code confirms it.
      secret = newTotpSecret();
      await this.db.query(`update admin_credentials set totp_secret = $2, updated_at = now() where user_id = $1`, [row.user_id, secret]);
      totp_setup = { secret, otpauth_url: otpauthUrl(ISSUER, row.email, secret) };
    }
    const step_token = await this.jwt.signAsync({ sub: row.user_id, purpose: 'admin-mfa', jti: randomUUID() }, { expiresIn: STEP_TTL_SECONDS });
    return { step_token, expires_in_seconds: STEP_TTL_SECONDS, totp_setup };
  }

  /** Step two. A valid code on an unconfirmed secret confirms enrolment. */
  async totp(stepToken: string, code: string): Promise<TokenPair> {
    let claims: { sub: string; purpose?: string };
    try {
      claims = await this.jwt.verifyAsync(stepToken);
    } catch {
      throw ProblemException.unauthorized('Sign-in step expired. Start again.');
    }
    if (claims.purpose !== 'admin-mfa') throw ProblemException.unauthorized('Not a sign-in step token');
    const row = await this.db.one<CredRow>(`select ${CRED_COLS}, true as is_admin from admin_credentials c where c.user_id = $1`, [claims.sub]);
    if (!row?.totp_secret) throw ProblemException.unauthorized('Start the sign-in again');
    const lock = this.lockedFor(row);
    if (lock > 0) throw new ProblemException(423, 'locked', 'Account locked', `Too many failed attempts. Try again in ${Math.ceil(lock / 60)} minutes.`, undefined, { 'Retry-After': String(lock) });
    if (!totpMatches(row.totp_secret, code)) {
      await this.fail(row.user_id);
      throw ProblemException.unauthorized('That code is not right');
    }
    await this.db.query(
      `update admin_credentials set failed_attempts = 0, locked_until = null, last_login_at = now(),
              totp_confirmed_at = coalesce(totp_confirmed_at, now()), updated_at = now() where user_id = $1`,
      [row.user_id],
    );
    const user = await this.users.byId(row.user_id);
    return this.auth.issueForUser(user, 'web-console');
  }

  async changePassword(userId: string, current: string, next: string) {
    const row = await this.db.one<{ password_hash: string }>(`select password_hash from admin_credentials where user_id = $1`, [userId]);
    if (!row) throw ProblemException.forbidden('No console credentials on this account');
    if (!(await verifyPassword(current, row.password_hash))) throw ProblemException.unauthorized('Current password is not right');
    await this.db.query(`update admin_credentials set password_hash = $2, updated_at = now() where user_id = $1`, [userId, await hashPassword(next)]);
    await this.auth.logout(userId); // every other session must sign in again
  }

  /** Used by the create-admin script and by a national admin later. */
  async createAdmin(opts: { phone: string; email: string; fullName: string; password: string; createdBy?: string }) {
    const email = opts.email.trim().toLowerCase();
    return this.db.tx(async (q) => {
      const { user } = await this.users.findOrCreateByPhone(opts.phone, q);
      await q.query(`update users set full_name = $2, verification = 'verified', verified_at = coalesce(verified_at, now()) where id = $1`, [user.id, opts.fullName]);
      await q.query(`insert into user_roles (user_id, role) values ($1, 'admin') on conflict do nothing`, [user.id]);
      await q.query(
        `insert into admin_credentials (user_id, email, password_hash, created_by) values ($1, $2, $3, $4)
         on conflict (user_id) do update set email = excluded.email, password_hash = excluded.password_hash,
           totp_secret = null, totp_confirmed_at = null, failed_attempts = 0, locked_until = null, updated_at = now()`,
        [user.id, email, await hashPassword(opts.password), opts.createdBy ?? null],
      );
      return { user_id: user.id, email };
    });
  }
}
