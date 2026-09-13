import { useEffect, useState } from 'react';
import { adminAuditLog } from '../api/admin';
import { when } from '../api/format';
import type { AuditEntry } from '../api/types';
import { Card, Empty, ErrorNote, Loading, PageHeader } from '../ui/components';

const ACTIONS = ['', 'set_verification', 'review_document', 'view_document', 'set_reference_price', 'import_reference_prices', 'create_restricted_zone', 'end_restricted_zone', 'refresh_snapshots'];

export function AuditLog() {
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = async (more: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const page = await adminAuditLog({ action: action || undefined, target_id: target.trim() || undefined, cursor: more ? cursor ?? undefined : undefined, limit: 50 });
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
  }, [action, target]);

  return (
    <>
      <PageHeader
        title="Audit log"
        sub="Every admin write, newest first, with what it changed. Reference price edits are the rows that matter most."
        actions={
          <>
            <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a || 'All actions'}
                </option>
              ))}
            </select>
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="target id" aria-label="Target id" />
          </>
        }
      />
      <ErrorNote error={error} />
      <Card>
        {loading && items.length === 0 ? <Loading /> : null}
        {!loading && items.length === 0 ? <Empty>No entries match.</Empty> : null}
        {items.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Target</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">{when(a.created_at)}</td>
                  <td>{a.admin_name}</td>
                  <td>
                    <code>{a.action}</code>
                  </td>
                  <td className="small">
                    {a.target_type} <code>{a.target_id}</code>
                  </td>
                  <td>
                    <button className="btn btn-link" onClick={() => setOpen(open === a.id ? null : a.id)}>
                      {open === a.id ? 'hide' : 'show'}
                    </button>
                    {open === a.id ? (
                      <pre className="diff">
                        {a.before !== null && a.before !== undefined ? `before: ${JSON.stringify(a.before, null, 1)}\n` : ''}
                        {a.after !== null && a.after !== undefined ? `after: ${JSON.stringify(a.after, null, 1)}` : ''}
                      </pre>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {cursor ? (
          <button className="btn btn-link" onClick={() => load(true)} disabled={loading}>
            Load older
          </button>
        ) : null}
      </Card>
    </>
  );
}
