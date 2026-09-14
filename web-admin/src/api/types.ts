// Shapes from docs/api/openapi.yaml that the console reads or writes.
// Money and weights are decimal strings, dates YYYY-MM-DD, timestamps RFC 3339.

export type Species = 'hog' | 'cattle' | 'carabao' | 'goat' | 'native_chicken';
export type Role = 'farmer' | 'buyer' | 'hauler' | 'admin';
export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'suspended';

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: { field: string; message: string }[];
  current?: unknown;
}

export interface User {
  id: string;
  phone_masked: string;
  full_name: string;
  preferred_lang: string;
  roles: Role[];
  verification: VerificationStatus;
  verification_notes?: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in_seconds: number;
  user: User;
}

export interface LoginStep {
  step_token: string;
  expires_in_seconds: number;
  totp_setup: { secret: string; otpauth_url: string } | null;
}

export interface UserDocument {
  id: string;
  doc_type: string;
  status: VerificationStatus;
  notes: string | null;
  uploaded_at: string;
  reviewed_at: string | null;
}

export interface Location {
  psgc_code: string;
  parent_code: string | null;
  level: 'region' | 'province' | 'municipality' | 'barangay';
  name: string;
  has_children: boolean;
}

export interface LocationWithPath extends Location {
  path: Location[];
  display_name: string;
}

export interface Farm {
  id: string;
  name: string;
  barangay_code: string;
  farm_type: string | null;
  location: LocationWithPath;
  lot_summary: { species: Species; lots: number; heads: number }[];
  created_at: string;
}

export interface VerificationCase {
  user: User;
  documents: UserDocument[];
  farms: Farm[];
  oldest_pending_at: string | null;
}

export interface WeightClass {
  id: number;
  species: Species;
  label: string;
  unit: 'per_kg_liveweight' | 'per_head';
  sort: number;
}

export interface ReferencePrice {
  id: string;
  province_code: string;
  species: Species;
  weight_class_id: number | null;
  unit: 'per_kg_liveweight' | 'per_head';
  price: string;
  source: string;
  effective_from: string;
  set_by: string;
  created_at: string;
  large_change?: boolean;
  previous_price?: string | null;
}

export interface RestrictedZone {
  id: string;
  location_code: string;
  location: LocationWithPath;
  species: Species;
  reason: string;
  starts_on: string;
  ends_on: string | null;
  set_by: string;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  admin_id: string;
  admin_name: string;
  action: string;
  target_type: string;
  target_id: string;
  before: unknown;
  after: unknown;
  created_at: string;
}

export type DealState = 'accepted' | 'hauler_assigned' | 'in_transit' | 'delivered' | 'settled' | 'cancelled' | 'disputed' | 'refunded';

export interface DealEvent {
  from_state: string | null;
  to_state: DealState;
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export interface Deal {
  id: string;
  listing_id: string;
  offer_id: string;
  farmer_id: string;
  farmer_name: string;
  buyer_id: string;
  buyer_name: string;
  species: Species;
  weight_class?: WeightClass;
  unit: 'per_kg_liveweight' | 'per_head';
  state: DealState;
  agreed_price: string;
  agreed_heads: number;
  agreed_weight_kg: string | null;
  estimated_total: string | null;
  delivered_heads: number | null;
  delivered_weight_kg: string | null;
  final_total: string | null;
  delivery_note: string | null;
  cancel_reason: string | null;
  needs_hauler: boolean;
  payment_method: string | null;
  payment_reference: string | null;
  buyer_paid_at: string | null;
  farmer_confirmed_at: string | null;
  outlier_flag: boolean;
  counts_for_price: boolean;
  location: LocationWithPath;
  dropoff: LocationWithPath | null;
  shipment: ShipmentSummary | null;
  deposit_required: boolean;
  deposit: DepositSummary | null;
  events?: DealEvent[];
  accepted_at: string;
  delivered_at: string | null;
  settled_at: string | null;
  cancelled_at: string | null;
}

export type ShipmentStatus = 'assigned' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled';

/** The hauler's record as it appears inside a deal. */
export interface ShipmentSummary {
  id: string;
  status: ShipmentStatus;
  hauler_id: string;
  hauler_name: string;
  vehicle_plate: string | null;
  shipping_permit_no: string | null;
  vet_health_cert_no: string | null;
  head_count_at_pickup: number | null;
  agreed_fee: string | null;
  scheduled_pickup_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  last_ping: { lat: number; lng: number; at: string } | null;
}

export type DepositStatus = 'pending' | 'paid' | 'lapsed' | 'released' | 'forfeited' | 'refunded';

export interface DepositSummary {
  id: string;
  status: DepositStatus;
  amount: string;
  expires_at: string;
  paid_at: string | null;
  closed_at: string | null;
}

export interface Deposit extends DepositSummary {
  deal_id: string;
  buyer_id: string;
  farmer_id: string;
  buyer_name: string;
  farmer_name: string;
  provider: string;
  checkout_url: string | null;
  payment_method: string | null;
  fee: string | null;
  net: string | null;
  transfer_status: 'pending' | 'succeeded' | 'failed' | null;
  failure_reason: string | null;
  created_at: string;
}

export interface DepositTotals {
  held: string;
  released: string;
  forfeited: string;
  refunded: string;
  pending_count: number;
}

export interface AdminUserRow extends User {
  province_name: string | null;
  deals_count: number;
  last_seen_at: string | null;
}

export interface ReportSummary {
  from: string;
  to: string;
  province_code: string | null;
  deals: {
    by_state: { state: DealState; count: number }[];
    settled_by_species: { species: Species; unit: 'per_kg_liveweight' | 'per_head'; deals: number; heads: number; weight_kg: string | null; gross_value: string; median_price: string | null }[];
    outliers_pending_review: number;
  };
  users: { by_role: { role: Role; total: number; verified: number; pending: number; active_in_period: number }[] };
  settlement: { settled: number; median_hours_accept_to_settle: number | null; p90_hours_accept_to_settle: number | null };
  disputes: { opened: number; open_now: number; rate_pct: number | null };
  deposits: { asked: number; paid: number; lapsed: number; released: number; forfeited: number; refunded: number; held_net: string };
  hauling: { deals_needing_hauler: number; hauled_in_app: number; checklist_complete_pct: number | null };
  thin_municipalities: { location: LocationWithPath; species: Species; listings_30d: number; settled_30d: number; needed: number }[];
}

export type DisputeStatus = 'open' | 'under_review' | 'resolved_settled' | 'resolved_refunded' | 'dismissed';

export interface Dispute {
  id: string;
  deal_id: string;
  raised_by: string;
  raised_by_role: 'farmer' | 'buyer';
  reason: string;
  details: string | null;
  status: DisputeStatus;
  resolution: string | null;
  resolved_by: string | null;
  deal: Deal;
  created_at: string;
  resolved_at: string | null;
}

export const DEAL_STATES: DealState[] = ['accepted', 'hauler_assigned', 'in_transit', 'delivered', 'settled', 'disputed', 'refunded', 'cancelled'];
export const DISPUTE_REASON: Record<string, string> = {
  weight_mismatch: 'Weight mismatch',
  health: 'Animal health',
  non_payment: 'Payment not received',
  no_show: 'No show',
  other: 'Other',
};

export interface Health {
  status: 'ok' | 'degraded';
  db: string;
  redis: string;
  last_snapshot_date: string | null;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export const SPECIES: Species[] = ['hog', 'cattle', 'carabao', 'goat', 'native_chicken'];
export const SPECIES_LABEL: Record<Species, string> = {
  hog: 'Hog',
  cattle: 'Cattle',
  carabao: 'Carabao',
  goat: 'Goat',
  native_chicken: 'Native chicken',
};
export const DOC_LABEL: Record<string, string> = {
  gov_id: 'Government ID',
  selfie_with_id: 'Selfie with ID',
  business_permit: 'Business permit',
  ltfrb_franchise: 'LTFRB franchise',
  or_cr: 'OR/CR',
  coop_membership: 'Cooperative membership',
  barangay_clearance: 'Barangay clearance',
};
