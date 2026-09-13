import { useCallback, useEffect, useState } from 'react';
import { adminGetDocumentFile, adminGetUser, adminReviewDocument, adminSetVerification, adminVerificationQueue, listLocations } from '../api/admin';
import { ago, when } from '../api/format';
import { DOC_LABEL, type Location, type VerificationCase } from '../api/types';
import { Badge, Card, Empty, ErrorNote, Field, Loading, PageHeader } from '../ui/components';

const ROLES = ['', 'farmer', 'buyer', 'hauler'];

export function Verification() {
  const [role, setRole] = useState('');
  const [province, setProvince] = useState('');
  const [provinces, setProvinces] = useState<Location[]>([]);
  const [items, setItems] = useState<VerificationCase[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<VerificationCase | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    listLocations({ level: 'province', limit: 100 })
      .then((p) => setProvinces(p.items))
      .catch(() => setProvinces([]));
  }, []);

  const load = useCallback(
    async (more = false) => {
      setLoading(true);
      setError(null);
      try {
        const page = await adminVerificationQueue({ role: role || undefined, province_code: province || undefined, cursor: more ? cursor ?? undefined : undefined, limit: 25 });
        setItems((prev) => (more ? [...prev, ...page.items] : page.items));
        setCursor(page.next_cursor);
        if (!more) setSelected((s) => (s && page.items.some((i) => i.user.id === s.user.id) ? s : page.items[0] ?? null));
      } catch (e) {
        setError(e);
      } finally {
        setLoading(false);
      }
    },
    [role, province, cursor],
  );

  useEffect(() => {
    void load(false);
    // reload when filters change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, province]);

  const refreshSelected = async (userId: string) => {
    const c = await adminGetUser(userId);
    setSelected(c);
    setItems((prev) => prev.map((i) => (i.user.id === userId ? c : i)).filter((i) => i.user.verification === 'pending'));
    if (c.user.verification !== 'pending') setSelected(null);
  };

  return (
    <>
      <PageHeader
        title="Verification queue"
        sub="Users with pending documents, oldest first. Approve when the checklist is complete; reject with a note the user will read."
        actions={
          <>
            <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r ? r[0].toUpperCase() + r.slice(1) + 's' : 'All roles'}
                </option>
              ))}
            </select>
            <select value={province} onChange={(e) => setProvince(e.target.value)} aria-label="Province">
              <option value="">All provinces</option>
              {provinces.map((p) => (
                <option key={p.psgc_code} value={p.psgc_code}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        }
      />
      <ErrorNote error={error} />
      <div className="split">
        <Card className="split-list">
          {loading && items.length === 0 ? <Loading /> : null}
          {!loading && items.length === 0 ? <Empty>Nobody is waiting. New sign-ups with documents appear here.</Empty> : null}
          <ul className="queue">
            {items.map((c) => (
              <li key={c.user.id}>
                <button className={`queue-row ${selected?.user.id === c.user.id ? 'selected' : ''}`} onClick={() => setSelected(c)}>
                  <div>
                    <b>{c.user.full_name || 'No name yet'}</b>
                    <div className="muted small">
                      {c.user.roles.join(', ') || 'no role'} · {c.user.phone_masked}
                    </div>
                  </div>
                  <div className="right">
                    <div className={`small ${c.oldest_pending_at && Date.now() - new Date(c.oldest_pending_at).getTime() > 2 * 86_400_000 ? 'warn-text' : 'muted'}`}>
                      {ago(c.oldest_pending_at)}
                    </div>
                    <div className="muted small">
                      {c.documents.length} doc{c.documents.length === 1 ? '' : 's'}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {cursor ? (
            <button className="btn btn-link" onClick={() => load(true)} disabled={loading}>
              Load more
            </button>
          ) : null}
        </Card>
        <div className="split-detail">{selected ? <CaseDetail c={selected} onChanged={() => refreshSelected(selected.user.id)} /> : <Card>Select a person to review.</Card>}</div>
      </div>
    </>
  );
}

function CaseDetail({ c, onChanged }: { c: VerificationCase; onChanged: () => Promise<void> }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const view = async (id: string) => {
    try {
      const { url } = await adminGetDocumentFile(id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(e);
    }
  };

  const checklist = ['ID legible and not expired', 'Selfie matches ID', 'Permit or clearance issued by the stated office', 'Called the number, person confirmed'];
  const allChecked = checklist.every((k) => checks[k]);
  const allDocsReviewed = c.documents.length > 0 && c.documents.every((d) => d.status !== 'pending');

  return (
    <Card>
      <div className="detail-head">
        <div>
          <h2>{c.user.full_name || 'No name yet'}</h2>
          <div className="muted small">
            {c.user.roles.join(', ') || 'no role'} · {c.user.phone_masked} · joined {when(c.user.created_at)} · language {c.user.preferred_lang}
          </div>
        </div>
        <Badge status={c.user.verification}>{c.user.verification}</Badge>
      </div>
      <ErrorNote error={error} />

      <h3>Documents</h3>
      {c.documents.length === 0 ? <Empty>No documents uploaded.</Empty> : null}
      <ul className="docs">
        {c.documents.map((d) => (
          <li key={d.id} className="doc-row">
            <div>
              <b>{DOC_LABEL[d.doc_type] ?? d.doc_type}</b>
              <div className="muted small">
                uploaded {when(d.uploaded_at)}
                {d.reviewed_at ? ` · reviewed ${when(d.reviewed_at)}` : ''}
                {d.notes ? ` · note: ${d.notes}` : ''}
              </div>
            </div>
            <div className="actions">
              <Badge status={d.status}>{d.status}</Badge>
              <button className="btn btn-small" onClick={() => view(d.id)}>
                View
              </button>
              {d.status === 'pending' ? (
                <>
                  <button className="btn btn-small" disabled={busy !== null} onClick={() => act(d.id, () => adminReviewDocument(d.id, 'verified'))}>
                    Accept
                  </button>
                  <button
                    className="btn btn-small btn-danger"
                    disabled={busy !== null}
                    onClick={() => {
                      const why = window.prompt('Why is this document rejected? The user will read this.', 'Photo is blurry, please retake in daylight.');
                      if (why) void act(d.id, () => adminReviewDocument(d.id, 'rejected', why));
                    }}
                  >
                    Reject
                  </button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {c.farms.length > 0 ? (
        <>
          <h3>Farms</h3>
          <ul className="plain">
            {c.farms.map((f) => (
              <li key={f.id}>
                <b>{f.name}</b> <span className="muted small">· {f.location.display_name}</span>
                {f.lot_summary.length ? (
                  <span className="muted small"> · {f.lot_summary.map((s) => `${s.heads} ${s.species}`).join(', ')}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3>Checklist</h3>
      <ul className="plain">
        {checklist.map((k) => (
          <li key={k}>
            <label className="check">
              <input type="checkbox" checked={!!checks[k]} onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })} /> {k}
            </label>
          </li>
        ))}
      </ul>

      <Field label="Note (shown to the user when rejected, kept in the audit log otherwise)">
        <textarea id={`notes-${c.user.id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. permit photo blurry, asked for a resend" />
      </Field>

      <div className="actions actions-end">
        <button className="btn btn-danger" disabled={busy !== null || !notes.trim()} title={!notes.trim() ? 'A rejection needs a note the user can act on' : ''} onClick={() => act('reject', () => adminSetVerification(c.user.id, 'rejected', notes.trim()))}>
          Reject with note
        </button>
        <button
          className="btn btn-primary"
          disabled={busy !== null || !allChecked || !allDocsReviewed}
          title={!allDocsReviewed ? 'Review every document first' : !allChecked ? 'Tick the checklist first' : ''}
          onClick={() => act('verify', () => adminSetVerification(c.user.id, 'verified', notes.trim() || undefined))}
        >
          {busy === 'verify' ? 'Saving…' : `Verify ${c.user.roles[0] ?? 'user'}`}
        </button>
      </div>
    </Card>
  );
}
