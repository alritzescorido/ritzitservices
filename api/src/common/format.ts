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

/**
 * Postgres renders timestamptz as "2026-09-13 14:00:00.123456+08", which
 * JavaScript will not parse: the space, the microseconds and the bare "+08"
 * offset all have to be normalised before Date can read it.
 */
export function isoTime(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  let s = String(v).trim().replace(' ', 'T');
  s = s.replace(/(\.\d{3})\d+/, '$1'); // microseconds -> milliseconds
  s = s.replace(/([+-]\d{2})$/, '$1:00'); // +08 -> +08:00
  if (!/[Zz]$|[+-]\d{2}:\d{2}$/.test(s)) s += 'Z'; // timestamp without time zone is UTC by convention here
  const d = new Date(s);
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
