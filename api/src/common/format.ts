// Wire formats the contract fixes: money and weights as decimal strings, dates
// as YYYY-MM-DD, timestamps as RFC 3339 UTC. Both database engines are told to
// hand us text for these types, so these helpers only normalise.

export function money(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

export function weight(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return String(Math.round(n * 100) / 100);
}

export function dateOnly(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export function isoTime(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

export function int(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** +639171234567 -> +63917*****67, as the contract's example shows. */
export function maskPhone(e164: string): string {
  const local = e164.replace(/^\+63/, '');
  if (local.length < 10) return e164.slice(0, 4) + '*'.repeat(Math.max(0, e164.length - 6)) + e164.slice(-2);
  return `+63${local.slice(0, 3)}*****${local.slice(-2)}`;
}
