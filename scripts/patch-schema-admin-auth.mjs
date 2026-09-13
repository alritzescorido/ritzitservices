// One-off: add job_runs (scheduler audit) and admin_credentials (email +
// password + authenticator sign-in for the web console) to db/schema.sql.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../db/schema.sql', import.meta.url);
let s = readFileSync(path, 'utf8');
if (s.includes('create table admin_credentials')) {
  console.log('already patched');
  process.exit(0);
}

const anchor = `create index on admin_audit_log (admin_id, created_at);\n`;
if (!s.includes(anchor)) {
  console.error('anchor not found');
  process.exit(1);
}
const addition = `${anchor}
-- Console sign-in for staff: work email, password, authenticator code.
-- Farmers, buyers and haulers never have a row here; they sign in by phone OTP.
-- Accounts are created by a national admin (api: npm run admin:create), never self-registered.
create table admin_credentials (
  user_id            uuid primary key references users(id) on delete cascade,
  email              text not null unique,           -- lower-cased work email
  password_hash      text not null,                  -- scrypt, format scrypt$N$r$p$salt$hash
  totp_secret        text,                           -- base32; null until first sign-in sets it up
  totp_confirmed_at  timestamptz,
  failed_attempts    smallint not null default 0,    -- locked at 5 for 15 minutes
  locked_until       timestamptz,
  last_login_at      timestamptz,
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Every scheduler run, so ops can see the nightly snapshot happened.
create table job_runs (
  id          bigserial primary key,
  job         text not null,                         -- 'nightly_snapshots', 'purge_expired'
  status      text not null,                         -- 'ok' | 'failed'
  detail      jsonb,
  duration_ms integer,
  ran_at      timestamptz not null default now()
);
create index on job_runs (job, ran_at desc);
`;
s = s.replace(anchor, addition);
writeFileSync(path, s);
console.log('schema.sql: admin_credentials and job_runs added');
