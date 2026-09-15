// Types mirror docs/api/openapi.yaml for the operations the phone app uses.

export type Species = 'hog' | 'cattle' | 'carabao' | 'goat' | 'native_chicken';
export type Role = 'farmer' | 'buyer' | 'hauler' | 'admin';
export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'suspended';
export type PriceUnit = 'per_kg_liveweight' | 'per_head';

export const SPECIES: Species[] = ['hog', 'cattle', 'carabao', 'goat', 'native_chicken'];
export const SPECIES_LABEL: Record<Species, string> = { hog: 'Baboy', cattle: 'Baka', carabao: 'Kalabaw', goat: 'Kambing', native_chicken: 'Native na manok' };
export const SPECIES_EN: Record<Species, string> = { hog: 'Hog', cattle: 'Cattle', carabao: 'Carabao', goat: 'Goat', native_chicken: 'Native chicken' };

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
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
  expires_in?: number;
  user: User;
}
export interface OtpChallenge {
  challenge_id: string;
  resend_after_seconds?: number;
  expires_in_seconds?: number;
}

export interface Location {
  psgc_code: string;
  name: string;
  level: 'region' | 'province' | 'municipality' | 'barangay';
  parent_code: string | null;
}
export interface LocationWithPath extends Location {
  display_name: string;
  path?: Location[];
}

export interface WeightClass {
  id: number;
  species: Species;
  label: string;
  min_kg: string | null;
  max_kg: string | null;
  unit: PriceUnit;
}

export interface BoardRow {
  species: Species;
  weight_class: WeightClass;
  unit: PriceUnit;
  source: 'municipality' | 'province' | 'reference';
  location_code: string;
  location_name: string;
  median_price: string | null;
  low_price: string | null;
  high_price: string | null;
  sample_count: number;
  change_30d_pct: number | null;
  window_days: number;
  as_of: string;
  reference_source: string | null;
  municipality: { median_price: string | null; sample_count: number };
  label: string;
  sparkline: (string | null)[];
}
export interface Board {
  municipality: Location;
  province: Location | null;
  as_of: string;
  items: BoardRow[];
}

export interface Farm {
  id: string;
  owner_id: string;
  version: number;
  name: string;
  barangay_code: string;
  address_line: string | null;
  farm_type: 'backyard' | 'commercial' | 'cooperative' | null;
  location: LocationWithPath;
  lot_summary: { species: Species; lots: number; heads: number }[];
  photo_keys: string[];
  created_at: string;
  updated_at: string;
}
export interface Lot {
  id: string;
  farm_id: string;
  version: number;
  species: Species;
  breed: string | null;
  head_count: number;
  avg_weight_kg: string | null;
  weight_class: WeightClass;
  age_months: number | null;
  sex: 'male' | 'female' | 'mixed' | null;
  notes: string | null;
  last_vaccination_on: string | null;
  photo_keys: string[];
  created_at: string;
  updated_at: string;
}

export interface Listing {
  id: string;
  lot_id: string;
  farmer_id: string;
  farmer_name: string;
  farmer_verified: boolean;
  farm_name: string;
  status: 'active' | 'matched' | 'withdrawn' | 'expired';
  species: Species;
  weight_class: WeightClass;
  unit: PriceUnit;
  heads_offered: number;
  head_count: number;
  asking_price: string;
  avg_weight_kg: string | null;
  last_vaccination_on: string | null;
  available_from: string;
  pickup_window_end: string | null;
  location: LocationWithPath;
  board_price: string | null;
  board_source: string | null;
  vs_board_pct: number | null;
  estimated_total: string | null;
  pending_offers: number;
  created_at: string;
}
export interface Offer {
  id: string;
  listing_id: string;
  buyer_id: string;
  buyer_name: string;
  parent_offer_id: string | null;
  offered_by: 'farmer' | 'buyer';
  status: 'pending' | 'countered' | 'accepted' | 'rejected' | 'expired';
  price: string;
  heads: number;
  pickup_on: string | null;
  needs_hauler: boolean;
  dropoff_location_code: string | null;
  note: string | null;
  estimated_total: string | null;
  expires_at: string;
  created_at: string;
}

export type DealState = 'accepted' | 'hauler_assigned' | 'in_transit' | 'delivered' | 'settled' | 'cancelled' | 'disputed' | 'refunded';
export type DepositStatus = 'pending' | 'paid' | 'lapsed' | 'released' | 'forfeited' | 'refunded';
export interface DealEvent {
  from_state: string | null;
  to_state: DealState;
  actor_id: string | null;
  note: string | null;
  created_at: string;
}
export interface ShipmentSummary {
  id: string;
  status: 'assigned' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled';
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
  unit: PriceUnit;
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
  deposit: { id: string; status: DepositStatus; amount: string; expires_at: string; paid_at: string | null; closed_at: string | null } | null;
  events?: DealEvent[];
  accepted_at: string;
  delivered_at: string | null;
  settled_at: string | null;
  cancelled_at: string | null;
}
export interface Deposit {
  id: string;
  deal_id: string;
  status: DepositStatus;
  amount: string;
  checkout_url: string | null;
  expires_at: string;
  paid_at: string | null;
  fee: string | null;
  net: string | null;
  provider: string;
}

export interface HaulerProfile {
  user_id: string;
  hauler_name: string;
  verified: boolean;
  vehicle_plate: string;
  vehicle_type: string;
  capacity_heads: number;
  capacity_kg: string | null;
  rate_per_head: string | null;
  rate_per_trip: string | null;
  service_area: string[];
}
export interface HaulJob {
  deal_id: string;
  species: Species;
  heads: number;
  estimated_weight_kg: string | null;
  pickup: LocationWithPath;
  farm_name: string;
  dropoff: LocationWithPath | null;
  pickup_on: string | null;
  fits_capacity: boolean | null;
  needs: string[];
  accepted_at: string;
}
export interface ShipmentEvent {
  status: string;
  kind: string | null;
  note: string | null;
  geo: { lat: number; lng: number } | null;
  photo_key: string | null;
  created_at: string;
}
export interface Shipment extends ShipmentSummary {
  deal_id: string;
  species: Species;
  heads: number;
  pickup: LocationWithPath;
  farm_name: string;
  farmer_name: string;
  buyer_name: string;
  dropoff: LocationWithPath | null;
  photo_keys: string[];
  cancel_reason: string | null;
  deal_state: DealState;
  events?: ShipmentEvent[];
  created_at: string;
}

export type DocType = 'gov_id' | 'selfie_with_id' | 'business_permit' | 'ltfrb_franchise' | 'or_cr' | 'coop_membership' | 'barangay_clearance';
export interface UserDocument {
  id: string;
  doc_type: DocType;
  status: VerificationStatus;
  notes: string | null;
  uploaded_at: string;
  reviewed_at: string | null;
}
export interface UploadSlot {
  storage_key: string;
  upload_url: string;
  expires_at: string;
  headers: Record<string, string>;
}
export interface PayoutAccount {
  kind: 'gcash' | 'bank';
  account_no: string;
  account_no_masked: string;
  account_name: string;
  bank_code: string | null;
  verified: boolean;
  updated_at: string;
}
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}
