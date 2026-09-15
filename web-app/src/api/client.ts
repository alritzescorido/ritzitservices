import type { Problem, TokenPair } from './types';

// One fetch wrapper for the whole app. It attaches the bearer token,
// refreshes it once on a 401, turns problem+json bodies into ApiError, and
// generates the Idempotency-Key the contract requires on writes.

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/v1';
const STORAGE_KEY = 'lpb.app.session';

export interface Session {
  access_token: string;
  refresh_token: string;
  user: TokenPair['user'];
}

export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem;
  constructor(status: number, problem: Problem) {
    super(problem.detail ?? problem.title);
    this.status = status;
    this.problem = problem;
  }
  /** Field errors as one readable line, for forms. */
  get fieldErrors(): string {
    return (this.problem.errors ?? []).map((e) => `${e.field}: ${e.message}`).join('; ');
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // private mode or blocked storage: the session simply does not survive a reload
  }
}

let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(fn: () => void) {
  onSessionLost = fn;
}

async function parseProblem(res: Response): Promise<Problem> {
  try {
    const body = (await res.json()) as Problem;
    if (body && typeof body.status === 'number') return body;
  } catch {
    // not JSON
  }
  return { type: 'about:blank', title: res.statusText || 'Request failed', status: res.status };
}

async function refresh(): Promise<boolean> {
  const s = loadSession();
  if (!s) return false;
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!res.ok) {
    saveSession(null);
    onSessionLost?.();
    return false;
  }
  const pair = (await res.json()) as TokenPair;
  saveSession({ access_token: pair.access_token, refresh_token: pair.refresh_token, user: pair.user });
  return true;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Raw body with its own content type (CSV import). */
  raw?: { body: string; contentType: string };
  idempotent?: boolean;
  auth?: boolean;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
    if (opts.auth !== false) {
      const s = loadSession();
      if (s) headers.Authorization = `Bearer ${s.access_token}`;
    }
    let body: string | undefined;
    if (opts.raw) {
      headers['Content-Type'] = opts.raw.contentType;
      body = opts.raw.body;
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    if (opts.idempotent) headers['Idempotency-Key'] = crypto.randomUUID();
    return fetch(`${API_BASE}${path}`, { method: opts.method ?? 'GET', headers, body });
  };

  let res = await doFetch();
  if (res.status === 401 && opts.auth !== false && loadSession()) {
    if (await refresh()) res = await doFetch();
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw new ApiError(res.status, await parseProblem(res));
  return (await res.json()) as T;
}

export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}
