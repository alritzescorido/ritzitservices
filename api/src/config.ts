import { z } from 'zod';

// Every environment variable the API reads, validated once at boot.
// A missing or malformed value stops the process with a readable message
// instead of a crash three requests later.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // postgres://user:pass@host:5432/db  |  pglite://memory  |  pglite://./.data/lpb
  DATABASE_URL: z.string().min(1).default('pglite://./.data/lpb'),
  // When true and the schema is missing, apply db/schema.sql (and the PSGC seed
  // if present). Meant for local PGlite and CI, never for production.
  DB_AUTO_SCHEMA: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SCHEMA_PATH: z.string().default('../db/schema.sql'),
  SEED_LOCATIONS_PATH: z.string().default('../db/seed/locations.sql'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  OTP_PEPPER: z.string().min(16, 'OTP_PEPPER must be at least 16 characters'),
  OTP_TTL_SECONDS: z.coerce.number().int().default(300),
  OTP_RESEND_AFTER_SECONDS: z.coerce.number().int().default(60),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().default(5),
  OTP_PER_PHONE_PER_10_MIN: z.coerce.number().int().default(3),
  OTP_PER_IP_PER_HOUR: z.coerce.number().int().default(10),
  // console: print the code to the server log. Fixed code makes tests deterministic.
  SMS_PROVIDER: z.enum(['console']).default('console'),
  OTP_DEV_CODE: z.string().regex(/^[0-9]{6}$/).optional(),
  PUBLIC_BOARD: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.DATABASE_URL.startsWith('pglite://')) {
    throw new Error('DATABASE_URL must point at PostgreSQL in production');
  }
  return parsed.data;
}

export const CONFIG = Symbol('CONFIG');
