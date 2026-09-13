// Display helpers. Everything the API sends is text; these only make it readable.

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
const dateOnly = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' });

export function money(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? peso.format(n) : String(v);
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTime.format(d);
}

export function day(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const d = new Date(`${ymd}T00:00:00+08:00`);
  return Number.isNaN(d.getTime()) ? ymd : dateOnly.format(d);
}

/** "3 days", "6 hours", "12 min" since an RFC 3339 timestamp. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} hours`;
  return `${Math.floor(h / 24)} days`;
}

export function todayManila(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function unitLabel(unit: 'per_kg_liveweight' | 'per_head'): string {
  return unit === 'per_head' ? '/head' : '/kg';
}
