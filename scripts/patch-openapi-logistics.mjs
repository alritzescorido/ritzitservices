// One-off: Phase 3 logistics operations and schemas in docs/api/openapi.yaml.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../docs/api/openapi.yaml', import.meta.url);
let s = readFileSync(path, 'utf8');
if (s.includes('/haul-jobs:')) {
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
  `  - name: Logistics
    description: |
      Phase 3. Haulers keep a truck profile, pick jobs from accepted deals that need hauling,
      complete the pickup checklist (shipping permit, veterinary certificate, head count,
      load photo) before the trip can start, share position in transit, and hand over to the
      buyer, who still confirms count and weight. Jobs inside an active restricted zone for
      the species are not offered. Accepting a job needs a verified hauler.
  - name: Sync
`,
);

// Buyer can say where delivery happens; the shipment shows on the deal.
rep(
  `        needs_hauler: { type: boolean, default: true, description: 'Book a hauler in the app, or bring my own truck.' }
        note: { type: [string, 'null'], maxLength: 300 }`,
  `        needs_hauler: { type: boolean, default: true, description: 'Book a hauler in the app, or bring my own truck.' }
        dropoff_location_code: { $ref: '#/components/schemas/PsgcCode', description: Municipality or barangay where the buyer wants delivery. Required when needs_hauler. }
        note: { type: [string, 'null'], maxLength: 300 }`,
);
rep(
  `        location: { $ref: '#/components/schemas/LocationWithPath' }
        events:
          type: array
          items: { $ref: '#/components/schemas/DealEvent' }`,
  `        location: { $ref: '#/components/schemas/LocationWithPath' }
        dropoff: { $ref: '#/components/schemas/LocationWithPath' }
        shipment: { $ref: '#/components/schemas/ShipmentSummary' }
        events:
          type: array
          items: { $ref: '#/components/schemas/DealEvent' }`,
);
rep(`                  enum: [user_document, farm_photo, lot_photo, vaccination_doc]`, `                  enum: [user_document, farm_photo, lot_photo, vaccination_doc, shipment_photo]`);

rep(
  `  # ------------------------------------------------------------------ Sync
`,
  `  # ------------------------------------------------------------------ Logistics
  /haulers/me:
    get:
      tags: [Logistics]
      operationId: getMyHaulerProfile
      summary: My truck and rates
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/HaulerProfile' }
        '404': { $ref: '#/components/responses/NotFound' }
    put:
      tags: [Logistics]
      operationId: putMyHaulerProfile
      summary: Create or replace my truck and rates
      description: Hauler role. Verification is separate and needs the OR/CR and ID documents.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/HaulerProfileInput' }
      responses:
        '200':
          description: Saved
          content:
            application/json:
              schema: { $ref: '#/components/schemas/HaulerProfile' }
        '403': { $ref: '#/components/responses/Forbidden' }
  /haul-jobs:
    get:
      tags: [Logistics]
      operationId: listHaulJobs
      summary: Accepted deals that need a hauler, soonest pickup first
      description: Hauler role. Jobs inside an active restricted zone for the species are excluded. fits_my_truck filters by capacity_heads.
      parameters:
        - name: species
          in: query
          schema: { $ref: '#/components/schemas/Species' }
        - name: province_code
          in: query
          schema: { $ref: '#/components/schemas/PsgcCode' }
        - name: fits_my_truck
          in: query
          schema: { type: boolean, default: false }
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
                    items: { $ref: '#/components/schemas/HaulJob' }
  /haul-jobs/{deal_id}/accept:
    post:
      tags: [Logistics]
      operationId: acceptHaulJob
      summary: Take a job
      description: Verified hauler with a profile. Refused with 409 when the job is gone, over the truck's capacity, or inside a restricted zone. The deal moves to hauler_assigned.
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
              required: [agreed_fee, scheduled_pickup_at]
              properties:
                agreed_fee: { $ref: '#/components/schemas/Money' }
                scheduled_pickup_at: { type: string, format: date-time }
      responses:
        '201':
          description: Shipment created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Shipment' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '409':
          description: Job unavailable, over capacity, or restricted.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
  /shipments:
    get:
      tags: [Logistics]
      operationId: listMyShipments
      summary: My shipments as hauler
      parameters:
        - name: status
          in: query
          schema: { $ref: '#/components/schemas/ShipmentStatus' }
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
                    items: { $ref: '#/components/schemas/Shipment' }
  /shipments/{shipment_id}:
    get:
      tags: [Logistics]
      operationId: getShipment
      summary: One shipment with its events
      description: Visible to the hauler, the farmer, the buyer and admins.
      parameters:
        - name: shipment_id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Shipment' }
        '404': { $ref: '#/components/responses/NotFound' }
  /shipments/{shipment_id}/start:
    post:
      tags: [Logistics]
      operationId: startTrip
      summary: Pickup checklist complete, trip starts
      description: Every item is required: shipping permit number, veterinary health certificate number, head count, at least one load photo. The deal moves to in_transit.
      parameters:
        - name: shipment_id
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
              required: [shipping_permit_no, vet_health_cert_no, head_count, photo_keys]
              properties:
                shipping_permit_no: { type: string, minLength: 3, maxLength: 60 }
                vet_health_cert_no: { type: string, minLength: 3, maxLength: 60 }
                head_count: { type: integer, minimum: 1 }
                photo_keys:
                  type: array
                  minItems: 1
                  maxItems: 5
                  items: { type: string }
                note: { type: [string, 'null'], maxLength: 300 }
                geo:
                  type: [object, 'null']
                  properties:
                    lat: { type: number }
                    lng: { type: number }
      responses:
        '200':
          description: In transit
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Shipment' }
        '409':
          description: Not assigned to you, or not in the assigned state.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
        '422': { $ref: '#/components/responses/Unprocessable' }
  /shipments/{shipment_id}/ping:
    post:
      tags: [Logistics]
      operationId: shipmentPing
      summary: Position update, checkpoint, delay or problem in transit
      parameters:
        - name: shipment_id
          in: path
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [geo]
              properties:
                geo:
                  type: object
                  required: [lat, lng]
                  properties:
                    lat: { type: number }
                    lng: { type: number }
                kind: { type: string, enum: [position, checkpoint, delay, problem], default: position }
                note: { type: [string, 'null'], maxLength: 300 }
      responses:
        '201': { description: Recorded. }
  /shipments/{shipment_id}/delivered:
    post:
      tags: [Logistics]
      operationId: markDelivered
      summary: Hauler hands over to the buyer
      description: The shipment becomes delivered. The deal stays in_transit until the buyer confirms count and weight through POST /deals/{deal_id}/deliver.
      parameters:
        - name: shipment_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                note: { type: [string, 'null'], maxLength: 300 }
                photo_keys:
                  type: array
                  maxItems: 5
                  items: { type: string }
                geo:
                  type: [object, 'null']
                  properties:
                    lat: { type: number }
                    lng: { type: number }
      responses:
        '200':
          description: Delivered
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Shipment' }
  /shipments/{shipment_id}/cancel:
    post:
      tags: [Logistics]
      operationId: cancelShipment
      summary: Hauler withdraws before pickup
      description: Allowed only while assigned. The deal returns to accepted and the job reappears on the board; the farmer and buyer are told.
      parameters:
        - name: shipment_id
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
              schema: { $ref: '#/components/schemas/Shipment' }
  # ------------------------------------------------------------------ Sync
`,
);

s = s.trimEnd() + `
    ShipmentStatus:
      type: string
      enum: [assigned, picked_up, in_transit, delivered, cancelled]
    HaulerProfileInput:
      type: object
      required: [vehicle_plate, vehicle_type, capacity_heads]
      properties:
        vehicle_plate: { type: string, minLength: 4, maxLength: 12 }
        vehicle_type: { type: string, maxLength: 40, example: Elf truck }
        capacity_heads: { type: integer, minimum: 1, maximum: 500, description: Hogs of 80 to 100 kg, or equivalent. }
        capacity_kg: { $ref: '#/components/schemas/MoneyNullable' }
        rate_per_head: { $ref: '#/components/schemas/MoneyNullable' }
        rate_per_trip: { $ref: '#/components/schemas/MoneyNullable' }
        service_area:
          type: array
          maxItems: 20
          items: { $ref: '#/components/schemas/PsgcCode' }
          description: Province or municipality codes the hauler serves. Jobs near these show first.
    HaulerProfile:
      allOf:
        - $ref: '#/components/schemas/HaulerProfileInput'
        - type: object
          required: [user_id, verified, created_at]
          properties:
            user_id: { type: string, format: uuid }
            hauler_name: { type: string }
            verified: { type: boolean }
            created_at: { type: string, format: date-time }
    HaulJob:
      type: object
      required: [deal_id, species, heads, pickup, accepted_at]
      properties:
        deal_id: { type: string, format: uuid }
        species: { $ref: '#/components/schemas/Species' }
        weight_class: { $ref: '#/components/schemas/WeightClass' }
        heads: { type: integer }
        estimated_weight_kg: { $ref: '#/components/schemas/MoneyNullable' }
        pickup: { $ref: '#/components/schemas/LocationWithPath' }
        farm_name: { type: string }
        dropoff: { $ref: '#/components/schemas/LocationWithPath' }
        pickup_on: { type: [string, 'null'], format: date }
        fits_capacity: { type: [boolean, 'null'], description: Against the caller's profile; null without a profile. }
        needs: { type: array, items: { type: string }, example: [LGU shipping permit, veterinary health certificate] }
        accepted_at: { type: string, format: date-time }
    ShipmentEvent:
      type: object
      required: [status, created_at]
      properties:
        status: { $ref: '#/components/schemas/ShipmentStatus' }
        kind: { type: [string, 'null'] }
        note: { type: [string, 'null'] }
        geo:
          type: [object, 'null']
          properties:
            lat: { type: number }
            lng: { type: number }
        photo_key: { type: [string, 'null'] }
        created_at: { type: string, format: date-time }
    ShipmentSummary:
      type: object
      required: [id, status, hauler_name]
      properties:
        id: { type: string, format: uuid }
        status: { $ref: '#/components/schemas/ShipmentStatus' }
        hauler_id: { type: string, format: uuid }
        hauler_name: { type: string }
        vehicle_plate: { type: [string, 'null'] }
        shipping_permit_no: { type: [string, 'null'] }
        vet_health_cert_no: { type: [string, 'null'] }
        head_count_at_pickup: { type: [integer, 'null'] }
        agreed_fee: { $ref: '#/components/schemas/MoneyNullable' }
        scheduled_pickup_at: { type: [string, 'null'], format: date-time }
        picked_up_at: { type: [string, 'null'], format: date-time }
        delivered_at: { type: [string, 'null'], format: date-time }
        last_ping:
          type: [object, 'null']
          properties:
            lat: { type: number }
            lng: { type: number }
            at: { type: string, format: date-time }
    Shipment:
      allOf:
        - $ref: '#/components/schemas/ShipmentSummary'
        - type: object
          required: [deal_id, species, heads, pickup]
          properties:
            deal_id: { type: string, format: uuid }
            species: { $ref: '#/components/schemas/Species' }
            heads: { type: integer }
            pickup: { $ref: '#/components/schemas/LocationWithPath' }
            farm_name: { type: string }
            farmer_name: { type: string }
            buyer_name: { type: string }
            dropoff: { $ref: '#/components/schemas/LocationWithPath' }
            photo_keys: { type: array, items: { type: string } }
            cancel_reason: { type: [string, 'null'] }
            deal_state: { $ref: '#/components/schemas/DealState' }
            events:
              type: array
              items: { $ref: '#/components/schemas/ShipmentEvent' }
            created_at: { type: string, format: date-time }
`;
writeFileSync(path, s);
console.log('openapi.yaml: logistics operations and schemas added');
