import type { ReactNode } from 'react';
import { ApiError } from '../api/client';
import type { VerificationStatus } from '../api/types';

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="muted">{sub}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
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
        <b>{error.problem.title}.</b> {error.problem.detail}
        {error.problem.errors?.length ? (
          <ul>
            {error.problem.errors.map((e, i) => (
              <li key={i}>
                <code>{e.field}</code> {e.message}
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

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Loading() {
  return <p className="muted">Loading…</p>;
}
