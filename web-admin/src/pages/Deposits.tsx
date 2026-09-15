import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminListDeposits } from '../api/admin';
import { money, when } from '../api/format';
import type { Deposit, DepositStatus, DepositTotals } from '../api/types';
import { Badge, Card, Empty, ErrorNote, Loading, PageHeader } from '../ui/components';

// Booking deposits and the money they represent. "Held" is what the gateway
// wallet must contain right now; a failed transfer is the row that needs a
// human.

const STATUSES: ('' | DepositStatus)[] = ['', 'pending', 'paid', 'released', 'forfeited', 'refunded', 'lapsed'];
const TONE: Record<DepositStatus, 'ok' | 'warn' | 'info' | 'muted' | 'pending'> = {
  pending: 'pending',
  paid: 'info',
  released: 'ok',
  forfeited: 'ok',
  refunded: 'muted',
  lapsed: 'muted',
};

export function Deposits() {
  const [status, setStatus] = useState<'' | DepositStatus>('');
  const [items, setItems] = useState<Deposit[]>([]);
  const [totals, setTotals] = useState<DepositTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    adminListDeposits(status || undefined)
      .then((r) => {
        if (!live) return;
        setItems(r.items);
        setTotals(r.totals);
      })
      .catch((e) => live && setError(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [status]);

  const failed = items.filter((d) => d.transfer_status === 'failed' || (d.failure_reason && d.status !== 'lapsed' && !d.transfer_status));

  return (
    <>
      <PageHeader
        title="Deposits"
        sub="Booking deposits paid through the gateway: what is held, what went to farmers, what went back to buyers. Failed payouts need a human."
        actions={
          <select value={status} onChange={(e) => setStatus(e.target.value as '' | DepositStatus)} aria-label="Status">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || 'All'}
              </option>
            ))}
          </select>
        }
      />
      <ErrorNote error={error} />
      {totals ? (
        <div className="tiles">
          <Card>
            <div className="tile-label">Held in the wallet</div>
            <div className="tile-value">{money(totals.held)}</div>
            <div className="muted small">net of gateway fees, for deals still open · {totals.pending_count} waiting for payment</div>
          </Card>
          <Card>
            <div className="tile-label">Owed to farmers</div>
            <div className="tile-value">{money(totals.owed_to_farmers)}</div>
            <div className="muted small">
              promised on open deals. The {money(String(Number(totals.owed_to_farmers) - Number(totals.held)))} gap against the wallet is the gateway fee the platform absorbs
            </div>
          </Card>
          <Card>
            <div className="tile-label">Commission earned</div>
            <div className="tile-value">{money(totals.commission_earned)}</div>
            <div className="muted small">on deals that settled. A failed deal earns nothing</div>
          </Card>
          <Card>
            <div className="tile-label">Released to farmers</div>
            <div className="tile-value">{money(totals.released)}</div>
            <div className="muted small">on settlement, as part payment</div>
          </Card>
          <Card>
            <div className="tile-label">Forfeited to farmers</div>
            <div className="tile-value">{money(totals.forfeited)}</div>
            <div className="muted small">buyer cancelled after booking</div>
          </Card>
          <Card>
            <div className="tile-label">Refunded to buyers</div>
            <div className="tile-value">{money(totals.refunded)}</div>
            <div className="muted small">farmer cancelled, or admin decided</div>
          </Card>
        </div>
      ) : null}
      {failed.length > 0 ? (
        <div className="note note-error">
          <b>{failed.length} payout(s) need attention:</b> {failed.map((d) => `${d.farmer_name} (${money(d.net ?? d.amount)}: ${d.failure_reason ?? 'transfer failed'})`).join('; ')}
        </div>
      ) : null}
      <Card>
        {loading && items.length === 0 ? <Loading /> : null}
        {!loading && items.length === 0 ? <Empty>No deposits{status ? ` with status ${status}` : ' yet'}.</Empty> : null}
        {items.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Requested</th>
                <th>Deal</th>
                <th>Buyer → farmer</th>
                <th className="right">Charged</th>
                <th className="right">Booking</th>
                <th className="right">Commission</th>
                <th className="right">Gateway fee</th>
                <th>Status</th>
                <th>Payout</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <td className="nowrap">{when(d.created_at)}</td>
                  <td>
                    <Link to={`/deals?deal=${d.deal_id}`}>
                      <code>{d.deal_id.slice(0, 8)}</code>
                    </Link>
                  </td>
                  <td>
                    {d.buyer_name} → {d.farmer_name}
                  </td>
                  <td className="right">{money(d.amount)}</td>
                  <td className="right">{money(d.booking)}</td>
                  <td className="right">{Number(d.commission) > 0 ? money(d.commission) : '—'}</td>
                  <td className="right muted">{d.fee ? money(d.fee) : '—'}</td>
                  <td>
                    <Badge status={TONE[d.status]}>{d.status}</Badge>
                    <div className="muted small">{d.status === 'pending' ? `pay by ${when(d.expires_at)}` : d.paid_at ? `paid ${when(d.paid_at)}${d.payment_method ? ` by ${d.payment_method}` : ''}` : d.failure_reason ?? ''}</div>
                  </td>
                  <td className="small">
                    {d.transfer_status === 'succeeded' ? <Badge status="ok">sent</Badge> : d.transfer_status === 'failed' ? <Badge status="warn">failed</Badge> : d.transfer_status === 'pending' ? <Badge status="pending">waiting</Badge> : '—'}
                    {d.transfer_status && d.failure_reason ? <div className="muted">{d.failure_reason}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </>
  );
}
