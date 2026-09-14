# Livestock Price Board: Development Blueprint

Version 1, 13 Sep 2026. This is the plan we follow phase by phase. Each phase has one goal, the work that gets us there, and a gate we must pass before the next phase starts. When reality disagrees with the plan, we change the plan here, with a date, not in chat.

Companion documents: proposal page (26-week plan, diagrams), `docs/wireframes/` (22 screens, all roles), `docs/api/openapi.yaml` (Phase 1 contract), `db/schema.sql`, `docs/phase0-field-validation.md`, `docs/payments-paymongo.md`.

---

## The goal

**A farmer in a pilot municipality opens the app and sees today's fair price per kilo liveweight for their animals, then sells to a verified buyer with a hauler booked and a deposit protecting them, and that settled sale becomes tomorrow's price for their neighbours.**

Everything in this plan serves that loop. If a task does not move a farmer closer to seeing a price, closing a deal, or trusting the other side, it waits.

### How we will know it worked (pilot review, week 26)

| Measure | Target | Why this number |
|---|---|---|
| Weekly active farmers per province | 60 of 100 onboarded | Below half means the board is not useful enough to return to |
| Municipalities with a live price (5+ settled deals in 7 days) | 6 of the pilot municipalities | Proves the engine can replace reference prices somewhere |
| Listings that settle | 40% | Marketplace leakage above 60% means the deposit and hauler hooks are not holding |
| Median time from accepted to settled | Under 5 days | Slower than that and farmers go back to the viajero at the gate |
| Dispute rate on settled deals | Under 5% | Evidence trail (checklist, photos, deposit) is doing its job |
| Buyer no-shows after deposit | Under 3% | The deposit is the farmer's assurance; this is its report card |

---

## How we work, every phase

- **One goal per phase, one gate per phase.** The gate is a demo to real users plus the exit criteria below. No gate, no next phase. Slipping a phase is allowed; skipping a gate is not.
- **Six workstreams, one backlog.** Backend, Mobile, Admin web, Design, Data and DevOps, Product and Field. Legal and payments sits with Product until Phase 2, then gets its own column.
- **Two-week sprints, weekly release to staging, demo every second Friday** with at least one farmer, buyer or hauler on the call or in the room.
- **Definition of done** for any feature: API in the contract, schema migration with a test, mobile or web screen matched to its wireframe, Filipino and English strings, offline behaviour stated, analytics event named, and one scenario test on the state it touches.
- **Contract first.** The OpenAPI file changes before the code does. Mobile builds against the contract, not the running server.
- **Every number shown to a user carries its sample size and location level.** No exceptions, no "clean" design without the label.
- **Decisions have owners and due dates** (section at the end). A decision past due blocks the phase gate.

---

## Timeline

| Phase | Weeks | Goal in one line | Gate |
|---|---|---|---|
| 0 Discovery | 1–2 | Confirm or kill the assumptions, choose provinces and stack | Field report signed off, four decisions made |
| 1 Foundation | 3–8 | Farmers see a price and keep their herd on the phone | Farmer beta: 30 farmers, 2 municipalities, reference prices |
| 2 Marketplace | 9–14 | First deal settled end to end with a deposit | 10 real deals settled, deposit flow live or consciously deferred |
| 3 Logistics | 15–18 | Hauler booked inside the deal, evidence captured at pickup | 10 deals hauled through the app with complete checklists |
| 4 Price engine and reporting | 19–22 | Live medians replace reference prices where data exists | 2 municipalities on live prices, admin reports in use |
| 5 Pilot and hardening | 23–26 | Two provinces live with numbers to decide on | Go/no-go with the measures above |
| 6 After the pilot | 27+ | Money held by PayMongo, more provinces, more languages | Decided at go/no-go |

If Phase 0 starts on Monday 21 Sep 2026, the farmer beta lands mid November, the first live deal in early January 2027, and the pilot review in the week of 15 March 2027. Holidays in late December cost about one week; the schedule above absorbs it in Phase 3.

---

## What already exists (start of Phase 0)

Done and reviewed once: proposal with diagrams, 22 wireframes for all roles including sign-in and registration, Phase 1 API contract with 45 operations, PostgreSQL schema v0.2 with the deal state machine trigger and the running-price fallback function, SQL scenario tests (written, never run), Phase 0 field checklist, PayMongo payment model proposal.

Not done at the start: nothing executed against a database, no application code, no PSGC seed, no admin auth in the contract, no deposit objects, no design review. Update 13 Sep 2026: SQL tests green, PSGC seed loaded, CI defined, wireframes approved by the owner, and the API covers the whole Phase 1 contract except admin sign-in and the nightly scheduler (see `api/README.md`).

---

## Phase 0 · Discovery and field validation · weeks 1–2

**Goal:** Know, from farmers and traders in the two candidate provinces, that the product's assumptions hold, and leave the phase with the four open decisions made.

**Why first:** Every later phase builds on the unit of price, the species list and the permit process. Two weeks in the field is cheaper than six weeks of rework.

### Recommended work

Product and Field
- Run `docs/phase0-field-validation.md` in full: 2 markets, 6 farms, 4 buyers, 3 haulers, 2 vet offices, 2 agriculture offices, 2 cooperatives. Bring back 20 sale records per province.
- Test the wireframes on paper with 6 farmers and 3 traders. Note every label they misread.
- Add three questions for the payment model: what deposit size feels normal, who pays the hauler, how they pay each other today.
- Choose the two pilot provinces and the lead species. Write one paragraph per province on why.

Design
- Design review of the 22 wireframes with the field notes in hand. Log changes, do not redraw yet.
- Draw the three payment screens that the deposit model needs: buyer pays deposit, deposit line on the farmer's deal, farmer payout account.

Backend and Data
- Decide NestJS or Laravel by who can be hired in the next four weeks. Write the decision down.
- Run the SQL tests for the first time and fix what breaks. Done 13 Sep 2026 in-process on PGlite: three defects fixed, all green. The PostGIS run happens in CI.
- Load the PSGC location tree into `locations` (seed generator done 13 Sep 2026, 43,778 rows) and the PSA farmgate series into `reference_prices` for the two provinces (importer done; data waits for decision 1).

Legal and payments
- Brief a lawyer on the deposit model and ask one question: does holding buyer deposits through PayMongo make us an Operator of Payment System under Circular 1049, and if so what is the path and cost. Answer due by week 6.
- Start PayMongo business verification and ask their team about Workflows access and volume pricing.

DevOps
- Repositories, CI that runs the SQL tests and lints the OpenAPI file, cloud account, staging environment skeleton.

### Exit gate
- Field report with each assumption marked pass or fail and the plan change for each fail.
- Decisions 1 (provinces and species), 2 (stack), 3 (payments: deposit model yes or no for pilot), 4 (public price board) recorded with owner and date.
- SQL tests green on a real database.
- Team hired or contracted for Phase 1: 2 backend, 2 mobile, 1 designer, 1 QA, PM, part-time DevOps.

### Watch for
- A province where fewer than 5 sales a week happen in the median municipality. The price board would sit on reference prices for months there; pick another province.
- Farmers who price per head for hogs. The unit per species is a schema default, change it now not later.

---

## Phase 1 · Foundation · weeks 3–8

**Goal:** A farmer signs in with their phone, registers a farm and herd that work offline, and reads today's price with its sample size, fed by admin reference prices. Admins verify accounts and set prices from the console.

**Why now:** The board is useful before a single deal exists. Farmers who open it weekly are the users the marketplace needs in Phase 2.

### Recommended work

Backend
- Auth: OTP request and verify, token pair and refresh, device registration, rate limits and the five-wrong-codes lock, exactly as the contract states.
- Users, roles, documents: `POST /me/roles`, pre-signed uploads, document records with review status.
- Farms and lots with versions and If-Match, vaccination log, the offline sync batch endpoint with idempotency keys.
- Price board read from `price_snapshots` through the `running_price()` ladder, reference prices as the third rung, every response carrying `source`, `count`, `location_level`.
- Admin: verification cases, approve and reject with notes, reference price CRUD with reason and audit entries. Add admin auth to the contract (email, password, authenticator code) and implement it.
- Nightly snapshot job writing reference-based rows so the board reads only from snapshots from day one.

Mobile (Flutter, Android first)
- Screens: sign in, code, profile, farmer registration, price board, my herd, lot form, Me. Match the wireframes; reuse the palette and 44px targets.
- Offline store for board and herd, sync queue, conflict message when If-Match fails.
- Filipino and English string files, language switch on the profile step.
- Crash reporting and analytics events: board opened, price viewed with level, lot saved, sync completed.

Admin web (React)
- Sign in with authenticator, verification queue with detail panel and checklist. (Built 14 Sep 2026 together with reference prices, restricted zones, audit log and account; see `web-admin/README.md`.) reference prices table with draft, reason, publish, audit log, users list.

Design
- Redraw the wireframes changed in the Phase 0 review; produce the component sheet the mobile team needs: buttons, chips, inputs, list rows, empty and error states.

Data and DevOps
- Staging and production, backups with a tested restore, dashboards for API latency, error rate, OTP delivery rate, job runs.
- SMS provider contract and fallback provider.

Product and Field
- Recruit the 30 beta farmers through the cooperatives found in Phase 0. Plan two on-site onboarding days per municipality.

Legal and payments
- Receive the legal opinion (week 6). If registration is required, start it now; the deposit flow in Phase 2 is gated on it.

### Exit gate
- 30 farmers in 2 municipalities using the beta for 2 weeks, 60% opening the board weekly.
- Verification of a real farmer done by an admin from the console within 2 working days.
- Offline edit made in the field syncs correctly when the phone reconnects, observed at least 20 times.
- Every price on screen carries sample size and level. Checked by QA on every build.

### Watch for
- OTP delivery below 95% within 60 seconds. Switch or add a provider before the beta grows.
- Farmers who never add a lot. The herd form is either too long or not valued; fix before Phase 2 depends on lots.

---

## Phase 2 · Marketplace · weeks 9–14

**Goal:** A verified buyer makes an offer on a real lot, the farmer accepts, the buyer pays a deposit, and the deal settles with both sides confirming. First real money, first real evidence.

**Why now:** The board exists, the farmers exist. The marketplace is what makes the board self-feeding.

### Recommended work

Backend
- Listings from lots with the running price snapshot at listing time; offers and counters with expiry; deal state machine as in the schema, with `accepted_unpaid` and `booked` added for the deposit. (Listings, offers, deals, disputes and ratings built 14 Sep 2026 without the deposit states, which wait for decision 3.)
- Deposits: `deposits` table and API, PayMongo Checkout Session creation, webhook endpoint with signature check and idempotency, internal ledger rows, daily reconciliation job against PayMongo payouts and transfers.
- Notifications: push and SMS on offer, counter, accept, deposit paid, delivery, settle. SMS is the fallback for every state change.
- Delivery confirmation with head count and weighed total, tolerance rule (3% to start), settlement by both sides, payment method and reference recorded.
- Dispute case creation and admin dispute endpoints, deal freeze while disputed.
- Ratings, one per side per deal.

Mobile
- Buyer role: registration, pending state, listings with filters, offer screen, offers list, receive and pay screen with deposit line, deals list.
- Farmer: post listing, incoming offers with accept and counter, deal status with deposit shown, payout account on Me.
- Deposit payment through the PayMongo hosted checkout inside a web view, return handling, "waiting for deposit" state.

Admin web
- Disputes list and detail with evidence, resolution options including where the deposit goes, strikes on accounts.
- Deposit ledger view: held, released, refunded, forfeited, with reconciliation status.

Design
- Buyer flow polish from Phase 0 review; empty states for "no listings near you"; dispute form for both roles.

Data and DevOps
- PayMongo test and live keys in the secrets store, webhook monitoring and replay, alert when the wallet float drops below one week of deposits.

Product and Field
- Recruit 15 buyers per province, verify them before the gate week. Sit with the first 10 deals in person.

Legal and payments
- Deposit flow goes live only when the legal opinion allows it. If registration is pending, ship the marketplace with deposits behind a feature flag and record deposits by reference instead, exactly as the wireframes show today.

### Exit gate
- 10 deals settled end to end by real users, at least 5 with a deposit if the flag is on.
- Ledger reconciles to the peso against PayMongo for 14 consecutive days.
- No deal reaches settled without both confirmations; verified by the state machine tests.
- Dispute opened and resolved from the console at least once, on a real or staged deal.

### Watch for
- Deals that go "accepted" and then silent. Measure time to deposit and time to pickup weekly; shrink the 2-hour window or change the deposit size while the numbers are small.
- Buyers unable to pay the deposit by GCash because of their own wallet limits. Offer QR Ph and online banking in the same checkout.

---

## Phase 3 · Logistics · weeks 15–18

**Goal:** The hauler is booked inside the deal, the pickup checklist is the evidence base for disputes, and the farmer is paid the deposit automatically when the deal settles.

**Why now:** Hauling is the strongest reason to finish the deal in the app rather than at the gate, and the checklist is what makes disputes decidable.

### Recommended work

Backend
- Hauler profiles and vehicles, job publication on `booked`, accept with capacity check, pickup checklist records with photos, transit pings, delivered event feeding the buyer's receive screen.
- Disbursements: on `settled`, transfer the deposit net of fee to the farmer's payout account through the PayMongo transfers API; on buyer no-show past the window, forfeit to farmer; on farmer cancel, refund. Every movement writes a ledger row and a notification.
- Payout account verification by ₱1 test transfer, name match against the ID on file.
- Restricted zones table and admin control, checked at job publication.

Mobile
- Hauler app: registration, pending state, jobs, pickup checklist with offline photo queue, in transit with location sharing, history, Me with vehicle.
- Farmer and buyer deal screens show hauler status and pings.

Admin web
- Hauler verification path (OR/CR, plate match), restricted zones editor, shipment view inside a deal.

Design
- Hauler flow review with 3 haulers on the road, not in a room.

Data and DevOps
- Photo storage lifecycle (deletion 90 days after a decision), location ping retention, battery and data usage measured on a low-end Android.

Product and Field
- Recruit 10 haulers per province. Confirm the permit names and checkpoints from the vet office are still current.

### Exit gate
- 10 deals hauled through the app with all four checklist items completed before the trip started.
- A deposit released to a farmer's GCash or bank by API within 24 hours of settlement, at least 5 times.
- A deposit forfeited and a deposit refunded, each at least once, with the right notifications sent.

### Watch for
- Checklists completed after the truck has left. Enforce "Start trip" on completion; if haulers route around it, the checklist is too long.
- InstaPay failures on payout. Retry with PESONet next banking day and tell the farmer.

---

## Phase 4 · Price engine on real deals and reporting · weeks 19–22

**Goal:** Where there is enough trade, the board shows the median of real settled deals, honestly labelled, and admins can see the health of the whole system.

**Why now:** By week 19 there are weeks of settled deals to compute from, and the reference-price rung has been in place since Phase 1 so the switch is invisible.

### Recommended work

Backend and Data
- Snapshot job on settle and nightly: median, count, low, high per species, weight class, municipality, province, with the 5-deal threshold and the fallback ladder.
- Outlier rule: deals more than 40% from the province median are held for admin review before they count. Disputed deals never count.
- 30-day change and percentile band on every board row.
- Reports API: volume and price by province, active users by role, time to settle, dispute rate, deposit outcomes, thin municipalities.
- Rate limit on settlements per account per week to blunt manipulation.

Admin web
- Overview page as wireframed, reports page with CSV export, outlier review queue.

Mobile
- Board shows trend and band; "based on N sales in X" copy switches between rungs; a small "how this price is made" sheet.

QA
- Scenario tests on the engine with seeded deals: thin municipality, single outlier, disputed deal excluded, province fallback, reference fallback. Compare to hand-computed medians.

Product and Field
- Show farmers the first live price in their municipality in person. Ask whether they believe it and why.

### Exit gate
- 2 municipalities showing live medians for 2 consecutive weeks.
- Engine output matches hand calculation on 20 sampled rows.
- Admin overview used weekly by the province admin without help.

### Watch for
- A live median that farmers reject as too low. Check for a cluster of one buyer's deals; if found, the rate limit and outlier rule need tightening before Phase 5.

---

## Phase 5 · Pilot and hardening · weeks 23–26

**Goal:** Two provinces live with 100 farmers, 15 buyers and 10 haulers each, weekly releases, and a go/no-go decision made on the measures at the top of this document.

### Recommended work

Product and Field
- Onboarding days with cooperatives and municipal agriculture offices, target 100 farmers per province by week 24.
- Weekly pilot review: the six measures, top three complaints, top three bugs.

Engineering, all streams
- Weekly release train, bug triage daily, performance on low-end Android (cold start under 3 seconds, board under 1 second on 3G).
- Load test the board and the sync batch at 10x pilot volume. Penetration test on auth, documents and the webhook endpoint. Fix criticals before week 26.
- Runbooks: OTP outage, PayMongo webhook outage, wallet float shortfall, restore from backup.

Legal and payments
- OPS registration filed if required (deadline is one month after the first deposit). PayMongo Workflows conversation concluded with a yes, a no, or a date.

Design
- Regional language pass for the pilot provinces on the twenty most-seen strings.

### Exit gate: go/no-go
- The six measures reported for both provinces with 4 weeks of data.
- Decision recorded: roll out to more provinces, extend the pilot, or stop. With reasons.

---

## Phase 6 · After the pilot · week 27 onward

Only planned in outline; the go/no-go shapes it.

- **Money held by PayMongo, not us:** child accounts for verified farmers with a TIN, Workflows releasing deposits on our `settled` and `cancelled` events, optional full prepayment for buyers on online banking.
- **Rollout:** next two provinces using the same onboarding playbook, national admin role and province switcher already wireframed.
- **Product:** tag-level tracking for cattle, weight estimation helper if Phase 0 found no common method, SMS-only price alerts for farmers without data.
- **Platform:** iOS release, automated document checks in verification, public price board decision revisited with scraping data in hand.

---

## Decisions and owners

| # | Decision | Owner | Due | Status |
|---|---|---|---|---|
| 1 | Pilot provinces and lead species | Product | End of week 2 | Open |
| 2 | Backend stack: NestJS or Laravel | Tech lead | End of week 1 | Assumed NestJS on 13 Sep 2026 (Node tooling on hand, first contract slice built). Reverse before week 3 if hiring says Laravel |
| 3 | Deposit model for the pilot: yes, behind a flag, or no | Product with counsel | Week 6 | Proposed in `docs/payments-paymongo.md` |
| 4 | Public price board without login | Product | End of week 2 | Open, API assumes public |
| 5 | Admin sign-in method (email plus authenticator, or phone OTP on a whitelist) | Tech lead | Week 3 | Built as email, password and authenticator on 13 Sep 2026; confirm or switch before the console UI starts |
| 6 | Deposit size and cap, grace windows | Product from field data | Week 2, revisit week 14 | Proposed 10%, ₱2,000 to ₱20,000, 2 hours |
| 7 | Weight tolerance before dispute | Product with vet office | Week 2 | Proposed 3% |
| 8 | Who pays the hauler and the deposit fee | Product | Week 6 | Proposed: buyer pays hauler direct, platform absorbs deposit fee |

---

## Risks carried through every phase

- **Thin data.** Reference prices will be most of the board for months. Label them honestly and use the thin-municipality list to steer field visits.
- **Manipulation.** Verified accounts only, outlier hold, settlement rate limits, admin review. Revisit after the first live median.
- **Leakage off-platform.** Deposit, hauler booking and ratings are the hooks. Measure listings that settle every week from Phase 2.
- **Regulatory.** Holding deposits may make us an OPS. Counsel by week 6, registration budgeted (₱5M capital, ₱25,000 to ₱60,000 fee), feature flag ready.
- **Connectivity and devices.** Offline first for board and herd, SMS for every critical notice, low-end Android in every test plan.
- **Animal movement rules.** Restricted zones editable by admin, checklist wording confirmed with the vet office each phase.
- **Team.** One fewer engineer per side stretches the plan to about 34 weeks. Decide staffing in Phase 0, not later.
