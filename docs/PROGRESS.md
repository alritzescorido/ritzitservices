# Progress log

Newest first. Written by the `/progress` skill or by hand at the end of a work session. The blueprint (`development-plan.md`) says what should happen; this file says what did.

## 2026-09-14

Commits since the first push: `5fde597` demo scripts, `b9f7b7a` Phase 2 backend (listings, offers, deals, disputes, ratings).

Checks: SQL tests green (PGlite and PostGIS in CI), API 32 e2e tests across 5 suites green, console builds. Correction 14 Sep 2026 (later): CI runs #1 to #5 all failed in the API job at npm ci; the four other jobs (contract lint, both SQL jobs, console) were green throughout. Recorded as green here in error.

Phase 0: engineering items done (SQL tests run and fixed, PSGC seed, CI). Field work, decisions 1, 3 and 4, and the legal brief are with the owner. Gate not passed: decisions 1, 3, 4 still open.
Phase 1: API complete for the contract; admin console covers sign-in, overview, verification, reference prices, restricted zones, audit log, account. Mobile app not started (needs a Flutter machine). Gate not passed: no farmer beta yet.
Phase 2: backend complete except deposit states (decision 3). Console has no deals or disputes screens yet.

Open decisions: 1 provinces and species (owner, due end of week 2), 3 deposit model (owner with counsel, week 6), 4 public board (owner, week 2). Decisions 2 and 5 built as assumed (NestJS; email plus authenticator).

Next: console Disputes and Deals screens; Flutter farmer app on a machine with the SDK; Phase 3 hauler endpoints.

## 2026-09-14 (later)

Commits: `5c183da` console Deals and Disputes screens and the `/progress` skill; Phase 3 logistics (this entry).

Checks: SQL tests green on PGlite, API 38 e2e tests across 6 suites green, API lint clean, contract lint 0 errors, console lint, tests and build green. CI: the API job has failed at npm ci on every run since #1; the lockfile installs cleanly on Node 24 locally and several NestJS CLI dependencies require Node ^22.22.3 or ^24.15, so CI was moved to Node 24. Run #6 for `52d2d63`: all five jobs green, the first fully green run.

Phase 3 backend built: hauler profile, job board with restricted-zone and capacity filters, accept with capacity check (deal to `hauler_assigned`), pickup checklist gating the trip (deal to `in_transit`), transit pings with kinds, hand-over record (deal stays `in_transit` until the buyer confirms), withdrawal before pickup (deal back to `accepted`, job reopens). Offers and deals carry a delivery point. Console Deals detail shows the shipment. Migration `0003_phase3_logistics.sql` for existing databases. Not built in Phase 3: deposits, disbursements and payout verification (decision 3), the hauler mobile screens (Flutter machine), photo lifecycle and ping retention jobs.

Gate: not passed. Needs 10 real deals hauled through the app and the deposit flows, which wait on decision 3.

Next: decision 3 so the PayMongo work can start; Flutter apps; Phase 4 reports.

## 2026-09-14 (deposits and Phase 4)

Checks: SQL tests green on PGlite, API 45 e2e tests across 7 suites green, API lint clean, contract lint 0 errors, console lint, tests and build green.

Decision 3 built ahead of the decision, behind `PAYMENTS_PROVIDER` (off by default): booking deposit of 10% of the estimate, 2,000 to 20,000 pesos, 2 hours to pay through a hosted checkout; the hauler job is published only once paid; released to the farmer on settlement, forfeited when the buyer cancels, refunded when the farmer cancels, decided by the admin inside a dispute; unpaid deposits lapse and the listing returns to the board. Ledger rows per movement, webhook inbox keyed by event id, farmer payout account verified by a one-peso transfer. PayMongo client written against the public API reference, not yet run against a live account; a fake gateway serves tests and the demo. Migration `0004_payments_reports.sql`.

Phase 4 backend: reports summary, deals CSV, users list, weekly settlement limit per buyer (flagged and held out of the board, not blocked). The snapshot job, outlier rule, 30-day change and band were already in place from Phases 1 and 2.

Console: Deposits, Reports (with CSV export) and Users screens; deposit line on the deal detail; deposit choice on dispute resolution.

Not built: automatic no-show forfeiture after the pickup window (admin decides through a dispute), ledger reconciliation against the wallet, photo and ping retention, mobile apps, Settings screen.

Gates: Phase 3 still needs 10 real hauled deals and real deposits; Phase 4 needs two municipalities with live medians for two weeks, which needs real trade.

Next: legal opinion on OPS registration and a PayMongo test account so the provider can be exercised for real; Flutter apps; Phase 5 pilot hardening.
