// One-off: add the Phase 2 marketplace operations and schemas to docs/api/openapi.yaml.
// Replacer functions everywhere: the YAML contains "$'" patterns.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../docs/api/openapi.yaml', import.meta.url);
let s = readFileSync(path, 'utf8');
if (s.includes('/listings:')) {
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
  `  - name: Marketplace
    description: |
      Phase 2. Listings from herd lots, offers and counter-offers, and deals driven by the
      state machine in the database (accepted, hauler_assigned, in_transit, delivered,
      settled, cancelled, disputed, refunded). Only a settled deal feeds the price board.
      Payment is off-platform in the pilot: the buyer records how they paid, the farmer
      confirms receipt, and only then does the deal settle. Listing needs a verified
      farmer; offering needs a verified buyer.
  - name: Sync
`,
);

rep(
  `  # ------------------------------------------------------------------ Sync
`,
  `  # ------------------------------------------------------------------ Marketplace
  /listings:
    get:
      tags: [Marketplace]
      operationId: listListings
      summary: Open listings for buyers, nearest and newest first
      parameters:
        - name: species
          in: query
          schema: { $ref: '#/components/schemas/Species' }
        - name: weight_class_id
          in: query
          schema: { type: integer }
        - name: province_code
          in: query
          schema: { $ref: '#/components/schemas/PsgcCode' }
        - name: municipality_code
          in: query
          schema: { $ref: '#/components/schemas/PsgcCode' }
        - name: verified_only
          in: query
          schema: { type: boolean, default: false }
        - name: mine
          in: query
          description: Farmer view, my own listings in any status.
          schema: { type: boolean, default: false }
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
                    items: { $ref: '#/components/schemas/Listing' }
                  next_cursor: { type: [string, 'null'] }
    post:
      tags: [Marketplace]
      operationId: createListing
      summary: Post a lot for sale
      description: Farmer role, verified account. Unit comes from the lot's weight class. The board price at listing time is stored for analysis.
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/ListingInput' }
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Listing' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '422': { $ref: '#/components/responses/Unprocessable' }
  /listings/{listing_id}:
    parameters:
      - name: listing_id
        in: path
        required: true
        schema: { type: string, format: uuid }
    get:
      tags: [Marketplace]
      operationId: getListing
      summary: One listing with its lot and farm location
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Listing' }
        '404': { $ref: '#/components/responses/NotFound' }
    delete:
      tags: [Marketplace]
      operationId: withdrawListing
      summary: Withdraw a listing
      description: Pending offers are rejected. Refused with 409 once a deal exists.
      responses:
        '204': { description: Withdrawn. }
        '409':
          description: Listing already matched.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
  /listings/{listing_id}/offers:
    parameters:
      - name: listing_id
        in: path
        required: true
        schema: { type: string, format: uuid }
    get:
      tags: [Marketplace]
      operationId: listOffers
      summary: Offers on a listing
      description: The farmer sees every offer; a buyer sees only their own chain.
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items: { $ref: '#/components/schemas/Offer' }
    post:
      tags: [Marketplace]
      operationId: makeOffer
      summary: Make an offer
      description: Buyer role, verified account. One pending offer per buyer per listing; a new one replaces it. Expires in 24 hours unless the farmer answers.
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/OfferInput' }
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Offer' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '409':
          description: Listing is not open.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
        '422': { $ref: '#/components/responses/Unprocessable' }
  /offers/{offer_id}/counter:
    post:
      tags: [Marketplace]
      operationId: counterOffer
      summary: Counter an offer
      description: The other party proposes a new price or head count. The original becomes countered; the counter is a new pending offer linked by parent_offer_id.
      parameters:
        - name: offer_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [price, heads]
              properties:
                price: { $ref: '#/components/schemas/Money' }
                heads: { type: integer, minimum: 1 }
                note: { type: [string, 'null'], maxLength: 300 }
      responses:
        '201':
          description: Counter created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Offer' }
        '409':
          description: Offer is no longer pending.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
  /offers/{offer_id}/accept:
    post:
      tags: [Marketplace]
      operationId: acceptOffer
      summary: Accept an offer, creating the deal
      description: The party who did not make the offer accepts it. The listing becomes matched and other pending offers are rejected.
      parameters:
        - name: offer_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - $ref: '#/components/parameters/IdempotencyKey'
      responses:
        '201':
          description: Deal created in state accepted.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Deal' }
        '409':
          description: Offer is no longer pending or has expired.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
  /offers/{offer_id}/reject:
    post:
      tags: [Marketplace]
      operationId: rejectOffer
      summary: Reject an offer, or withdraw your own
      parameters:
        - name: offer_id
          in: path
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                note: { type: [string, 'null'], maxLength: 300 }
      responses:
        '200':
          description: Rejected
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Offer' }
  /deals:
    get:
      tags: [Marketplace]
      operationId: listMyDeals
      summary: My deals as farmer or buyer
      parameters:
        - name: state
          in: query
          schema: { $ref: '#/components/schemas/DealState' }
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
                    items: { $ref: '#/components/schemas/Deal' }
                  next_cursor: { type: [string, 'null'] }
  /deals/{deal_id}:
    get:
      tags: [Marketplace]
      operationId: getDeal
      summary: One deal with its event timeline
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
              schema: { $ref: '#/components/schemas/Deal' }
        '404': { $ref: '#/components/responses/NotFound' }
  /deals/{deal_id}/deliver:
    post:
      tags: [Marketplace]
      operationId: confirmDelivery
      summary: Buyer confirms receipt with head count and weighed total
      description: Allowed from accepted (buyer brings own truck) or in_transit. The recomputed total uses the weighed kilograms.
      parameters:
        - name: deal_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [delivered_heads]
              properties:
                delivered_heads: { type: integer, minimum: 0 }
                delivered_weight_kg: { $ref: '#/components/schemas/Weight' }
                note: { type: [string, 'null'], maxLength: 500 }
                photo_keys:
                  type: array
                  maxItems: 5
                  items: { type: string }
      responses:
        '200':
          description: Delivered
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Deal' }
        '409':
          description: Not in a state that can be delivered.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
  /deals/{deal_id}/pay:
    post:
      tags: [Marketplace]
      operationId: recordPayment
      summary: Buyer records the off-platform payment
      parameters:
        - name: deal_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [method]
              properties:
                method: { type: string, enum: [gcash, bank, cash] }
                reference: { type: [string, 'null'], maxLength: 80 }
      responses:
        '200':
          description: Recorded; waiting for the farmer to confirm.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Deal' }
  /deals/{deal_id}/confirm-payment:
    post:
      tags: [Marketplace]
      operationId: confirmPayment
      summary: Farmer confirms the money arrived; the deal settles
      description: Settling writes the price into the board (unless flagged as an outlier) and refreshes today's snapshots.
      parameters:
        - name: deal_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - $ref: '#/components/parameters/IdempotencyKey'
      responses:
        '200':
          description: Settled
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Deal' }
        '409':
          description: Buyer has not recorded a payment, or the deal is not delivered.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
  /deals/{deal_id}/cancel:
    post:
      tags: [Marketplace]
      operationId: cancelDeal
      summary: Cancel before delivery
      description: Either party, from accepted or hauler_assigned. The listing reopens.
      parameters:
        - name: deal_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [reason]
              properties:
                reason: { type: string, minLength: 3, maxLength: 300 }
      responses:
        '200':
          description: Cancelled
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Deal' }
  /deals/{deal_id}/dispute:
    post:
      tags: [Marketplace]
      operationId: openDispute
      summary: Open a dispute after delivery
      description: Freezes the deal; its price does not enter the board until an admin resolves it.
      parameters:
        - name: deal_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [reason]
              properties:
                reason: { type: string, enum: [weight_mismatch, health, non_payment, no_show, other] }
                details: { type: [string, 'null'], maxLength: 1000 }
      responses:
        '201':
          description: Dispute opened
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Dispute' }
  /deals/{deal_id}/ratings:
    post:
      tags: [Marketplace]
      operationId: rateCounterparty
      summary: Rate the other party after settlement
      parameters:
        - name: deal_id
          in: path
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [score]
              properties:
                score: { type: integer, minimum: 1, maximum: 5 }
                comment: { type: [string, 'null'], maxLength: 300 }
      responses:
        '201': { description: Rated. }
        '409':
          description: Deal not settled, or already rated.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
  /admin/disputes:
    get:
      tags: [Admin]
      operationId: adminListDisputes
      summary: Disputes, open first
      parameters:
        - name: status
          in: query
          schema: { type: string, enum: [open, under_review, resolved_settled, resolved_refunded, dismissed] }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items: { $ref: '#/components/schemas/Dispute' }
  /admin/disputes/{dispute_id}/resolve:
    post:
      tags: [Admin]
      operationId: adminResolveDispute
      summary: Resolve a dispute
      description: settled keeps the deal and lets its price join the board (optionally at a corrected weight); refunded excludes it; dismissed returns the deal to delivered.
      parameters:
        - name: dispute_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [outcome, resolution]
              properties:
                outcome: { type: string, enum: [settled, refunded, dismissed] }
                resolution: { type: string, minLength: 3, maxLength: 1000 }
                delivered_weight_kg: { $ref: '#/components/schemas/Weight' }
      responses:
        '200':
          description: Resolved
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Dispute' }
  /admin/deals/{deal_id}/outlier-review:
    post:
      tags: [Admin]
      operationId: adminReviewOutlier
      summary: Let a flagged settlement count, or keep it out
      parameters:
        - name: deal_id
          in: path
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [counts_for_price]
              properties:
                counts_for_price: { type: boolean }
                note: { type: [string, 'null'], maxLength: 500 }
      responses:
        '200':
          description: Reviewed
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Deal' }
  # ------------------------------------------------------------------ Sync
`,
);

s = s.trimEnd() + `
    DealState:
      type: string
      enum: [accepted, hauler_assigned, in_transit, delivered, settled, cancelled, disputed, refunded]
    ListingInput:
      type: object
      required: [lot_id, heads_offered, asking_price]
      properties:
        lot_id: { type: string, format: uuid }
        heads_offered: { type: integer, minimum: 1 }
        asking_price: { $ref: '#/components/schemas/Money' }
        available_from: { type: string, format: date }
        pickup_window_end: { type: [string, 'null'], format: date }
    Listing:
      allOf:
        - $ref: '#/components/schemas/ListingInput'
        - type: object
          required: [id, farmer_id, status, species, weight_class, unit, head_count, created_at]
          properties:
            id: { type: string, format: uuid }
            farmer_id: { type: string, format: uuid }
            farmer_name: { type: string }
            farmer_verified: { type: boolean }
            farm_name: { type: string }
            status: { type: string, enum: [active, matched, withdrawn, expired] }
            species: { $ref: '#/components/schemas/Species' }
            weight_class: { $ref: '#/components/schemas/WeightClass' }
            unit: { $ref: '#/components/schemas/PriceUnit' }
            head_count: { type: integer, description: Heads in the lot. }
            avg_weight_kg: { $ref: '#/components/schemas/MoneyNullable' }
            last_vaccination_on: { type: [string, 'null'], format: date }
            location: { $ref: '#/components/schemas/LocationWithPath' }
            board_price: { $ref: '#/components/schemas/MoneyNullable' }
            board_source: { type: [string, 'null'] }
            vs_board_pct: { type: [number, 'null'], description: 'Asking price relative to the board, in percent.' }
            estimated_total: { $ref: '#/components/schemas/MoneyNullable' }
            pending_offers: { type: integer }
            created_at: { type: string, format: date-time }
    OfferInput:
      type: object
      required: [price, heads]
      properties:
        price: { $ref: '#/components/schemas/Money' }
        heads: { type: integer, minimum: 1 }
        pickup_on: { type: [string, 'null'], format: date }
        needs_hauler: { type: boolean, default: true, description: 'Book a hauler in the app, or bring my own truck.' }
        note: { type: [string, 'null'], maxLength: 300 }
    Offer:
      allOf:
        - $ref: '#/components/schemas/OfferInput'
        - type: object
          required: [id, listing_id, buyer_id, offered_by, status, expires_at, created_at]
          properties:
            id: { type: string, format: uuid }
            listing_id: { type: string, format: uuid }
            buyer_id: { type: string, format: uuid }
            buyer_name: { type: string }
            parent_offer_id: { type: [string, 'null'], format: uuid }
            offered_by: { type: string, enum: [farmer, buyer] }
            status: { type: string, enum: [pending, countered, accepted, rejected, expired] }
            estimated_total: { $ref: '#/components/schemas/MoneyNullable' }
            expires_at: { type: string, format: date-time }
            created_at: { type: string, format: date-time }
    DealEvent:
      type: object
      required: [to_state, created_at]
      properties:
        from_state: { type: [string, 'null'] }
        to_state: { $ref: '#/components/schemas/DealState' }
        actor_id: { type: [string, 'null'], format: uuid }
        note: { type: [string, 'null'] }
        created_at: { type: string, format: date-time }
    Deal:
      type: object
      required: [id, listing_id, offer_id, farmer_id, buyer_id, species, unit, state, agreed_price, agreed_heads, needs_hauler, accepted_at]
      properties:
        id: { type: string, format: uuid }
        listing_id: { type: string, format: uuid }
        offer_id: { type: string, format: uuid }
        farmer_id: { type: string, format: uuid }
        farmer_name: { type: string }
        buyer_id: { type: string, format: uuid }
        buyer_name: { type: string }
        species: { $ref: '#/components/schemas/Species' }
        weight_class: { $ref: '#/components/schemas/WeightClass' }
        unit: { $ref: '#/components/schemas/PriceUnit' }
        state: { $ref: '#/components/schemas/DealState' }
        agreed_price: { $ref: '#/components/schemas/Money' }
        agreed_heads: { type: integer }
        agreed_weight_kg: { $ref: '#/components/schemas/MoneyNullable' }
        estimated_total: { $ref: '#/components/schemas/MoneyNullable' }
        delivered_heads: { type: [integer, 'null'] }
        delivered_weight_kg: { $ref: '#/components/schemas/MoneyNullable' }
        final_total: { $ref: '#/components/schemas/MoneyNullable', description: delivered weight times agreed price, or heads times price for per-head units. }
        needs_hauler: { type: boolean }
        payment_method: { type: [string, 'null'] }
        payment_reference: { type: [string, 'null'] }
        buyer_paid_at: { type: [string, 'null'], format: date-time }
        farmer_confirmed_at: { type: [string, 'null'], format: date-time }
        outlier_flag: { type: boolean }
        counts_for_price: { type: boolean }
        location: { $ref: '#/components/schemas/LocationWithPath' }
        events:
          type: array
          items: { $ref: '#/components/schemas/DealEvent' }
        accepted_at: { type: string, format: date-time }
        delivered_at: { type: [string, 'null'], format: date-time }
        settled_at: { type: [string, 'null'], format: date-time }
        cancelled_at: { type: [string, 'null'], format: date-time }
    Dispute:
      type: object
      required: [id, deal_id, raised_by, reason, status, created_at]
      properties:
        id: { type: string, format: uuid }
        deal_id: { type: string, format: uuid }
        raised_by: { type: string, format: uuid }
        raised_by_role: { type: string, enum: [farmer, buyer] }
        reason: { type: string }
        details: { type: [string, 'null'] }
        status: { type: string, enum: [open, under_review, resolved_settled, resolved_refunded, dismissed] }
        resolution: { type: [string, 'null'] }
        resolved_by: { type: [string, 'null'], format: uuid }
        deal: { $ref: '#/components/schemas/Deal' }
        created_at: { type: string, format: date-time }
        resolved_at: { type: [string, 'null'], format: date-time }
`;
writeFileSync(path, s);
console.log('openapi.yaml: marketplace operations and schemas added');
