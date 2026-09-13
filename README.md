# Livestock Price Board

Mobile-first marketplace where a farmer sees today's running livestock price per kilo liveweight in their own municipality or province, keeps farm and herd records, and sells to verified buyers with a hauler booked in the same flow.

Working name. Target market: Philippines, pilot in two provinces.

## Documents

- **Proposal, diagrams and 26-week plan:** https://claude.ai/code/artifact/4f458d9c-8c5a-4274-a677-805b48c981eb
- **Development blueprint (phases, work, gates):** https://claude.ai/code/artifact/6b918034-f60b-416b-a1e7-0126f130e58a — mirrors `docs/development-plan.md`
- **Wireframes, all roles (sign-in and registration, farmer, buyer, hauler, admin console):** https://claude.ai/code/artifact/11b0b14f-8124-4e72-8cdf-1993f6c970d5 — one page per role in the canvas
- `docs/development-plan.md` — the phase-by-phase blueprint: goal, six measures, ways of working, per-phase work by workstream, exit gates, decisions with owners and due dates.
- `docs/payments-paymongo.md` — payment model proposal: booking deposit through PayMongo with balance paid direct, what PayMongo can and cannot do (verified Sep 2026), BSP registration question, Phase 2 path.
- `docs/phase0-field-validation.md` — assumptions under test, interview guides, deliverables for the 2-week discovery phase.
- `docs/api/openapi.yaml` — Phase 1 API contract (OpenAPI 3.1): OTP auth, farms, lots, price board, offline sync batch, admin verification and reference prices. Stack-agnostic.
- `docs/wireframes/` — source for the 22 wireframe screens (8 sign-in and registration incl. admin login, 4 farmer, 3 buyer, 3 hauler, 4 admin), one `.dc.html` per screen, plus `canvas.json` for the layout and `livestock-price-board-wireframes.html`, the assembled canvas.
- `db/schema.sql` — PostgreSQL + PostGIS schema: identity and auth, PSGC locations, farms and lots, listings, offers, deals with state-machine trigger, shipments, disputes, price snapshots, and the `running_price()` fallback ladder.
- `db/tests/` — SQL scenario tests for the deal state machine and price engine. `npm run db:test` runs them in-process (PGlite); `db/tests/run.sh` runs them against PostGIS.
- `db/seed/` — PSGC location seed generator and reference price CSV importer: `npm run db:seed:psgc`, `npm run db:seed:check`, `npm run db:seed:reference-prices`.
- `api/` — NestJS API. `api/README.md` explains how to run it locally with no Docker.
- `.github/workflows/ci.yml` — contract lint, SQL tests on PGlite and on PostGIS, API type check and e2e.

## Users

| Role | Does |
|---|---|
| Farmer | Registers farm and herd, reads the price board, lists stock, accepts offers, confirms payment |
| Buyer | Browses listings, makes offers, pays, confirms delivery and weight |
| Logistics | Accepts haul jobs, checks permits at pickup, updates transit status |
| Admin | Verifies accounts, sets reference prices, resolves disputes, reads reports |

## Status

Phase 0 engineering started 13 Sep 2026. Wireframes for all roles approved. SQL scenario tests run green (in-process PostgreSQL, no Docker needed), the PSGC location seed is generated (43,778 rows), CI is defined, and the API implements the Phase 1 contract: OTP sign-in, profile and roles, farms and lots with offline sync, uploads and documents, locations, price board, and the admin endpoints (verification, reference prices, restricted zones, audit), with 23 end-to-end tests. Still open in the API: admin sign-in method and the nightly scheduler. API stack is NestJS, assumed on 13 Sep 2026 because Node is the tooling on hand; confirm or reverse before week 3. Flutter for mobile and React for admin web as proposed.

## Decisions still open

1. Pilot provinces and lead species.
2. Backend stack: NestJS or Laravel.
3. Payments off-platform for pilot, or a provider from Phase 2. Proposal on the table: buyer pays a 10% booking deposit (₱2,000 to ₱20,000) through PayMongo, balance direct; see `docs/payments-paymongo.md`.
4. Public price board without login (the API contract assumes public with rate limits; one line flips it).
