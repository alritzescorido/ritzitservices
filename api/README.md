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

Three e2e suites, each on its own in-memory database:

- `api.e2e-spec.ts`: problem+json errors, locations, weight classes, the board falling back to reference prices with labels and ETag, OTP sign-in with wrong-code counting and lockout, per-phone rate limit, refresh rotation and family revocation, profile and roles.
- `farms.e2e-spec.ts`: farms and lots with Idempotency-Key replay and mismatch, If-Match (428, 409 with the server copy), weight class derivation, vaccinations, signed photo and document uploads with magic-byte checks, document registration, the offline sync batch with temporary ids and replay.
- `admin.e2e-spec.ts`: role guard, verification queue and case, document review and signed file view, verify and reject with the note shown to the user, reference prices with large-change flag and all-or-nothing CSV import, restricted zones, snapshot refresh, audit log.
- `admin-auth.e2e-spec.ts`: console sign-in with authenticator enrolment, no email enumeration, lockout after five failures, password change ending other sessions, step tokens rejected as sessions; scheduler jobs run and are recorded.
- `market.e2e-spec.ts`: verified-only listing and offering, board comparison and totals, offer replacement, counter chain and who may accept, deal creation with rivals rejected, deliver with weighed total, pay and confirm to settled with the on-settle snapshot, ratings, dispute to refund with audit, cancel reopening the listing, outlier review, offer expiry.

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
| `src/farms/` | Farms, lots, vaccinations with `If-Match` versions; the offline `/sync` batch with temporary ids |
| `src/market/` | Phase 2: listings with the board price alongside, offers and counter chains, deals through the SQL state machine (deliver, pay, confirm, cancel, dispute, rate), admin dispute resolution and outlier review. Settlement refreshes today's snapshot |
| `src/logistics/` | Phase 3: hauler profile, job board of accepted deals that want a hauler (restricted zones excluded), accept with capacity check, pickup checklist that gates the trip (permit, vet certificate, head count, load photo), transit pings, hand-over, withdrawal before pickup. Drives the deal through `DealsService.transition` |
| `src/storage/` | Signed upload and view URLs; local provider stores files under `UPLOAD_DIR` and checks magic bytes |
| `src/admin/` | Verification queue and decisions, document review, reference prices and CSV import, restricted zones, snapshot refresh, audit log. Every write audits itself |
| `src/common/idempotency.ts` | `Idempotency-Key` store: same key and body replays the stored response, different body is 422 |
| `src/health/` | Liveness with engine and last snapshot date |
| `test/*.e2e-spec.ts` | End-to-end suites |

## Conventions

- Every handler validates input with a zod schema through `parseOr`; body errors are 422, query and path errors are 400, both as problem+json.
- Money and weights leave the API as decimal strings, dates as `YYYY-MM-DD`, timestamps as RFC 3339 UTC (`src/common/format.ts`).
- SQL is written once and must run on both engines: no PostGIS functions outside the columns that are typed by the `geo_*` domains, cast dates and numerics to text in `select` lists when the value crosses the wire.
- Constructor injection uses explicit `@Inject(...)` tokens so the code does not depend on decorator metadata emission.

## Admin console sign-in

Staff sign in with work email, password and a 6-digit authenticator code (`/admin/auth/login`, then `/admin/auth/totp`). There is no self-registration. Create or reset an admin from a machine with database access:

```bash
npm run admin:create -- --phone +639170000001 --email a.reyes@example.ph --name "A. Reyes" --password '<at least 12 characters>'
```

The authenticator secret is issued on the first sign-in and confirmed by the first valid code. Five failed attempts lock the account for 15 minutes. No authenticator app at hand? `npm run admin:totp -- --secret <the secret shown>` prints the current code. This implements decision 5 as assumed in the wireframes; switch to phone OTP on a whitelist if staff prefer.

## Demo data

`scripts/load-sql.mjs` runs a SQL file against a local PGlite directory (stop the API first; the directory is single-process). `scripts/seed-demo.mjs` fills a running dev API with three farmers with farms, lots and a clearance, a buyer and a hauler with pending documents, nine reference prices and one restricted zone, all through the public endpoints so it exercises the same paths as the apps. `scripts/seed-demo-deals.mjs` then settles one deal and leaves one dispute open; `scripts/seed-demo-haul.mjs` registers the demo hauler's truck and hauls a third deal through the checklist, pings and hand-over. All three take the admin credentials as arguments. Development only.

## Scheduled jobs

The process with `SCHEDULER_ENABLED=true` (default) recomputes price snapshots for yesterday and today at 05:00 Asia/Manila (`SNAPSHOT_HOUR_MANILA`) and purges expired idempotency keys, OTP challenges and dead refresh tokens every hour. Every run is written to `job_runs`. Run exactly one such node, or set it to `false` everywhere and call `POST /admin/price-snapshots/refresh` from the platform's cron.

## Migrations

`db/schema.sql` is the source of truth for a fresh database. Databases created earlier are brought forward by the numbered files in `db/migrations/`, applied in order with `scripts/load-sql.mjs` (local) or `psql -f` (staging, production). A proper migration runner is still on the backlog.

## Not built yet

Deposits, disbursements and payout account verification through PayMongo (decision 3), push notifications, a real SMS provider, an S3 storage provider, location centroids for the nearest-barangay lookup, a migration runner.
