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

## 2026-09-15

Commit `b5c8b90`: phone web app in `web-app/` with every wireframed farmer, buyer and hauler screen, on the console's toolchain; CI job added. Checks: type check, lint (warnings only), 5 unit tests, build green. Runs on port 5178 bound to the Wi-Fi so a phone can open it; the demo API restarted with `PUBLIC_BASE_URL` on the PC's Wi-Fi address so uploads and the fake checkout work from the phone.

Toolchain for the blueprint's Flutter app installed on the development machine without installers: Flutter stable at `C:\src\flutter`, Temurin JDK 17 at `C:\src\jdk17`, Android SDK at `C:\src\android-sdk` through the command-line tools. `flutter doctor` reports Android toolchain ready pending SDK 36 and build-tools 28.0.3, which were being installed at time of writing. Commit `a53ffee`: the Flutter farmer app in `mobile/` (sign-in with an editable API address, registration, price board with offline cache, herd, listings and offers, deals, profile with payout account). flutter analyze clean, 4 tests pass, CI job added. Debug APK built (154 MB) and release APKs per architecture (arm64 18 MB, armeabi-v7a 16 MB, x86_64 20 MB). Not yet installed on a real phone.

Also on 2026-09-14 (late): `/modernize` skill added (`513a67b`); CI runs #6 and #7 fully green.

Next: Flutter farmer app once `flutter doctor` is clean; sideload a debug APK to an Android phone; decision 3 and a PayMongo test account.

## 2026-09-15 (later): the app run on a device for the first time

An Android 15 emulator was set up on the development machine (Android Studio was installed but had no SDK or virtual device; the command-line SDK at `C:\src\android-sdk` supplies both). The farmer app was installed and driven end to end through adb.

Four defects surfaced that no type check or unit test had caught, all fixed and committed:

1. `crypto.randomUUID` is secure-context only, so on a phone loading the web app over plain HTTP every write carrying an Idempotency-Key threw. Both web apps now derive the id from `crypto.getRandomValues`. The Flutter client had the sibling fault: ids derived from the clock, so two writes in one microsecond shared a key and the second got the first one's response.
2. Buttons whose enabled state read a `TextEditingController` never re-enabled, because the fields had no `onChanged`. Sign-in's "Send code" and registration's "Finish" were both dead on a real device.
3. The barangay picker searched municipalities while its label said "Barangay", so typing Poblacion found nothing. It now asks for the town first, then lists that town's barangays.
4. `GET /locations?parent=` returns bare rows with no display_name or path, so a chosen barangay rendered as an empty line. Children are now named and placed under the chosen town.

Verified working on the emulator: sign in by OTP, price board for Talavera with every row carrying its source, Hayop with the farm and both lots, Ibenta with two matched listings against the board price, Deals with the settled deal and the open dispute in Filipino, the deal detail with agreed versus delivered figures and the timeline, Ako with verification, documents, payout prompt and language.

Also: South Cotabato given placeholder reference prices through the new `api/scripts/seed-reference-prices.mjs`; those figures are not PSA data and say so where farmers read them.

Lesson for the plan: everything above was invisible to `tsc`, `flutter analyze`, 46 API tests and a green CI. The gap was that nothing ran the app. Phase 5 should budget device time from the start, not at the end.
