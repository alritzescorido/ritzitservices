# Phase 0 — Field Validation Checklist

**Duration:** 2 weeks
**Goal:** Confirm or kill the assumptions the product is built on before Phase 1 starts. Every item has a pass condition. An item that fails changes the plan, it does not get argued away.

Proposal page: https://claude.ai/code/artifact/4f458d9c-8c5a-4274-a677-805b48c981eb

---

## 1. Sites and people

| Target | Minimum | Notes |
|---|---|---|
| Livestock auction markets or trading posts | 2 | One in each candidate pilot province. Observe a full market day, opening to close. |
| Farms | 6 | Mix: 2 backyard hog raisers, 1 commercial hog farm, 1 cattle raiser, 1 goat raiser, 1 cooperative. |
| Buyers / traders | 4 | 2 traders, 1 slaughterhouse or meat shop, 1 institutional buyer. |
| Haulers | 3 | At least one who moves stock across a province boundary. |
| Provincial or municipal veterinarian office | 2 | One per candidate province. |
| Municipal agriculture office | 2 | Onboarding channel check. |
| Cooperative officers | 2 | Onboarding channel check. |

## 2. Assumptions under test

Each row: what we believe, how we check it, what counts as pass.

### Pricing

| # | Assumption | How to check | Pass condition | If it fails |
|---|---|---|---|---|
| P1 | Hogs and cattle are priced per kg liveweight | Ask 6 farmers and 4 buyers how their last sale was priced. Watch 10 sales at market. | 8 of 10 observed sales use per-kg | Default unit per species changes in `weight_classes`. |
| P2 | Goats and native chicken are priced per head | Same | 8 of 10 | Same |
| P3 | Farmers already know a "going price" and it is per municipality or nearby market | Ask: "What is the price today, and how do you know?" | Farmers name a price and a source | If the reference is a specific market not a municipality, the board's location level must include markets. |
| P4 | Price per kg differs meaningfully by weight band | Collect 20 recent sale prices with weights | Spread between bands exceeds 5 percent | Simplify to one class per species. |
| P5 | A 7-day window is short enough to be "current" and long enough to have data | Count sales per municipality per week at the two markets | Median municipality has 5 or more sales per week | Widen default window or lower the municipality threshold in `min_sample_for_level()`. |
| P6 | PSA farmgate series is usable as a reference floor | Compare PSA provincial figure to observed market prices | Within 15 percent | Reference prices come from weekly trader survey instead. |

### Farmer records

| # | Assumption | How to check | Pass condition | If it fails |
|---|---|---|---|---|
| F1 | Farmers will keep herd records if it takes under 2 minutes per lot | Paper prototype of the lot form. Time 6 farmers. | 5 of 6 finish under 2 minutes | Cut fields. Head count, species, avg weight only. |
| F2 | Farmers estimate weight without a scale | Ask how they know an animal's weight | Consistent method exists (girth tape, visual, market scale) | Add a weight estimation helper to the app. |
| F3 | Farmers have an Android phone and mobile data at least weekly | Ask, and observe | 5 of 6 | Consider SMS-only price alerts as a channel. |
| F4 | Lots, not individual animals, are the unit farmers think in | Watch how they describe their stock | Farmers talk in lots | Tag-level tracking moves earlier for cattle. |

### Marketplace

| # | Assumption | How to check | Pass condition | If it fails |
|---|---|---|---|---|
| M1 | Buyers will make offers to farmers they have not met if the farmer is verified | Interview 4 buyers | 3 of 4 say yes with conditions we can meet | Marketplace phase needs cooperative endorsement per farmer. |
| M2 | Off-platform payment is acceptable for a pilot | Ask farmers what protects them today | Farmers name a practice we can mirror (cash at farm gate, deposit) | Payments or escrow move into Phase 2. |
| M3 | Offer and counter-offer is how deals are negotiated today | Observe at market | Bargaining observed | Fixed-price listings only. |
| M4 | 48 hours is a reasonable window to find a hauler | Ask haulers and buyers | Typical lead time 2 days or less | Extend cancellation window. |

### Logistics and compliance

| # | Assumption | How to check | Pass condition | If it fails |
|---|---|---|---|---|
| L1 | Shipping permit and veterinary health certificate are required and checked in practice | Ask vet office and 3 haulers. Ask to see a recent permit. | Documents exist and are checked at checkpoints | Adjust pickup checklist to the real document set. |
| L2 | Permit issuance is fast enough to fit inside a deal | Ask vet office for typical turnaround | Same-day or next-day | Deal timeline and cancellation window stretch. |
| L3 | Restricted zones (ASF and others) change often enough to need an admin control | Ask vet office for the last 12 months of changes | More than 2 changes | If fewer, restricted zones can be a config file, not a screen. |
| L4 | Haulers charge per head or per trip | Ask 3 haulers | Consistent | Add per-km option to `hauler_profiles`. |

### Onboarding

| # | Assumption | How to check | Pass condition | If it fails |
|---|---|---|---|---|
| O1 | Cooperatives and municipal agriculture offices will onboard farmers | Ask 2 of each what they would need | Commitment to a pilot with named contact | Direct field onboarding, budget more PM time. |
| O2 | Buyer verification by document review is enough for farmers to trust a buyer | Ask farmers what would make them trust an unknown buyer | Documents plus ratings named | Add cooperative or LGU endorsement badge. |

## 3. Data to bring back

- [ ] 20 or more recent sale records per province: species, weight or head, price, date, municipality, market or farm gate.
- [ ] Photos or copies of a shipping permit and a veterinary health certificate, with fields listed.
- [ ] Names and contacts at 2 vet offices, 2 agriculture offices, 2 cooperatives.
- [ ] Confirmed species list and weight bands for version 1.
- [ ] Confirmed pilot provinces with a one-line reason each.
- [ ] Device and connectivity notes per farmer visited.
- [ ] Filipino and regional-language terms farmers actually use for price, liveweight, lot, hauler.

## 4. Interview guide (short form)

**Farmer, 20 minutes**
1. Tell me about your last sale. Who bought, how was the price set, how did they pay, who moved the animals.
2. What is the price today for your animals. How do you know.
3. Show me how you keep track of your animals now.
4. Show me your phone. Which apps do you use every week.
5. What would make you trust a buyer you have never met.

**Buyer, 20 minutes**
1. How do you find stock today. How far do you travel.
2. How do you decide what to offer.
3. What has gone wrong on a purchase. Weight, health, no-show.
4. Would you buy from a farmer in the app if they were verified. What would verified need to mean.

**Hauler, 15 minutes**
1. Walk me through a trip: booking, documents, checkpoints, delivery.
2. How do you charge.
3. What paperwork do you carry. Who checks it.
4. How much notice do you need.

**Veterinarian office, 20 minutes**
1. What documents are required to move livestock within and out of the province.
2. How long does issuance take, what does it cost.
3. Which areas are restricted right now, and how does that change.
4. Would the office accept permit numbers recorded in an app as a reference.

## 5. Deliverables at end of week 2

1. Assumption table above filled in with pass or fail and evidence.
2. Revised `db/schema.sql` seed for `weight_classes` and default units.
3. Confirmed pilot provinces and lead species.
4. Reference price seed for those provinces.
5. Go or no-go for Phase 1 as planned, with any changes to the 26-week plan listed.
