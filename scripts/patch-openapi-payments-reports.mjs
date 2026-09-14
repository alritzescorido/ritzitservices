// One-off: Payments tag (booking deposit, payout account, webhook), Phase 4
// reports and the admin users list in docs/api/openapi.yaml.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../docs/api/openapi.yaml', import.meta.url);
let s = readFileSync(path, 'utf8');
if (s.includes('/payments/webhook:')) {
  console.log('already patched');
  process.exit(0);
}
const rep = (a, b) => {
  if (!s.includes(a)) {
    console.error(`anchor not found: ${a.slice(0, 60)}`);
    process.exit(1);
  }
  s = s.replace(a, () => b);
};

rep(
  `  - name: Sync
`,
  `  - name: Payments
    description: |
      Booking deposit (decision 3, model in docs/payments-paymongo.md). When a payment
      provider is configured, accepting an offer asks the buyer for 10% of the estimated
      total, at least 2,000 and at most 20,000 pesos, within 2 hours, through a hosted
      checkout. Until paid the deal shows deposit_status pending and no hauler job is
      published. Paid deposits are released to the farmer's payout account on settlement,
      forfeited to the farmer when the buyer cancels, refunded when the farmer cancels,
      and decided by the admin inside a dispute. Without a provider the deal behaves as
      before and deposit_required is false.
  - name: Sync
`,
);

// Deal carries the deposit.
rep(
  `        dropoff: { $ref: '#/components/schemas/LocationWithPath' }
        shipment: { $ref: '#/components/schemas/ShipmentSummary' }`,
  `        dropoff: { $ref: '#/components/schemas/LocationWithPath' }
        shipment: { $ref: '#/components/schemas/ShipmentSummary' }
        deposit_required: { type: boolean }
        deposit: { $ref: '#/components/schemas/DepositSummary' }`,
);

// Dispute resolution decides the deposit too.
rep(
  `                outcome: { type: string, enum: [settled, refunded, dismissed] }
                resolution: { type: string, minLength: 3, maxLength: 1000 }
                delivered_weight_kg: { $ref: '#/components/schemas/Weight' }`,
  `                outcome: { type: string, enum: [settled, refunded, dismissed] }
                resolution: { type: string, minLength: 3, maxLength: 1000 }
                delivered_weight_kg: { $ref: '#/components/schemas/Weight' }
                deposit:
                  type: string
                  enum: [release_to_farmer, refund_to_buyer, hold]
                  description: Where a paid deposit goes. Defaults follow the outcome (settled releases, refunded refunds, dismissed holds).`,
);

rep(
  `  # ------------------------------------------------------------------ Sync
`,
  `  # ------------------------------------------------------------------ Payments
  /deals/{deal_id}/deposit:
    get:
      tags: [Payments]
      operationId: getDeposit
      summary: The booking deposit on a deal
      description: Farmer, buyer and admins. checkout_url is returned to the buyer only, while the deposit is pending.
      parameters:
        - name: deal_id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Deposit' }
        '404': { $ref: '#/components/responses/NotFound' }
  /deals/{deal_id}/deposit/checkout:
    post:
      tags: [Payments]
      operationId: refreshDepositCheckout
      summary: Buyer asks for a fresh checkout link
      description: Used when the first link could not be created or was closed. Same amount, same deadline.
      parameters:
        - name: deal_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - $ref: '#/components/parameters/IdempotencyKey'
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Deposit' }
        '409':
          description: Deposit is not pending.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
  /me/payout-account:
    get:
      tags: [Payments]
      operationId: getMyPayoutAccount
      summary: Where I get paid
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/PayoutAccount' }
        '404': { $ref: '#/components/responses/NotFound' }
    put:
      tags: [Payments]
      operationId: putMyPayoutAccount
      summary: Set my GCash number or bank account
      description: Farmer role. A one-peso test transfer verifies the account; released deposits go here.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/PayoutAccountInput' }
      responses:
        '200':
          description: Saved
          content:
            application/json:
              schema: { $ref: '#/components/schemas/PayoutAccount' }
        '403': { $ref: '#/components/responses/Forbidden' }
  /payments/webhook:
    post:
      tags: [Payments]
      operationId: paymentsWebhook
      summary: Provider callbacks (checkout paid, transfer succeeded or failed)
      description: Unauthenticated; the body is verified with the provider's signature header. Events are stored once by id and replays return 200 without side effects.
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema: { type: object }
      responses:
        '200': { description: Recorded. }
        '400': { description: Bad signature or malformed event. }
  /admin/deposits:
    get:
      tags: [Payments]
      operationId: adminListDeposits
      summary: Deposits, newest first
      parameters:
        - name: status
          in: query
          schema: { $ref: '#/components/schemas/DepositStatus' }
        - $ref: '#/components/parameters/Limit'
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [items, totals]
                properties:
                  items:
                    type: array
                    items: { $ref: '#/components/schemas/Deposit' }
                  totals: { $ref: '#/components/schemas/DepositTotals' }
  # ------------------------------------------------------------------ Sync
`,
);

rep(
  `  # ------------------------------------------------------------------ Admin auth
`,
  `  /admin/users:
    get:
      tags: [Admin]
      operationId: adminListUsers
      summary: Everyone, filterable
      parameters:
        - name: role
          in: query
          schema: { $ref: '#/components/schemas/Role' }
        - name: verification
          in: query
          schema: { $ref: '#/components/schemas/VerificationStatus' }
        - name: q
          in: query
          description: Name or phone fragment.
          schema: { type: string, maxLength: 60 }
        - $ref: '#/components/parameters/Cursor'
        - $ref: '#/components/parameters/Limit'
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [items]
                properties:
                  items:
                    type: array
                    items: { $ref: '#/components/schemas/AdminUserRow' }
                  next_cursor: { type: [string, 'null'] }
  /admin/reports/summary:
    get:
      tags: [Admin]
      operationId: adminReportSummary
      summary: Health of the whole system for a period
      description: Volume and price by species, users by role, time to settle, dispute rate, deposit outcomes, hauled share, and municipalities with listings but too few settled deals for a live median.
      parameters:
        - name: from
          in: query
          schema: { type: string, format: date }
          description: Default 30 days ago.
        - name: to
          in: query
          schema: { type: string, format: date }
          description: Default today.
        - name: province_code
          in: query
          schema: { $ref: '#/components/schemas/PsgcCode' }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ReportSummary' }
  /admin/reports/deals.csv:
    get:
      tags: [Admin]
      operationId: adminReportDealsCsv
      summary: Settled and other deals in the period as CSV
      parameters:
        - name: from
          in: query
          schema: { type: string, format: date }
        - name: to
          in: query
          schema: { type: string, format: date }
        - name: province_code
          in: query
          schema: { $ref: '#/components/schemas/PsgcCode' }
        - name: state
          in: query
          schema: { $ref: '#/components/schemas/DealState' }
      responses:
        '200':
          description: One row per deal.
          content:
            text/csv:
              schema: { type: string }
  # ------------------------------------------------------------------ Admin auth
`,
);

s = s.trimEnd() + `
    DepositStatus:
      type: string
      enum: [pending, paid, lapsed, released, forfeited, refunded]
    DepositSummary:
      type: object
      required: [id, status, amount, expires_at]
      properties:
        id: { type: string, format: uuid }
        status: { $ref: '#/components/schemas/DepositStatus' }
        amount: { $ref: '#/components/schemas/Money' }
        expires_at: { type: string, format: date-time, description: Pay-by time while pending. }
        paid_at: { type: [string, 'null'], format: date-time }
        closed_at: { type: [string, 'null'], format: date-time }
    Deposit:
      allOf:
        - $ref: '#/components/schemas/DepositSummary'
        - type: object
          required: [deal_id, provider, created_at]
          properties:
            deal_id: { type: string, format: uuid }
            buyer_id: { type: string, format: uuid }
            farmer_id: { type: string, format: uuid }
            buyer_name: { type: string }
            farmer_name: { type: string }
            provider: { type: string }
            checkout_url: { type: [string, 'null'], description: Buyer only, while pending. }
            payment_method: { type: [string, 'null'] }
            fee: { $ref: '#/components/schemas/MoneyNullable' }
            net: { $ref: '#/components/schemas/MoneyNullable' }
            transfer_status: { type: [string, 'null'], enum: [pending, succeeded, failed, null] }
            failure_reason: { type: [string, 'null'] }
            created_at: { type: string, format: date-time }
    DepositTotals:
      type: object
      properties:
        held: { $ref: '#/components/schemas/Money', description: Sum of net over paid deposits. What the wallet must hold. }
        released: { $ref: '#/components/schemas/Money' }
        forfeited: { $ref: '#/components/schemas/Money' }
        refunded: { $ref: '#/components/schemas/Money' }
        pending_count: { type: integer }
    PayoutAccountInput:
      type: object
      required: [kind, account_no, account_name]
      properties:
        kind: { type: string, enum: [gcash, bank] }
        account_no: { type: string, minLength: 6, maxLength: 34, description: GCash mobile number or bank account number. }
        account_name: { type: string, minLength: 2, maxLength: 120, description: Must match the name on the ID. }
        bank_code: { type: [string, 'null'], maxLength: 20, description: Required for bank. }
    PayoutAccount:
      allOf:
        - $ref: '#/components/schemas/PayoutAccountInput'
        - type: object
          required: [verified, updated_at]
          properties:
            account_no_masked: { type: string }
            verified: { type: boolean, description: True once the one-peso test transfer succeeded. }
            updated_at: { type: string, format: date-time }
    AdminUserRow:
      allOf:
        - $ref: '#/components/schemas/User'
        - type: object
          properties:
            province_name: { type: [string, 'null'], description: From the first farm, hauler base or delivery point. }
            deals_count: { type: integer }
            last_seen_at: { type: [string, 'null'], format: date-time }
    ReportSummary:
      type: object
      required: [from, to, deals, users, settlement, disputes, deposits, hauling, thin_municipalities]
      properties:
        from: { type: string, format: date }
        to: { type: string, format: date }
        province_code: { type: [string, 'null'] }
        deals:
          type: object
          properties:
            by_state:
              type: array
              items:
                type: object
                properties:
                  state: { $ref: '#/components/schemas/DealState' }
                  count: { type: integer }
            settled_by_species:
              type: array
              items:
                type: object
                properties:
                  species: { $ref: '#/components/schemas/Species' }
                  deals: { type: integer }
                  heads: { type: integer }
                  weight_kg: { $ref: '#/components/schemas/MoneyNullable' }
                  gross_value: { $ref: '#/components/schemas/Money' }
                  median_price: { $ref: '#/components/schemas/MoneyNullable' }
                  unit: { $ref: '#/components/schemas/PriceUnit' }
            outliers_pending_review: { type: integer }
        users:
          type: object
          properties:
            by_role:
              type: array
              items:
                type: object
                properties:
                  role: { $ref: '#/components/schemas/Role' }
                  total: { type: integer }
                  verified: { type: integer }
                  pending: { type: integer }
                  active_in_period: { type: integer, description: Had a listing, offer, deal, shipment or sign-in in the period. }
        settlement:
          type: object
          properties:
            settled: { type: integer }
            median_hours_accept_to_settle: { type: [number, 'null'] }
            p90_hours_accept_to_settle: { type: [number, 'null'] }
        disputes:
          type: object
          properties:
            opened: { type: integer }
            open_now: { type: integer }
            rate_pct: { type: [number, 'null'], description: Disputes opened over deals delivered in the period. }
        deposits:
          type: object
          properties:
            asked: { type: integer }
            paid: { type: integer }
            lapsed: { type: integer }
            released: { type: integer }
            forfeited: { type: integer }
            refunded: { type: integer }
            held_net: { $ref: '#/components/schemas/Money' }
        hauling:
          type: object
          properties:
            deals_needing_hauler: { type: integer }
            hauled_in_app: { type: integer }
            checklist_complete_pct: { type: [number, 'null'] }
        thin_municipalities:
          type: array
          description: Listings in the last 30 days but fewer settled deals than the live-median threshold.
          items:
            type: object
            properties:
              location: { $ref: '#/components/schemas/LocationWithPath' }
              species: { $ref: '#/components/schemas/Species' }
              listings_30d: { type: integer }
              settled_30d: { type: integer }
              needed: { type: integer }
`;
writeFileSync(path, s);
console.log('openapi.yaml: payments, reports, users list');
