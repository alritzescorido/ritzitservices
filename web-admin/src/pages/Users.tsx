import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminListUsers } from '../api/admin';
import { ago, when } from '../api/format';
import type { AdminUserRow } from '../api/types';
import { Badge, Card, Empty, ErrorNote, Loading, PageHeader } from '../ui/components';

// Everyone on the platform, with the facts an admin asks for first: who they
// are, what they are, whether they are verified, how active they have been.
// Verification decisions stay on the Verification screen; this page links there.

const ROLES = ['', 'farmer', 'buyer', 'hauler', 'admin'];
const STATUSES = ['', 'pending', 'verified', 'rejected', 'suspended'];

export function Users() {
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<AdminUserRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = async (more: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const page = await adminListUsers({ role: role || undefined, verification: status || undefined, q: q.trim() || undefined, cursor: more ? cursor ?? undefined : undefined, limit: 50 });
      setItems((prev) => (more ? [...prev, ...page.items] : page.items));
      setCursor(page.next_cursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => void load(false), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, status, q]);

  return (
    <>
      <PageHeader
        title="Users"
        sub="Everyone who has signed in, newest first. Open a pending person to verify them."
        actions={
          <>
            <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r || 'All roles'}
                </option>
              ))}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Verification">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s || 'Any status'}
                </option>
              ))}
            </select>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name or phone" aria-label="Search" />
          </>
        }
      />
      <ErrorNote error={error} />
      <Card>
        {loading && items.length === 0 ? <Loading /> : null}
        {!loading && items.length === 0 ? <Empty>No one matches.</Empty> : null}
        {items.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Roles</th>
                <th>Province</th>
                <th>Status</th>
                <th className="right">Deals</th>
                <th>Last seen</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.verification === 'pending' && !u.roles.includes('admin') ? <Link to={`/verification?user=${u.id}`}>{u.full_name}</Link> : u.full_name}
                  </td>
                  <td className="nowrap">{u.phone_masked}</td>
                  <td>{u.roles.join(', ') || '—'}</td>
                  <td>{u.province_name ?? '—'}</td>
                  <td>
                    <Badge status={u.verification}>{u.verification}</Badge>
                  </td>
                  <td className="right">{u.deals_count}</td>
                  <td className="nowrap muted small">{u.last_seen_at ? ago(u.last_seen_at) : '—'}</td>
                  <td className="nowrap muted small">{when(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {cursor ? (
          <button className="btn btn-link" onClick={() => load(true)} disabled={loading}>
            Load more
          </button>
        ) : null}
      </Card>
    </>
  );
}
