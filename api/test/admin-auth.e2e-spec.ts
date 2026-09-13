import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminAuthService } from '../src/admin/admin-auth.service.js';
import { totpCode } from '../src/admin/totp.js';
import { AppModule } from '../src/app.module.js';
import { DbService } from '../src/db/db.service.js';
import { SchedulerService } from '../src/jobs/scheduler.service.js';

type App = Parameters<typeof request>[0];

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'pglite://memory';
process.env.DB_AUTO_SCHEMA = 'true';
process.env.SEED_LOCATIONS_PATH = './does-not-exist.sql';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
process.env.OTP_PEPPER = 'test-pepper-test-pepper';
process.env.OTP_DEV_CODE = '123456';
process.env.SCHEDULER_ENABLED = 'false';

const EMAIL = 'a.reyes@example.ph';
const PASSWORD = 'correct horse battery staple';

describe('Admin console sign-in and scheduler jobs (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    http = app.getHttpServer();
    await app.get(AdminAuthService).createAdmin({ phone: '+639170000301', email: EMAIL, fullName: 'A. Reyes', password: PASSWORD });
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('signs in with email, password and an authenticator code enrolled on first use', async () => {
    const unknown = await request(http).post('/v1/admin/auth/login').send({ email: 'nobody@example.ph', password: PASSWORD }).expect(401);
    const wrongPw = await request(http).post('/v1/admin/auth/login').send({ email: EMAIL, password: 'not the password' }).expect(401);
    expect(unknown.body.detail).toBe(wrongPw.body.detail); // no email enumeration

    const step = await request(http).post('/v1/admin/auth/login').send({ email: EMAIL.toUpperCase(), password: PASSWORD }).expect(200);
    expect(step.body.expires_in_seconds).toBe(300);
    expect(step.body.totp_setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(step.body.totp_setup.otpauth_url).toContain('otpauth://totp/');
    const secret = step.body.totp_setup.secret as string;

    const bad = await request(http).post('/v1/admin/auth/totp').send({ step_token: step.body.step_token, code: '000000' }).expect(401);
    expect(bad.body.detail).toContain('not right');

    const ok = await request(http).post('/v1/admin/auth/totp').send({ step_token: step.body.step_token, code: totpCode(secret) }).expect(200);
    expect(ok.body.user.roles).toEqual(['admin']);
    expect(ok.body.user.full_name).toBe('A. Reyes');
    const token = ok.body.access_token as string;

    await request(http).get('/v1/admin/audit-log').set('Authorization', `Bearer ${token}`).expect(200);

    // Second sign-in: authenticator already enrolled, no setup block.
    const again = await request(http).post('/v1/admin/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
    expect(again.body.totp_setup).toBeNull();
    await request(http).post('/v1/admin/auth/totp').send({ step_token: again.body.step_token, code: totpCode(secret) }).expect(200);

    // Password change needs the current password and ends other sessions.
    await request(http)
      .post('/v1/admin/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ current_password: 'wrong', new_password: 'another long passphrase' })
      .expect(401);
    await request(http)
      .post('/v1/admin/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ current_password: PASSWORD, new_password: 'another long passphrase' })
      .expect(204);
    await request(http).post('/v1/auth/refresh').send({ refresh_token: ok.body.refresh_token }).expect(401);
    await request(http).post('/v1/admin/auth/login').send({ email: EMAIL, password: 'another long passphrase' }).expect(200);

    // A step token is not an access token.
    await request(http).get('/v1/admin/audit-log').set('Authorization', `Bearer ${again.body.step_token}`).expect(401);
  });

  it('locks the account after five failures', async () => {
    const db = app.get(DbService);
    await db.query(`update admin_credentials set failed_attempts = 0, locked_until = null`);
    for (let i = 0; i < 4; i++) await request(http).post('/v1/admin/auth/login').send({ email: EMAIL, password: 'nope nope nope' }).expect(401);
    const locked = await request(http).post('/v1/admin/auth/login').send({ email: EMAIL, password: 'nope nope nope' }).expect(423);
    expect(locked.headers['retry-after']).toBe('900');
    await request(http).post('/v1/admin/auth/login').send({ email: EMAIL, password: 'another long passphrase' }).expect(423); // right password, still locked
  });

  it('scheduler jobs run and are recorded', async () => {
    const scheduler = app.get(SchedulerService);
    const db = app.get(DbService);
    await db.query(`insert into idempotency_keys (key, user_id, request_hash, response_code, response_body, created_at)
                    select gen_random_uuid(), u.id, 'x', 200, '{}'::jsonb, now() - interval '3 days' from users u limit 1`);
    const purge = (await scheduler.runJob('purge_expired', () => scheduler.purgeExpired())) as { idempotency_keys: number };
    expect(purge.idempotency_keys).toBe(1);
    const snap = (await scheduler.runJob('nightly_snapshots', () => scheduler.refreshSnapshots())) as { today: number };
    expect(snap.today).toBe(0);
    const runs = await db.query<{ job: string; status: string }>(`select job, status from job_runs order by id`);
    expect(runs.rows.map((r) => `${r.job}:${r.status}`)).toEqual(['purge_expired:ok', 'nightly_snapshots:ok']);

    const ms = scheduler.msUntilNextSnapshot();
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});
