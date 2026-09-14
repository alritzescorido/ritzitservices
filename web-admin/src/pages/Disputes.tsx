import { useEffect, useState, type FormEvent } from 'react';
import { adminListDisputes, adminResolveDispute, getDeal } from '../api/admin';
import { ago, money, when } from '../api/format';
import { DISPUTE_REASON, type Deal, type Dispute, type DisputeStatus } from '../api/types';
import { Badge, Card, Empty, ErrorNote, Field, Loading, PageHeader } from '../ui/components';
import { DealTimeline, DealFacts } from './Deals';

const FILTERS: { value: DisputeStatus | ''; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'under_review', label: 'Under review' },
  { value: '', label: 'All' },
];

export function Disputes() {
  const [filter, setFilter] = useState<DisputeStatus | ''>('open');
  const [items, setItems] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Dispute | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = async (keep?: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminListDisputes(filter || undefined);
      setItems(r.items);
      setSelected(r.items.find((d) => d.id === keep) ?? r.items[0] ?? null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <>
      <PageHeader
        title="Disputes"
        sub="A deal in dispute is frozen: its price does not enter the board until resolved. Evidence from both parties sits side by side."
        actions={
          <div className="segmented">
            {FILTERS.map((f) => (
              <button key={f.value} className={`btn btn-small ${filter === f.value ? 'btn-primary' : ''}`} onClick={() => setFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
        }
      />
      <ErrorNote error={error} />
      <div className="split split-wide">
        <Card className="split-list">
          {loading && items.length === 0 ? <Loading /> : null}
          {!loading && items.length === 0 ? <Empty>No disputes {filter ? `that are ${filter.replace('_', ' ')}` : 'yet'}.</Empty> : null}
          <ul className="queue">
            {items.map((d) => (
              <li key={d.id}>
                <button className={`queue-row ${selected?.id === d.id ? 'selected' : ''}`} onClick={() => setSelected(d)}>
                  <div>
                    <b>
                      {DISPUTE_REASON[d.reason] ?? d.reason} · {d.deal.species} × {d.deal.agreed_heads}
                    </b>
                    <div className="muted small">
                      {d.deal.farmer_name} vs {d.deal.buyer_name} · opened by {d.raised_by_role} · {money(d.deal.estimated_total)} at stake
                    </div>
                  </div>
                  <div className="right">
                    <Badge status={d.status === 'open' ? 'warn' : d.status === 'under_review' ? 'info' : 'muted'}>{d.status.replace('_', ' ')}</Badge>
                    <div className="muted small">{ago(d.created_at)}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <div className="split-detail">{selected ? <DisputeDetail d={selected} onChanged={() => load(selected.id)} /> : <Card>Select a dispute.</Card>}</div>
      </div>
    </>
  );
}

function DisputeDetail({ d, onChanged }: { d: Dispute; onChanged: () => Promise<void> }) {
  const [deal, setDeal] = useState<Deal>(d.deal);
  const [outcome, setOutcome] = useState<'settled' | 'refunded' | 'dismissed'>('settled');
  const [depositChoice, setDepositChoice] = useState<'' | 'release_to_farmer' | 'refund_to_buyer' | 'hold'>('');
  const [weight, setWeight] = useState('');
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setDeal(d.deal);
    setResolution('');
    setWeight('');
    getDeal(d.deal_id)
      .then(setDeal)
      .catch(() => undefined);
  }, [d]);

  const open = d.status === 'open' || d.status === 'under_review';
  const price = Number(deal.agreed_price);
  const perHead = deal.unit === 'per_head';
  const declared = perHead ? price * deal.agreed_heads : deal.agreed_weight_kg ? price * Number(deal.agreed_weight_kg) : null;
  const buyerFigure = perHead ? (deal.delivered_heads ?? null) : deal.delivered_weight_kg ? Number(deal.delivered_weight_kg) : null;
  const buyerTotal = buyerFigure === null ? null : price * buyerFigure;
  const proposedTotal = weight && !perHead ? price * Number(weight) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminResolveDispute(d.id, { outcome, resolution: resolution.trim(), delivered_weight_kg: outcome === 'settled' && weight ? weight : undefined, deposit: depositChoice || undefined });
      await onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="detail-head">
        <div>
          <h2>
            {DISPUTE_REASON[d.reason] ?? d.reason} · deal {d.deal_id.slice(0, 8)}
          </h2>
          <div className="muted small">
            Opened by the {d.raised_by_role} {when(d.created_at)} · {deal.farmer_name} (farmer) vs {deal.buyer_name} (buyer)
          </div>
        </div>
        <Badge status={d.status === 'open' ? 'warn' : 'muted'}>{d.status.replace('_', ' ')}</Badge>
      </div>
      {d.details ? <p className="note">{d.details}</p> : null}
      <ErrorNote error={error} />

      <h3>What each side says</h3>
      <div className="tiles tiles-3">
        <div className="fact">
          <div className="tile-label">Farmer declared</div>
          <div className="tile-value">{perHead ? `${deal.agreed_heads} heads` : `${deal.agreed_weight_kg ?? '—'} kg`}</div>
          <div className="muted small">{declared === null ? '' : `${money(declared)} at ${money(deal.agreed_price)}`}</div>
        </div>
        <div className="fact">
          <div className="tile-label">Buyer received</div>
          <div className="tile-value warn-text">{perHead ? `${deal.delivered_heads ?? '—'} heads` : `${deal.delivered_weight_kg ?? '—'} kg`}</div>
          <div className="muted small">{buyerTotal === null ? 'no figure recorded' : money(buyerTotal)}</div>
        </div>
        <div className="fact">
          <div className="tile-label">Payment</div>
          <div className="tile-value">{deal.payment_method ?? 'none yet'}</div>
          <div className="muted small">{deal.payment_reference ? `ref ${deal.payment_reference}` : deal.buyer_paid_at ? when(deal.buyer_paid_at) : 'buyer has not recorded a payment'}</div>
        </div>
      </div>
      {deal.delivery_note ? (
        <p className="small">
          <b>Buyer's delivery note:</b> {deal.delivery_note}
        </p>
      ) : null}

      <DealFacts deal={deal} />
      <h3>Timeline</h3>
      <DealTimeline events={deal.events ?? []} />

      {open ? (
        <form onSubmit={submit} className="stack" style={{ marginTop: 16 }}>
          <h3>Resolve</h3>
          <div className="stack">
            <label className="choice">
              <input type="radio" name="outcome" checked={outcome === 'settled'} onChange={() => setOutcome('settled')} />
              <div>
                <b>Settle</b> <span className="muted small">the deal stands and its price joins the board{!perHead ? ', optionally at a corrected weight' : ''}</span>
              </div>
            </label>
            {outcome === 'settled' && !perHead ? (
              <Field label="Corrected weight, kg (leave empty to keep the buyer's figure)" hint={proposedTotal !== null ? `= ${money(proposedTotal)} at ${money(deal.agreed_price)}/kg` : undefined}>
                <input id={`w-${d.id}`} type="number" min="0.01" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} />
              </Field>
            ) : null}
            <label className="choice">
              <input type="radio" name="outcome" checked={outcome === 'refunded'} onChange={() => setOutcome('refunded')} />
              <div>
                <b>Refund</b> <span className="muted small">the deal ends, buyer is refunded off-platform, price excluded from the board</span>
              </div>
            </label>
            <label className="choice">
              <input type="radio" name="outcome" checked={outcome === 'dismissed'} onChange={() => setOutcome('dismissed')} />
              <div>
                <b>Dismiss</b> <span className="muted small">no grounds; the deal returns to delivered so payment can finish</span>
              </div>
            </label>
          </div>
          {deal.deposit && deal.deposit.status === 'paid' ? (
            <Field label={`Booking deposit of ${money(deal.deposit.amount)}, paid by the buyer`} hint="Leave on the default and it follows the outcome: settle releases it to the farmer, refund returns it to the buyer, dismiss holds it.">
              <select id={`dep-${d.id}`} value={depositChoice} onChange={(e) => setDepositChoice(e.target.value as typeof depositChoice)}>
                <option value="">Follow the outcome</option>
                <option value="release_to_farmer">Release to the farmer</option>
                <option value="refund_to_buyer">Refund to the buyer</option>
                <option value="hold">Hold for now</option>
              </select>
            </Field>
          ) : null}
          <Field label="Decision note (both parties read this)">
            <textarea id={`r-${d.id}`} rows={3} required minLength={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="e.g. No scale at pickup, so neither weight is proven. 2% shrink is our published allowance for trips over 3 hours." />
          </Field>
          <div className="actions actions-end">
            <button className="btn btn-primary" disabled={busy || resolution.trim().length < 3}>
              {busy ? 'Saving…' : `Resolve as ${outcome}`}
            </button>
          </div>
        </form>
      ) : (
        <div className="note" style={{ marginTop: 16 }}>
          <b>Resolved {when(d.resolved_at)}:</b> {d.resolution}
        </div>
      )}
    </Card>
  );
}
