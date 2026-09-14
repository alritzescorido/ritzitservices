# Progress log

Newest first. Written by the `/progress` skill or by hand at the end of a work session. The blueprint (`development-plan.md`) says what should happen; this file says what did.

## 2026-09-14

Commits since the first push: `5fde597` demo scripts, `b9f7b7a` Phase 2 backend (listings, offers, deals, disputes, ratings).

Checks: SQL tests green (PGlite and PostGIS in CI), API 32 e2e tests across 5 suites green, console builds. CI runs #1 and #2 green; #3 for `b9f7b7a` was in progress at time of writing.

Phase 0: engineering items done (SQL tests run and fixed, PSGC seed, CI). Field work, decisions 1, 3 and 4, and the legal brief are with the owner. Gate not passed: decisions 1, 3, 4 still open.
Phase 1: API complete for the contract; admin console covers sign-in, overview, verification, reference prices, restricted zones, audit log, account. Mobile app not started (needs a Flutter machine). Gate not passed: no farmer beta yet.
Phase 2: backend complete except deposit states (decision 3). Console has no deals or disputes screens yet.

Open decisions: 1 provinces and species (owner, due end of week 2), 3 deposit model (owner with counsel, week 6), 4 public board (owner, week 2). Decisions 2 and 5 built as assumed (NestJS; email plus authenticator).

Next: console Disputes and Deals screens; Flutter farmer app on a machine with the SDK; Phase 3 hauler endpoints.

## 2026-09-14 (later)

Commits: `5c183da` console Deals and Disputes screens and the `/progress` skill; Phase 3 logistics (this entry).

Checks: SQL tests green on PGlite, API 38 e2e tests across 6 suites green, API lint clean, contract lint 0 errors, console lint, tests and build green.

Phase 3 backend built: hauler profile, job board with restricted-zone and capacity filters, accept with capacity check (deal to `hauler_assigned`), pickup checklist gating the trip (deal to `in_transit`), transit pings with kinds, hand-over record (deal stays `in_transit` until the buyer confirms), withdrawal before pickup (deal back to `accepted`, job reopens). Offers and deals carry a delivery point. Console Deals detail shows the shipment. Migration `0003_phase3_logistics.sql` for existing databases. Not built in Phase 3: deposits, disbursements and payout verification (decision 3), the hauler mobile screens (Flutter machine), photo lifecycle and ping retention jobs.

Gate: not passed. Needs 10 real deals hauled through the app and the deposit flows, which wait on decision 3.

Next: decision 3 so the PayMongo work can start; Flutter apps; Phase 4 reports.
