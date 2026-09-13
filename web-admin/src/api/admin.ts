import { api, query } from './client';
import type {
  AuditEntry,
  Health,
  Location,
  LocationWithPath,
  LoginStep,
  Page,
  ReferencePrice,
  RestrictedZone,
  Species,
  TokenPair,
  User,
  UserDocument,
  VerificationCase,
  VerificationStatus,
  WeightClass,
} from './types';

// Every console call, one function each, named after the contract's operationId.

export const adminLogin = (email: string, password: string) =>
  api<LoginStep>('/admin/auth/login', { method: 'POST', body: { email, password }, auth: false });
export const adminTotp = (step_token: string, code: string) =>
  api<TokenPair>('/admin/auth/totp', { method: 'POST', body: { step_token, code }, auth: false });
export const adminChangePassword = (current_password: string, new_password: string) =>
  api<void>('/admin/auth/password', { method: 'POST', body: { current_password, new_password } });
export const logout = (refresh_token: string) => api<void>('/auth/logout', { method: 'POST', body: { refresh_token } });
export const getMe = () => api<User>('/me');

export const health = () => api<Health>('/health', { auth: false });

export const adminVerificationQueue = (p: { role?: string; province_code?: string; cursor?: string; limit?: number }) =>
  api<Page<VerificationCase>>(`/admin/verification-queue${query(p)}`);
export const adminGetUser = (userId: string) => api<VerificationCase>(`/admin/users/${userId}`);
export const adminSetVerification = (userId: string, status: Exclude<VerificationStatus, 'pending'>, notes?: string) =>
  api<User>(`/admin/users/${userId}/verification`, { method: 'POST', body: { status, notes: notes || undefined }, idempotent: true });
export const adminReviewDocument = (documentId: string, status: 'verified' | 'rejected', notes?: string) =>
  api<UserDocument>(`/admin/documents/${documentId}/review`, { method: 'POST', body: { status, notes: notes || undefined } });
export const adminGetDocumentFile = (documentId: string) => api<{ url: string; expires_at: string }>(`/admin/documents/${documentId}/file`);

export const adminListReferencePrices = (p: { province_code?: string; species?: Species; include_history?: boolean }) =>
  api<{ items: ReferencePrice[] }>(`/admin/reference-prices${query(p)}`);
export const adminSetReferencePrice = (input: {
  province_code: string;
  species: Species;
  weight_class_id: number | null;
  unit: 'per_kg_liveweight' | 'per_head';
  price: string;
  source: string;
  effective_from: string;
}) => api<ReferencePrice>('/admin/reference-prices', { method: 'POST', body: input, idempotent: true });
export const adminImportReferencePrices = (csv: string) =>
  api<{ inserted: number; large_changes: ReferencePrice[] }>('/admin/reference-prices/import', {
    method: 'POST',
    raw: { body: csv, contentType: 'text/csv' },
  });

export const adminListRestrictedZones = (active_on?: string) => api<{ items: RestrictedZone[] }>(`/admin/restricted-zones${query({ active_on })}`);
export const adminCreateRestrictedZone = (input: { location_code: string; species: Species; reason: string; starts_on: string; ends_on?: string | null }) =>
  api<RestrictedZone>('/admin/restricted-zones', { method: 'POST', body: input, idempotent: true });
export const adminEndRestrictedZone = (zoneId: string, ends_on: string) =>
  api<RestrictedZone>(`/admin/restricted-zones/${zoneId}`, { method: 'PATCH', body: { ends_on } });

export const adminRefreshSnapshots = (date?: string) => api<{ rows: number }>('/admin/price-snapshots/refresh', { method: 'POST', body: { date, window_days: 7 } });
export const adminAuditLog = (p: { admin_id?: string; action?: string; target_id?: string; cursor?: string; limit?: number }) =>
  api<Page<AuditEntry>>(`/admin/audit-log${query(p)}`);

export const listLocations = (p: { parent?: string; level?: string; limit?: number }) => api<Page<Location>>(`/locations${query(p)}`, { auth: false });
export const searchLocations = (q: string, level?: string) => api<{ items: LocationWithPath[] }>(`/locations/search${query({ q, level, limit: 10 })}`, { auth: false });
export const listWeightClasses = (species?: Species) => api<{ items: WeightClass[] }>(`/weight-classes${query({ species })}`, { auth: false });
