import { api, query } from './client';
import { uuid } from './uuid';
import type {
  Board,
  Deal,
  DealState,
  Deposit,
  DocType,
  Farm,
  HaulJob,
  HaulerProfile,
  Listing,
  LocationWithPath,
  Lot,
  Offer,
  OtpChallenge,
  Page,
  PayoutAccount,
  Shipment,
  Species,
  TokenPair,
  UploadSlot,
  User,
  UserDocument,
  WeightClass,
} from './types';

// One function per contract operation the phone app uses.

// Auth and me
export const otpRequest = (phone: string) => api<OtpChallenge>('/auth/otp/request', { method: 'POST', body: { phone }, auth: false });
export const otpVerify = (challenge_id: string, code: string) =>
  api<TokenPair>('/auth/otp/verify', { method: 'POST', body: { challenge_id, code, device: { device_id: deviceId(), platform: 'web', app_version: 'web-0.1' } }, auth: false });
export const refreshToken = (refresh_token: string) => api<TokenPair>('/auth/refresh', { method: 'POST', body: { refresh_token }, auth: false });
export const logout = (refresh_token: string) => api<void>('/auth/logout', { method: 'POST', body: { refresh_token } });
export const getMe = () => api<User>('/me');
export const updateMe = (patch: { full_name?: string; preferred_lang?: string }) => api<User>('/me', { method: 'PATCH', body: patch });
export const addRole = (role: 'farmer' | 'buyer' | 'hauler') => api<User>('/me/roles', { method: 'POST', body: { role } });
export const listDocuments = () => api<{ items: UserDocument[] }>('/me/documents');
export const registerDocument = (doc_type: DocType, storage_key: string) => api<UserDocument>('/me/documents', { method: 'POST', body: { doc_type, storage_key }, idempotent: true });

// Uploads: ask for a slot, PUT the bytes, keep the storage key.
export async function uploadFile(purpose: 'user_document' | 'farm_photo' | 'lot_photo' | 'vaccination_doc' | 'shipment_photo', file: File): Promise<string> {
  const slot = await api<UploadSlot>('/uploads', { method: 'POST', body: { purpose, content_type: file.type, byte_size: file.size } });
  const res = await fetch(slot.upload_url, { method: 'PUT', headers: slot.headers, body: file });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return slot.storage_key;
}

/** What the apps may know before anyone signs in, such as whether an ID is required. */
export const getPublicSettings = () => api<{ require_documents: boolean }>('/settings', { auth: false });

// Locations and prices
export const searchLocations = (q: string, level?: string) => api<{ items: LocationWithPath[] }>(`/locations/search${query({ q, level, limit: 8 })}`, { auth: false });
/** Children of a place, e.g. the barangays of one municipality. */
export const listChildren = (parent: string) => api<Page<LocationWithPath>>(`/locations${query({ parent, limit: 100 })}`, { auth: false });
export const getLocation = (code: string) => api<LocationWithPath>(`/locations/${code}`, { auth: false });
export const listWeightClasses = (species?: Species) => api<{ items: WeightClass[] }>(`/weight-classes${query({ species })}`, { auth: false });
export const getBoard = (municipality_code: string, species?: Species) => api<Board>(`/prices/board${query({ municipality_code, species })}`, { auth: false });

// Farms and lots
export const listFarms = () => api<{ items: Farm[] }>('/farms');
export const createFarm = (input: { name: string; barangay_code: string; farm_type?: string | null; address_line?: string | null; photo_keys?: string[] }) =>
  api<Farm>('/farms', { method: 'POST', body: input, idempotent: true });
export const listLots = (farmId: string) => api<{ items: Lot[] }>(`/farms/${farmId}/lots`);
export const createLot = (farmId: string, input: { species: Species; head_count: number; avg_weight_kg?: string | null; breed?: string | null; sex?: string | null; notes?: string | null; photo_keys?: string[] }) =>
  api<Lot>(`/farms/${farmId}/lots`, { method: 'POST', body: input, idempotent: true });

// Marketplace
export const listListings = (p: { species?: Species; province_code?: string; municipality_code?: string; mine?: boolean; limit?: number }) => api<Page<Listing>>(`/listings${query(p)}`);
export const getListing = (id: string) => api<Listing>(`/listings/${id}`);
export const createListing = (input: { lot_id: string; heads_offered: number; asking_price: string; pickup_window_end?: string | null }) =>
  api<Listing>('/listings', { method: 'POST', body: input, idempotent: true });
export const listOffers = (listingId: string) => api<{ items: Offer[] }>(`/listings/${listingId}/offers`);
export const makeOffer = (listingId: string, input: { price: string; heads: number; pickup_on?: string | null; needs_hauler: boolean; dropoff_location_code?: string | null; note?: string | null }) =>
  api<Offer>(`/listings/${listingId}/offers`, { method: 'POST', body: input, idempotent: true });
export const counterOffer = (offerId: string, input: { price: string; heads: number; note?: string | null }) => api<Offer>(`/offers/${offerId}/counter`, { method: 'POST', body: input, idempotent: true });
export const acceptOffer = (offerId: string) => api<Deal>(`/offers/${offerId}/accept`, { method: 'POST', idempotent: true });
export const rejectOffer = (offerId: string, note?: string) => api<Offer>(`/offers/${offerId}/reject`, { method: 'POST', body: { note: note ?? null }, idempotent: true });

// Deals
export const listDeals = (state?: DealState) => api<Page<Deal>>(`/deals${query({ state, limit: 50 })}`);
export const getDeal = (id: string) => api<Deal>(`/deals/${id}`);
export const deliverDeal = (id: string, input: { delivered_heads: number; delivered_weight_kg?: string | null; note?: string | null }) => api<Deal>(`/deals/${id}/deliver`, { method: 'POST', body: input, idempotent: true });
export const payDeal = (id: string, input: { method: 'gcash' | 'bank' | 'cash'; reference?: string | null }) => api<Deal>(`/deals/${id}/pay`, { method: 'POST', body: input, idempotent: true });
export const confirmPayment = (id: string) => api<Deal>(`/deals/${id}/confirm-payment`, { method: 'POST', idempotent: true });
export const cancelDeal = (id: string, reason: string) => api<Deal>(`/deals/${id}/cancel`, { method: 'POST', body: { reason }, idempotent: true });
export const disputeDeal = (id: string, reason: 'weight_mismatch' | 'health' | 'non_payment' | 'no_show' | 'other', details?: string) =>
  api<unknown>(`/deals/${id}/dispute`, { method: 'POST', body: { reason, details: details ?? null }, idempotent: true });
export const rateDeal = (id: string, score: number, comment?: string) => api<unknown>(`/deals/${id}/ratings`, { method: 'POST', body: { score, comment: comment ?? null } });

// Payments
export const getDeposit = (dealId: string) => api<Deposit>(`/deals/${dealId}/deposit`);
export const refreshCheckout = (dealId: string) => api<Deposit>(`/deals/${dealId}/deposit/checkout`, { method: 'POST', idempotent: true });
export const getPayoutAccount = () => api<PayoutAccount>('/me/payout-account');
export const putPayoutAccount = (input: { kind: 'gcash' | 'bank'; account_no: string; account_name: string; bank_code?: string | null }) => api<PayoutAccount>('/me/payout-account', { method: 'PUT', body: input });

// Logistics
export const getHaulerProfile = () => api<HaulerProfile>('/haulers/me');
export const putHaulerProfile = (input: { vehicle_plate: string; vehicle_type: string; capacity_heads: number; rate_per_head?: string | null; service_area?: string[] }) =>
  api<HaulerProfile>('/haulers/me', { method: 'PUT', body: input });
export const listHaulJobs = (fits?: boolean) => api<{ items: HaulJob[] }>(`/haul-jobs${query({ fits_my_truck: fits })}`);
export const acceptHaulJob = (dealId: string, input: { agreed_fee: string; scheduled_pickup_at: string }) => api<Shipment>(`/haul-jobs/${dealId}/accept`, { method: 'POST', body: input, idempotent: true });
export const listShipments = () => api<{ items: Shipment[] }>('/shipments');
export const getShipment = (id: string) => api<Shipment>(`/shipments/${id}`);
export const startTrip = (id: string, input: { shipping_permit_no: string; vet_health_cert_no: string; head_count: number; photo_keys: string[]; note?: string | null; geo?: { lat: number; lng: number } | null }) =>
  api<Shipment>(`/shipments/${id}/start`, { method: 'POST', body: input, idempotent: true });
export const pingShipment = (id: string, geo: { lat: number; lng: number }, kind: 'position' | 'checkpoint' | 'delay' | 'problem' = 'position', note?: string) =>
  api<unknown>(`/shipments/${id}/ping`, { method: 'POST', body: { geo, kind, note: note ?? null } });
export const markDelivered = (id: string, input: { note?: string | null; photo_keys?: string[]; geo?: { lat: number; lng: number } | null }) => api<Shipment>(`/shipments/${id}/delivered`, { method: 'POST', body: input, idempotent: true });
export const cancelShipment = (id: string, reason: string) => api<Shipment>(`/shipments/${id}/cancel`, { method: 'POST', body: { reason }, idempotent: true });

function deviceId(): string {
  try {
    let id = localStorage.getItem('lpb.device');
    if (!id) {
      id = uuid();
      localStorage.setItem('lpb.device', id);
    }
    return id;
  } catch {
    return 'web';
  }
}
