# Livestock Price Board API

NestJS 12, TypeScript, plain SQL through `pg`. Implements `docs/api/openapi.yaml`; the contract changes first, then this code.

## Run locally, no Docker needed

```bash
cd api
cp env.example .env          # edit the two secrets
npm install
npm run start:dev            # http://localhost:3000/v1
```

With the defaults in `env.example` the API runs PostgreSQL in-process (PGlite) and stores it under `api/.data/lpb`. On first start with an empty database it applies `db/schema.sql` and loads the PSGC locations from `db/seed/locations.sql` (43,778 rows, about a second).

Try it:

```bash
curl localhost:3000/v1/health
curl "localhost:3000/v1/locations/search?q=talavera"
curl "localhost:3000/v1/prices/board?municipality_code=0304930000&species=hog"
curl -X POST localhost:3000/v1/auth/otp/request -H 'content-type: application/json' -d '{"phone":"+639171234567"}'
# the code is printed in the server log (OTP_DEV_CODE fixes it to 123456 in dev)
```

Against a real PostgreSQL 15 + PostGIS, set `DATABASE_URL=postgres://...` and apply `db/schema.sql` yourself (a migration tool is a Phase 1 task; until then the schema file is the migration).

## Tests

```bash
npm run test:e2e   # whole API against an in-memory PostgreSQL, ~2 s
npx tsc --noEmit   # type check
npm run lint
```

The e2e suite covers: problem+json errors, locations (tree, search, path), weight classes, the price board falling back to reference prices with labels and ETag, OTP sign-in with wrong-code counting, lockout after five, per-phone rate limit, refresh rotation and family revocation, profile and role changes.

## Layout

| Path | What |
|---|---|
| `src/config.ts` | Every environment variable, validated with zod at boot |
| `src/db/` | `DbService`: one `query`/`tx`/`exec` interface over pg (production) and PGlite (local, tests) |
| `src/common/problem.ts` | RFC 9457 problem details: `ProblemException`, global filter, `parseOr` for zod validation |
| `src/auth/` | OTP request and verify, JWT access tokens (15 min), rotating refresh tokens, `@Public` and `@Roles` guards, SMS provider interface |
| `src/users/` | `/me`, `/me/roles`, user serialisation with masked phone |
| `src/locations/` | PSGC tree, search with display path |
| `src/prices/` | Weight classes, board, running price, history. Reads `running_price()` and `price_snapshots` only, never raw deals |
| `src/health/` | Liveness with engine and last snapshot date |
| `test/api.e2e-spec.ts` | End-to-end suite |

## Conventions

- Every handler validates input with a zod schema through `parseOr`; body errors are 422, query and path errors are 400, both as problem+json.
- Money and weights leave the API as decimal strings, dates as `YYYY-MM-DD`, timestamps as RFC 3339 UTC (`src/common/format.ts`).
- SQL is written once and must run on both engines: no PostGIS functions outside the columns that are typed by the `geo_*` domains, cast dates and numerics to text in `select` lists when the value crosses the wire.
- Constructor injection uses explicit `@Inject(...)` tokens so the code does not depend on decorator metadata emission.

## Not built yet (Phase 1 backlog)

Farms and lots with `If-Match`, document uploads, the offline `/sync` batch, admin verification and reference price endpoints, admin sign-in (decision 5), nightly snapshot job, push notifications, a real SMS provider.
