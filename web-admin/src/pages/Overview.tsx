import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminAuditLog, adminListDisputes, adminListReferencePrices, adminRefreshSnapshots, adminVerificationQueue, health } from '../api/admin';
import { day, when } from '../api/format';
import type { AuditEntry, Health } from '../api/types';
import { Badge, Card, ErrorNote, PageHeader } from '../ui/components';

// What the wireframe's Overview promised that the API can already answer:
// system health, the verification backlog, reference price coverage, and the
// latest admin actions. Deal volume and live-price coverage arrive with the
// Phase 4 reports endpoints.
export function Overview() {
  const [h, setH] = useState<Health | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [oldest, setOldest] = useState<string | null>(null);
  const [refCount, setRefCount] = useState<number | null>(null);
  const [openDisputes, setOpenDisputes] = useState<number | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState<number | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [hh, q, refs, a, ds] = await Promise.all([
        health(),
        adminVerificationQueue({ limit: 100 }),
        adminListReferencePrices({}),
        adminAuditLog({ limit: 8 }),
        adminListDisputes('open'),
      ]);
      setH(hh);
      setPending(q.items.length + (q.next_cursor ? 100 : 0));
      setOldest(q.items[0]?.oldest_pending_at ?? null);
      setRefCount(refs.items.length);
      setAudit(a.items);
      setOpenDisputes(ds.items.length);
    } catch (e) {
      setError(e);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await adminRefreshSnapshots();
      setRefreshed(r.rows);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Overview"
        sub="Is the board healthy, and what is waiting on an admin."
        actions={
          <button className="btn" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Recomputing…' : 'Recompute snapshots now'}
          </button>
        }
      />
      <ErrorNote error={error} />
      {refreshed !== null ? <div className="note">Snapshot job wrote {refreshed} rows. It also runs every day at 5:00 AM.</div> : null}
      <div className="tiles">
        <Card>
          <div className="tile-label">API and database</div>
          <div className="tile-value">{h ? <Badge status={h.status === 'ok' ? 'ok' : 'warn'}>{h.status}</Badge> : '…'}</div>
          <div className="muted small">{h?.db}</div>
        </Card>
        <Card>
          <div className="tile-label">Last price snapshot</div>
          <div className="tile-value">{h ? (h.last_snapshot_date ? day(h.last_snapshot_date) : 'none yet') : '…'}</div>
          <div className="muted small">Nightly at 5:00 AM Manila, and after every settlement from Phase 2</div>
        </Card>
        <Card>
          <div className="tile-label">Waiting for verification</div>
          <div className="tile-value">{pending === null ? '…' : pending >= 100 ? '100+' : pending}</div>
          <div className="muted small">{oldest ? `oldest since ${when(oldest)}` : 'queue is empty'}</div>
          <Link to="/verification" className="small">
            Open the queue
          </Link>
        </Card>
        <Card>
          <div className="tile-label">Open disputes</div>
          <div className="tile-value">{openDisputes ?? '…'}</div>
          <div className="muted small">deals frozen until an admin decides</div>
          <Link to="/disputes" className="small">
            Resolve
          </Link>
        </Card>
        <Card>
          <div className="tile-label">Reference prices in force</div>
          <div className="tile-value">{refCount ?? '…'}</div>
          <div className="muted small">rows shown to farmers where a municipality has no live trade</div>
          <Link to="/reference-prices" className="small">
            Manage
          </Link>
        </Card>
      </div>
      <Card title="Recent admin actions">
        {audit.length === 0 ? (
          <p className="empty">Nothing yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">{when(a.created_at)}</td>
                  <td>{a.admin_name}</td>
                  <td>
                    <code>{a.action}</code>
                  </td>
                  <td className="muted small">
                    {a.target_type} {a.target_id.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Link to="/audit-log" className="small">
          Full audit log
        </Link>
      </Card>
    </>
  );
}
