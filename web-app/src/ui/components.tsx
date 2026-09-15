import { useEffect, useState, type ReactNode } from 'react';
import { searchLocations } from '../api/app';
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

/** Type-ahead over /locations/search. Returns the chosen location. */
export function LocationPicker({ level, value, onChange, placeholder }: { level?: 'municipality' | 'barangay'; value: LocationWithPath | null; onChange: (l: LocationWithPath | null) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<LocationWithPath[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      searchLocations(q.trim(), level)
        .then((r) => setHits(r.items))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, level]);
  if (value) {
    return (
      <div className="picked">
        <span>{value.display_name}</span>
        <button type="button" className="btn btn-link" onClick={() => onChange(null)}>
          change
        </button>
      </div>
    );
  }
  return (
    <div className="picker">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? 'Type the name…'} autoComplete="off" />
      {hits.length > 0 ? (
        <ul className="hits">
          {hits.map((h) => (
            <li key={h.psgc_code}>
              <button type="button" onClick={() => onChange(h)}>
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
