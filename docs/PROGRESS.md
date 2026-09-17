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

## 2026-09-15 (later still): the platform can now earn

Nothing in the system charged anyone. Every peso that entered was released in full and the gateway fee was absorbed, so each deal cost money to process. A commission mechanism now exists, committed behind `COMMISSION_PERCENT` with a default of zero, so switching it on is a business decision rather than a deployment.

The rules the code enforces, and the tests that pin them:

- One charge to the buyer, two parts. The booking is the farmer's assurance; the commission sits on top and can never reduce the farmer's share. Every farmer-facing figure in all three apps now shows the booking, not the charge.
- Commission is earned on settlement only. A buyer who walks away forfeits the whole charge to the farmer and the platform takes nothing. A farmer who cancels means the buyer is refunded in full, commission included.
- The gateway fee and the transfer fee are the platform's to absorb. Previously the farmer absorbed the gateway fee, which broke the promise made to them at booking; that is fixed, and at a zero rate the consequence is that each deal costs about ₱380 to process.
- The console shows what the wallet holds, what is owed to farmers and what commission was actually earned, so the subsidy stays visible.

Also added: `peso()` for money in SMS and event notes, because `money()` returns a bare decimal and farmer-facing messages had been reading "19044.00" with no currency at all.

Written into the blueprint as a standing principle: farmers are never charged a fee, and a change that appears to require it is wrong. The revenue table there names the three sources that are not built: hauling take rate, subscriptions, and the price dataset.

Still not decided: the rate. Phase 0 was meant to establish what traders currently take, and that sets the ceiling. Until then the flag stays at zero, and real money also waits on decision 3 and the payment operator question.

## 2026-09-16

The commission rate and the ID requirement moved out of the environment and into the console, at the owner's request. A small `platform_settings` table holds them; the environment now only supplies the value used before an admin has ever set one. Every change writes an audit row, so the audit log answers who changed the rate and when.

- **Settings screen** in the console, listing each setting with the label and help text the API supplies, so the wording cannot drift from the behaviour. The commission field shows what a 165,600 peso deal would be charged at the rate being typed, and says plainly that at zero each deal still costs about 380 pesos to process.
- **Commission** is read from settings at the moment an offer is accepted. Deals already struck keep the rate they were agreed at, which is stored on the deposit.
- **Require an ID before verification** is new. With it on, nothing changes. With it off, someone with no documents still reaches the verification queue and an admin can verify them, and both apps mark the upload as optional instead of required. The apps read it from a public endpoint before anyone signs in.

A bug the tests caught: `z.coerce.boolean()` is `Boolean(v)`, so a setting stored as the text "false" read back as true and could never be switched off. Booleans are now parsed by word.

Checks: 56 API e2e tests across 9 suites, contract lint clean, console and phone app lint, tests and build green, Flutter analyzer clean. Migrations 0005 and 0006 applied to the demo database.

## 2026-09-16 (later): the app covers all three roles

The owner opened the app on the emulator and said: "in app emulator i dont see iam farmer buyer or hauler." They were right. The Flutter app had been built farmer-only, with the role hard-coded at registration, while `web-app/` had covered all three since Phase 3. Anyone who was not a farmer had to be told to use a browser instead, which is not an answer for a hauler standing at a farm gate.

What was built, mirroring the web app screen for screen:

- **The role is chosen, not assumed.** Registration asks farmer, buyer or hauler, and the fields follow: a farm and barangay for a farmer, nothing extra for a buyer, a plate, vehicle and capacity for a hauler. The documents asked for follow the role too, and an admin can still turn the requirement off.
- **Tabs follow the person.** `tabKeysFor` merges the tab sets of whatever roles someone holds, so a farmer who also buys sees Presyo, Hayop, Ibenta, Deals, Bilhin and Ako, with Presyo and Deals not repeated. A test pins the merge.
- **Bilhin** lists what is for sale with each asking price beside the board price, and the offer sheet carries heads, a pickup day, whether a hauler is wanted and where to deliver.
- **The buyer's half of a deal**: pay the booking deposit through the GCash, Maya or QR Ph link, confirm what actually arrived (the count, and the weight when the price is per kilo, which is what sets the final figure), then record the balance paid to the farmer.
- **Trabaho** shows booked deals wanting a truck with a "fits my truck" filter, and takes one with a fee and a pickup time.
- **Biyahe** holds the checklist that gates the start of a trip: the LGU shipping permit number, the veterinary health certificate number, the head count and a photo of the load. Nothing starts without all four, on the phone and again on the server. On the road it shares a position every two minutes and can flag a checkpoint, a delay or a problem, then hands over.
- Taking on a second role later is possible under Ako, which the web app cannot do; a hauler also sets their truck there.

Checks: Flutter analyzer clean, 9 unit tests green (three new: the tab merge, the role ordering, and a shipment knowing when it is on the road), a debug APK built and installed. Every endpoint the new screens call was exercised against the running demo API as the demo buyer and the demo hauler, confirming that each field the models read is actually sent.

**What could not be checked that day, and why.** The emulator would not paint Flutter pixels: the widget and render trees were correct with real sizes, no Dart exception was thrown, and the Android launcher screenshotted fine, but the app's surface came back empty. The same blank screen reproduced on the previous commit's build, so it was the environment and not the change. The screens were therefore not seen running on 16 September. The cause was found the next day and is recorded below.

## 2026-09-17: the emulator paints debug builds white, and what that cost

The owner opened the app on the emulator and saw a white page. So did I, all of the previous day. The cause turned out to be narrow and unguessable from the symptom: **the emulator on this machine renders release and profile Flutter builds correctly and debug builds as a blank page.** Installing the release APK on the same running emulator that had just shown white brought the app up immediately.

Everything else tried was a dead end, and is listed so nobody repeats it: `-gpu host`, `auto`, `swangle`, `swiftshader`, `swiftshader_indirect`, Impeller, Skia through `--no-enable-impeller`, cold boots, moving the emulator window fully on-screen, giving it host focus, drawing into a TextureView instead of a SurfaceView, and switching on `hw.gpu.enabled` in the AVD's own `config.ini`, which had been `no`. Ordinary Android apps such as Settings rendered throughout. The tell, in hindsight, is that the app produces about seventeen frames and then stops while staying alive on the Dart VM service.

**The three roles were then verified on the emulator as a hauler.** Signed in as the demo hauler, the tab bar reads Presyo, Trabaho, Biyahe, Ako, which is the role-based merge working. Trabaho shows the hauler's own truck, "Elf truck NEB 4521, up to 20 heads", and the empty state explaining that jobs appear once a buyer has paid a deposit. Biyahe lists the delivered trip from Talavera to San Jose City with its fee. That is the work from 16 September running, not merely compiling.

To look at the app here: `flutter build apk --release --target-platform android-x64`, then `adb uninstall ph.presyonghayop.presyo` and `adb install build/app/outputs/flutter-apk/app-release.apk`. Hot reload is not available that way, so the code has to be right before the build. Debug builds remain fine for the analyzer, the tests and a real phone.

**Lesson for the plan.** The 15 September lesson said to budget device time. This adds a second: budget time for the device itself to be wrong. Two days went into a white page that was never the app. A physical Android phone would have settled it in ten minutes and should be the first thing reached for, not the last.
