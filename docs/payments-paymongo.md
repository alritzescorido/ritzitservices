# Payments with PayMongo: a booking deposit that protects the farmer

Status: proposal, 12 Sep 2026. Answers open decision 3 (payments off-platform vs integrated) with a middle path for the pilot. Facts below were checked against PayMongo's public docs and pricing on 12 Sep 2026; they change, so re-check before contracts.

## 1. The problem to solve

A farmer accepts an offer, turns away other buyers, and books a hauler. If the buyer never shows, the farmer has lost days and sometimes the hauler fee. The farmer needs the buyer to have money at risk from the moment of acceptance. The buyer, in turn, needs that money back if the animals are not as declared.

## 2. What PayMongo can and cannot do for us (verified)

| Capability | What the docs say | What it means for us |
|---|---|---|
| Accept GCash, Maya, GrabPay, QR Ph, cards, online banking | Fees: GCash 2.23%, Maya 1.79%, QR Ph 1.34%, domestic cards 3.125% + ₱13.39, direct online banking 0.71% or ₱13.39 | The cheap rails buyers already use are all there. |
| Hold then capture (pre-authorise, charge later) | "Available for Visa and Mastercard only." Hold lasts up to 7 days, partial capture allowed | Useless for our buyers. Viajeros pay by GCash and cash, not by card. No hold for e-wallets. |
| Refunds | GCash and other wallets refund "within 24 hours"; QR Ph real time under ₱50,000; cards up to 30 days. A refund fails if the upcoming payout balance cannot cover it | Refunding a deposit is quick if we keep a float in the wallet. |
| Settlement | E-wallets T+2, QR Ph T+1, cards T+3; weekly payout by default; instant settlement into a PayMongo Wallet costs up to 2% (QR Ph, banks) or 3% (cards) | Deposit money reaches us before pickup day without paying for instant settlement. |
| Disbursements | From a PayMongo Wallet to bank accounts (InstaPay real time, ₱50,000 cap per transfer; PESONet next banking day, ₱10M cap), e-wallets, or other PayMongo Wallets. ₱10 per transfer, batch up to 1,000, webhooks for success and failure | We can pay a farmer's GCash or bank account by API the moment a deal settles. |
| Onboarding-as-a-Service (child accounts) | A platform can create, verify and activate accounts for its users. Individual KYC needs government ID, selfie and TIN. Available to every PayMongo account by default | A verified farmer could get their own PayMongo wallet under our brand. The TIN requirement will block many backyard farmers. |
| Workflows (splits, delayed release) | "Delayed disbursements to sellers based on delivery confirmation" is a named use case. Access needs account configuration through PayMongo support | This is the real escrow building block, but it is gated. Ask for it in Phase 2, do not plan the pilot on it. |
| Wallet limits | Default merchant wallet: ₱25M balance cap, ₱1M daily outward; upgraded ₱50M and ₱3M | Not a constraint at pilot volume (about ₱12M gross a week, deposits a tenth of that). |

Two facts outside PayMongo shape the design more than anything above:

- **GCash personal wallets cap at ₱100,000 balance and ₱100,000 incoming per month, ₱100,000 outgoing per day.** A single 10-head hog deal is about ₱160,000. Neither the buyer nor the farmer can push the full price through GCash in one go, and a farmer who sells twice a month would hit the incoming cap.
- **Holding buyer money and paying it on to farmers is, on its face, an Operator of Payment System activity under BSP Circular 1049** ("provides a system that processes payments on behalf of any person"). Registration is due within one month of starting operations, minimum capital is ₱5M under ₱100M monthly volume, and BSP has shut down an unregistered platform before. Whether a platform that only holds small deposits through a registered gateway needs its own registration is a question for counsel, not for this document.

## 3. Recommended model for the pilot: deposit through PayMongo, balance direct

Full escrow of the deal value is not realistic for the pilot: e-wallet limits block it, card holds do not apply, and holding six-figure sums per deal makes us a payment operator on day one. A **booking deposit** gives the farmer the assurance without any of that.

### The rule

- When a farmer accepts an offer, the buyer has **2 hours** to pay a deposit of **10% of the estimated total, minimum ₱2,000, maximum ₱20,000**. The cap keeps every deposit under the InstaPay and GCash daily limits and keeps our exposure small.
- The deposit is paid through a PayMongo Checkout Session (GCash, Maya, QR Ph, online banking). Card is off by default; enable per buyer on request.
- Until the deposit is paid the deal is `accepted_unpaid`. The lot stays reserved, but no hauler job is published and the farmer sees "waiting for buyer's deposit". If the 2 hours pass, acceptance lapses, the lot returns to the board, and the farmer is told.
- On `payment.paid` (webhook) the deal becomes `booked`, the hauler job is published, and the farmer's deal screen shows "₱16,000 reserved for you, paid by the buyer, held by [Platform] through PayMongo". Send the same by SMS.
- **The balance is paid directly at delivery** as already wireframed (GCash, bank or cash, with the reference number recorded). This keeps the big money off our books and inside the limits that buyers and farmers already live with.

### What happens to the deposit

| Outcome | Deposit | Who decides |
|---|---|---|
| Delivered and settled | Paid out to the farmer as part payment by Disbursements API (InstaPay to their GCash or bank, ₱10 fee) within 24 hours of settlement. The buyer's balance due at delivery is reduced by the same amount. | Automatic on `settled` |
| Buyer cancels after booking, or no-show in the pickup window | Forfeited to the farmer, less PayMongo's acceptance fee. Buyer gets a strike. | Automatic after the window plus 2 hours, unless a dispute is open |
| Farmer cancels, or the hauler's pickup checklist shows fewer or different animals and the buyer walks away | Refunded to the buyer in full (we absorb the fee). Farmer gets a strike. | Automatic on farmer cancel; admin on checklist mismatch |
| Dispute opened | Frozen. Resolution screen gains a fourth line: where the deposit goes. | Admin, existing dispute flow |

### Money flow and accounting

1. Buyer pays ₱16,000 by GCash. PayMongo keeps ₱357 (2.23%). ₱15,643 settles to our PayMongo Wallet at T+2.
2. We keep an internal ledger row per deposit: `deposit_id, deal_id, gross, fee, net, state`. The wallet balance must always equal the sum of `net` for deposits in `held` plus our float. Reconcile daily against the payout and transfer APIs.
3. On settlement we disburse ₱15,643 to the farmer's payout account (₱10 fee, ours) and mark the row `released`.
4. Keep a **float of at least one week of deposits** in the wallet so refunds never fail for lack of balance.
5. Who pays the acceptance fee is a business decision: absorb it inside the platform commission (recommended for the pilot, it is about ₱350 on a ₱160,000 deal), or add it to the buyer's deposit.

### Farmer payout account

The farmer registration form needs one more field group before this can launch: **payout account** (GCash number or bank account, account name). Verify it with a ₱1 test transfer on save; the name on the account must match the name on their ID. Show it on the farmer's Me screen, never in a listing.

## 4. Why not the alternatives

- **Full escrow through our wallet.** Six figures per deal exceeds GCash limits for both parties, makes us hold a serious float, and removes any doubt that we are an OPS. Revisit only for buyers who can pay by online banking and only after registration.
- **Card hold then capture.** Cards only, 7-day hold, buyers do not have them.
- **Non-refundable booking fee paid to us, credited against commission.** Lightest legally (it is our revenue, not held funds), but it gives the farmer no money when the buyer no-shows, so it does not solve the problem.
- **Off-platform deposit ("GCash me a reservation")** is what happens today. No evidence, no automatic release, and it is exactly the informal practice the board is meant to replace.

## 5. Phase 2: let PayMongo hold the money

Once the pilot shows deposits work, move the hold out of our wallet:

1. Create **PayMongo child accounts** for verified farmers who have a TIN (Onboarding-as-a-Service, hosted identity verification so we never handle their ID images twice).
2. Ask PayMongo support to enable **Workflows** with a "release on API event" step: buyer pays into the parent account, the workflow holds, our `settled` event releases to the farmer's child account, `cancelled_by_buyer` releases to the farmer, `cancelled_by_farmer` refunds. PayMongo then operates the licensed rails and we hold nothing.
3. Consider raising the deposit cap or offering optional full prepayment for buyers on online banking (0.71%, higher limits than e-wallets), still released by the same events.
4. Farmers without a TIN stay on the Phase 1 disbursement path.

## 6. Open items before build

- **Legal opinion on OPS registration** for the Phase 1 deposit model. Budget the ₱5M capital and ₱25,000 to ₱60,000 fee as a possible pilot cost, and the one-month deadline after first deposit.
- **PayMongo business verification** and a conversation with their team about Workflows and volume pricing (the ₱10 transfer fee and 2.23% GCash are list prices).
- **Deposit percentage and cap** to validate in Phase 0 interviews. 10% is a guess; traders may consider ₱20,000 normal or outrageous.
- **Grace periods** (2 hours to pay, pickup window plus 2 hours) to validate with haulers and farmers.
- **API and schema changes**: `deposits` table, deal states `accepted_unpaid` and `booked`, webhook endpoint, disbursement job, ledger reconciliation job, payout account on user, fourth resolution line in disputes.
- **Wireframes**: buyer "Pay deposit" screen, farmer deal screen with the deposit line, farmer payout account on Me and in registration. Not drawn yet.

## Sources

- PayMongo pricing: https://www.paymongo.com/en-ph/pricing
- Hold then capture: https://docs.paymongo.com/docs/payment-acceptance-hold-then-capture
- Refunds: https://docs.paymongo.com/docs/payment-acceptance-refunds
- Wallets and limits: https://docs.paymongo.com/docs/money-movement-wallets
- Disbursements: https://docs.paymongo.com/docs/money-movement-disbursements
- Onboarding-as-a-Service: https://docs.paymongo.com/docs/onboarding-as-a-service and https://docs.paymongo.com/docs/onboarding-aas-onboarding-paths
- Workflows: https://docs.paymongo.com/docs/fiaas-workflows
- Money movement overview: https://www.paymongo.com/money-movement
- GCash limits: https://www.transfi.com/blog/gcash-wallet-and-transfer-limits-explained-fully-verified-limits-and-how-to-increase-them and https://www.noypigeeks.com/featured/gcash-limits/
- BSP Circular 1049 and OPS: https://www.bsp.gov.ph/PaymentAndSettlement/FAQ_OPS_Registration.pdf, https://www.divinalaw.com/dose-of-law/regulating-payment-systems-operators/, https://loft.ph/bsp-operator-of-payment-system/, https://www.gmanetwork.com/news/money/companies/796505/bsp-orders-lyka-to-stop-operations-as-operator-of-payment-system/story/
