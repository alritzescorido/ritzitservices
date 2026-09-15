import { useEffect, useState, type ReactNode } from 'react';
import { listChildren, searchLocations } from '../api/app';
import { ApiError } from '../api/client';
import { money } from '../api/format';
import type { BoardRow, LocationWithPath, VerificationStatus } from '../api/types';

export function Screen({ title, sub, actions, children }: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <h1>{title}</h1>
          {sub ? <p className="muted small">{sub}</p> : null}
        </div>
        {actions ? <div className="actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function Card({ title, children, className = '', onClick }: { title?: ReactNode; children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <section className={`card ${onClick ? 'card-tap' : ''} ${className}`} onClick={onClick}>
      {title ? <h2 className="card-title">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Badge({ status, children }: { status: VerificationStatus | 'ok' | 'warn' | 'info' | 'muted'; children: ReactNode }) {
  return <span className={`badge badge-${status}`}>{children}</span>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  if (error instanceof ApiError) {
    return (
      <div className="note note-error" role="alert">
        {error.problem.detail ?? error.problem.title}
        {error.problem.errors?.length ? (
          <ul>
            {error.problem.errors.map((e, i) => (
              <li key={i}>
                <b>{e.field}</b>: {e.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  return (
    <div className="note note-error" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint muted small">{hint}</span> : null}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Loading() {
  return <p className="muted center">Loading…</p>;
}

/** A price with its provenance. The contract calls a bare number a defect. */
export function Price({ row }: { row: BoardRow }) {
  const src = row.source === 'municipality' ? `${row.sample_count} sales in ${row.location_name}` : row.source === 'province' ? `${row.sample_count} sales across ${row.location_name}` : `reference price${row.reference_source ? `, ${row.reference_source}` : ''}`;
  const change = row.change_30d_pct;
  return (
    <div className="price">
      <div className="price-main">
        <span className="price-value">{money(row.median_price)}</span>
        <span className="muted small">{row.unit === 'per_head' ? '/ulo' : '/kg'}</span>
        {change !== null && change !== 0 ? <span className={`small ${change > 0 ? 'up' : 'down'}`}>{change > 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% 30d</span> : null}
      </div>
      <div className="muted small">
        {src}
        {row.low_price && row.high_price && row.source !== 'reference' ? ` · ${money(row.low_price)} to ${money(row.high_price)}` : ''}
      </div>
    </div>
  );
}

/**
 * Picks a place. Municipalities are searched by name, which is distinctive.
 * Barangays are picked in two steps, because hundreds of barangays share a
 * name: "Poblacion" alone cannot find the one in Lake Sebu, so the town comes
 * first and its barangays are then listed in full.
 */
export function LocationPicker({ level, value, onChange, placeholder }: { level?: 'municipality' | 'barangay'; value: LocationWithPath | null; onChange: (l: LocationWithPath | null) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<LocationWithPath[]>([]);
  const [town, setTown] = useState<LocationWithPath | null>(null);
  const [barangays, setBarangays] = useState<LocationWithPath[] | null>(null);
  const twoStep = level === 'barangay';
  const searchLevel = twoStep ? 'municipality' : level;

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      searchLocations(q.trim(), searchLevel)
        .then((r) => setHits(r.items))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, searchLevel]);

  useEffect(() => {
    if (!town) {
      setBarangays(null);
      return;
    }
    let live = true;
    listChildren(town.psgc_code)
      .then((r) => live && setBarangays(r.items))
      .catch(() => live && setBarangays([]));
    return () => {
      live = false;
    };
  }, [town]);

  const reset = () => {
    onChange(null);
    setTown(null);
    setQ('');
  };

  if (value) {
    return (
      <div className="picked">
        <span>{value.display_name}</span>
        <button type="button" className="btn btn-link" onClick={reset}>
          change
        </button>
      </div>
    );
  }

  // Step two: the town is chosen, list its barangays.
  if (twoStep && town) {
    return (
      <div className="stack">
        <div className="picked">
          <span>{town.display_name}</span>
          <button type="button" className="btn btn-link" onClick={() => setTown(null)}>
            change town
          </button>
        </div>
        {barangays === null ? (
          <p className="muted small">Loading barangays…</p>
        ) : barangays.length === 0 ? (
          <p className="muted small">No barangays listed for this town.</p>
        ) : (
          <select
            id={`brgy-${town.psgc_code}`}
            defaultValue=""
            onChange={(e) => {
              const b = barangays.find((x) => x.psgc_code === e.target.value);
              if (b) onChange(b);
            }}
          >
            <option value="" disabled>
              Choose your barangay ({barangays.length})
            </option>
            {barangays.map((b) => (
              <option key={b.psgc_code} value={b.psgc_code}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }

  return (
    <div className="picker">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? (twoStep ? 'Municipality or city…' : 'Type the name…')} autoComplete="off" />
      {twoStep && q.trim().length < 2 ? <span className="field-hint muted small">Search your town or city first, then pick the barangay.</span> : null}
      {hits.length > 0 ? (
        <ul className="hits">
          {hits.map((h) => (
            <li key={h.psgc_code}>
              <button type="button" onClick={() => (twoStep ? setTown(h) : onChange(h))}>
                {h.display_name} <span className="muted small">{h.level}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Remembers the farmer's or buyer's home municipality on this device. */
export function useHomeLocation(): [LocationWithPath | null, (l: LocationWithPath | null) => void] {
  const [loc, setLoc] = useState<LocationWithPath | null>(() => {
    try {
      const raw = localStorage.getItem('lpb.home');
      return raw ? (JSON.parse(raw) as LocationWithPath) : null;
    } catch {
      return null;
    }
  });
  const set = (l: LocationWithPath | null) => {
    setLoc(l);
    try {
      if (l) localStorage.setItem('lpb.home', JSON.stringify(l));
      else localStorage.removeItem('lpb.home');
    } catch {
      // storage blocked: the choice lives for this page only
    }
  };
  return [loc, set];
}
