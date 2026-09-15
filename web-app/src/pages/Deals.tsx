import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cancelDeal, confirmPayment, deliverDeal, disputeDeal, getDeal, getDeposit, listDeals, payDeal, rateDeal, refreshCheckout } from '../api/app';
import { ago, day, money, unitLabel, when } from '../api/format';
import { SPECIES_LABEL, type Deal, type Deposit } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, Empty, ErrorNote, Field, Loading, Screen } from '../ui/components';

// Wireframes Deal and BuyerReceive. One list for both sides; the detail shows
// the steps that are the reader's to take next: pay the deposit, confirm the
// count and weight, record the payment, confirm it arrived, rate.
const TONE: Record<Deal['state'], 'ok' | 'warn' | 'info' | 'muted'> = { accepted: 'info', hauler_assigned: 'info', in_transit: 'info', delivered: 'warn', settled: 'ok', disputed: 'warn', refunded: 'muted', cancelled: 'muted' };
const STATE_FIL: Record<Deal['state'], string> = { accepted: 'napagkasunduan', hauler_assigned: 'may hauler', in_transit: 'biyahe', delivered: 'naihatid', settled: 'bayad na', disputed: 'may reklamo', refunded: 'na-refund', cancelled: 'kanselado' };

export function Deals() {
  const { id } = useParams();
  const nav = useNavigate();
  const [items, setItems] = useState<Deal[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (id) return;
    listDeals()
      .then((r) => setItems(r.items))
      .catch(setError);
  }, [id]);
  if (id) return <DealDetail id={id} onBack={() => nav('/deals')} />;
  return (
    <Screen title="Deals" sub="Every agreed sale, newest first.">
      <ErrorNote error={error} />
      {items === null ? <Loading /> : null}
      {items && items.length === 0 ? <Empty>No deals yet. A deal starts when an offer is accepted.</Empty> : null}
      {items?.map((d) => (
        <Card key={d.id} onClick={() => nav(`/deals/${d.id}`)}>
          <div className="between">
            <b>
              {SPECIES_LABEL[d.species]} {d.weight_class?.label ?? ''} × {d.agreed_heads}
            </b>
            <Badge status={TONE[d.state]}>{STATE_FIL[d.state]}</Badge>
          </div>
          <div className="muted small">
            {money(d.agreed_price)}
            {unitLabel(d.unit)} · {d.farmer_name} → {d.buyer_name} · {ago(d.accepted_at)} ago
          </div>
          {d.deposit && d.deposit.status === 'pending' ? <div className="small warn-text">Deposit {money(d.deposit.amount)} due by {when(d.deposit.expires_at)}</div> : null}
        </Card>
      ))}
    </Screen>
  );
}

function DealDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { user } = useAuth();
  const [d, setD] = useState<Deal | null>(null);
  const [dep, setDep] = useState<Deposit | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setError(null);
    try {
      const deal = await getDeal(id);
      setD(deal);
      if (deal.deposit_required) setDep(await getDeposit(id).catch(() => null));
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (!d) return <Screen title="Deal">{error ? <ErrorNote error={error} /> : <Loading />}</Screen>;
  const isFarmer = d.farmer_id === user?.id;
  const isBuyer = d.buyer_id === user?.id;
  const perHead = d.unit === 'per_head';

  return (
    <Screen
      title={`${SPECIES_LABEL[d.species]} ${d.weight_class?.label ?? ''} × ${d.agreed_heads}`}
      sub={`${money(d.agreed_price)}${unitLabel(d.unit)} · ${d.farmer_name} → ${d.buyer_name}`}
      actions={
        <button className="btn btn-small" onClick={onBack}>
          ‹ Back
        </button>
      }
    >
      <ErrorNote error={error} />
      <Card>
        <div className="between">
          <Badge status={TONE[d.state]}>{STATE_FIL[d.state]}</Badge>
          <span className="muted small">{d.location.display_name}</span>
        </div>
        <table className="facts" style={{ marginTop: 8 }}>
          <tbody>
            <tr>
              <th>Agreed</th>
              <td>
                {money(d.agreed_price)}
                {unitLabel(d.unit)} × {d.agreed_heads}
                {d.agreed_weight_kg ? ` · ${d.agreed_weight_kg} kg declared` : ''}
                {d.estimated_total ? ` · est. ${money(d.estimated_total)}` : ''}
              </td>
            </tr>
            {d.delivered_heads !== null ? (
              <tr>
                <th>Delivered</th>
                <td>
                  {d.delivered_heads} heads{d.delivered_weight_kg ? ` · ${d.delivered_weight_kg} kg weighed` : ''} · {money(d.final_total)}
                </td>
              </tr>
            ) : null}
            <tr>
              <th>Hauling</th>
              <td>
                {!d.needs_hauler ? 'buyer brings own truck' : d.shipment ? `${d.shipment.hauler_name}${d.shipment.vehicle_plate ? ` (${d.shipment.vehicle_plate})` : ''} · ${d.shipment.status.replace('_', ' ')}${d.shipment.picked_up_at ? ` · ${d.shipment.head_count_at_pickup} loaded ${when(d.shipment.picked_up_at)}` : d.shipment.scheduled_pickup_at ? ` · pickup ${when(d.shipment.scheduled_pickup_at)}` : ''}` : 'waiting for a hauler'}
                {d.dropoff ? ` → ${d.dropoff.display_name}` : ''}
              </td>
            </tr>
            {d.deposit_required ? (
              <tr>
                <th>Deposit</th>
                <td>{d.deposit ? `${money(d.deposit.amount)}${Number(d.deposit.commission) > 0 ? ` (${money(d.deposit.booking)} deposit plus ${money(d.deposit.commission)} platform fee)` : ''} · ${d.deposit.status}${d.deposit.paid_at ? ` ${when(d.deposit.paid_at)}` : d.deposit.status === 'pending' ? ` · pay by ${when(d.deposit.expires_at)}` : ''}` : 'being prepared'}</td>
              </tr>
            ) : null}
            {d.payment_method ? (
              <tr>
                <th>Balance</th>
                <td>
                  {d.payment_method}
                  {d.payment_reference ? ` ref ${d.payment_reference}` : ''} · {when(d.buyer_paid_at)}
                  {d.farmer_confirmed_at ? ` · confirmed ${when(d.farmer_confirmed_at)}` : ' · not yet confirmed by the farmer'}
                </td>
              </tr>
            ) : null}
            {d.cancel_reason ? (
              <tr>
                <th>Cancelled</th>
                <td>{d.cancel_reason}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      {/* Next step, by who is reading */}
      {isBuyer && d.deposit?.status === 'pending' ? (
        <Card title="Pay the booking deposit">
          <p className="small">
            {money(d.deposit.amount)} holds the animals for you{Number(d.deposit.commission) > 0 ? `, of which ${money(d.deposit.booking)} is the deposit that counts toward the price and ${money(d.deposit.commission)} is the platform fee` : ', and it counts toward the price'}. Pay by {when(d.deposit.expires_at)} or the deal lapses. The balance is paid at delivery.
          </p>
          {dep?.checkout_url ? (
            <a className="btn btn-primary btn-block" href={dep.checkout_url} target="_blank" rel="noreferrer">
              Pay {money(d.deposit.amount)} with GCash / Maya / QR Ph
            </a>
          ) : (
            <button className="btn btn-primary btn-block" disabled={busy} onClick={() => run(() => refreshCheckout(id))}>
              Get payment link
            </button>
          )}
          <button className="btn btn-link" onClick={() => load()}>
            I have paid, refresh
          </button>
        </Card>
      ) : null}
      {isFarmer && d.deposit?.status === 'pending' ? <div className="note">Waiting for the buyer's deposit of {money(d.deposit.booking)}. Prepare the animals once it is paid.</div> : null}
      {isFarmer && d.deposit?.status === 'paid' && ['accepted', 'hauler_assigned', 'in_transit'].includes(d.state) ? (
        <div className="note">
          {money(d.deposit.booking)} reserved for you, paid by the buyer and held through PayMongo. Released to your payout account when the deal settles.
        </div>
      ) : null}

      {isBuyer && ['accepted', 'in_transit'].includes(d.state) && (!d.deposit || d.deposit.status !== 'pending') ? <ReceiveForm d={d} perHead={perHead} busy={busy} onSubmit={(v) => run(() => deliverDeal(id, v))} /> : null}
      {isBuyer && d.state === 'delivered' && !d.buyer_paid_at ? <PayForm total={d.final_total} deposit={d.deposit?.status === 'paid' || d.deposit?.status === 'released' ? d.deposit.amount : null} busy={busy} onSubmit={(v) => run(() => payDeal(id, v))} /> : null}
      {isFarmer && d.state === 'delivered' ? (
        <Card title="Payment">
          {d.buyer_paid_at ? (
            <>
              <p className="small">
                The buyer says they paid {money(d.final_total)} by {d.payment_method}
                {d.payment_reference ? ` (ref ${d.payment_reference})` : ''}. Confirm only when the money is in your hands or account.
              </p>
              <button className="btn btn-primary btn-block" disabled={busy} onClick={() => run(() => confirmPayment(id))}>
                Natanggap ko na ang bayad
              </button>
            </>
          ) : (
            <p className="small muted">Delivered: {d.delivered_heads} heads. Waiting for the buyer to record the payment.</p>
          )}
        </Card>
      ) : null}
      {(isFarmer || isBuyer) && d.state === 'delivered' ? <DisputeButton busy={busy} onSubmit={(r, t) => run(() => disputeDeal(id, r, t))} /> : null}
      {(isFarmer || isBuyer) && ['accepted', 'hauler_assigned'].includes(d.state) ? (
        <CancelButton
          busy={busy}
          warning={isBuyer && d.deposit?.status === 'paid' ? `Your deposit of ${money(d.deposit.amount)} goes to the farmer if you cancel now.` : isFarmer && d.deposit?.status === 'paid' ? 'The buyer is refunded in full and you get a strike.' : null}
          onSubmit={(r) => run(() => cancelDeal(id, r))}
        />
      ) : null}
      {(isFarmer || isBuyer) && d.state === 'settled' ? <RateForm busy={busy} onSubmit={(s, c) => run(() => rateDeal(id, s, c))} /> : null}

      <h3>Timeline</h3>
      <ul className="timeline">
        {(d.events ?? []).map((e, i) => (
          <li key={i}>
            <b>{STATE_FIL[e.to_state]}</b>
            {e.note ? ` · ${e.note}` : ''}
            <div className="muted small">{when(e.created_at)}</div>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

function ReceiveForm({ d, perHead, busy, onSubmit }: { d: Deal; perHead: boolean; busy: boolean; onSubmit: (v: { delivered_heads: number; delivered_weight_kg?: string | null; note?: string | null }) => void }) {
  const [heads, setHeads] = useState(String(d.agreed_heads));
  const [kg, setKg] = useState('');
  const [note, setNote] = useState('');
  const total = perHead ? Number(d.agreed_price) * Number(heads || 0) : kg ? Number(d.agreed_price) * Number(kg) : null;
  return (
    <Card title="Confirm what arrived">
      <p className="small muted">Count the heads{perHead ? '' : ' and weigh at the scale'}. This sets the final price.</p>
      <form
        className="stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit({ delivered_heads: Number(heads), delivered_weight_kg: perHead ? null : kg || null, note: note || null });
        }}
      >
        <div className="row">
          <Field label="Heads received">
            <input id="rc-heads" type="number" inputMode="numeric" min={0} max={d.agreed_heads} value={heads} onChange={(e) => setHeads(e.target.value)} required />
          </Field>
          {!perHead ? (
            <Field label="Total weight, kg" hint={total ? `= ${money(total)}` : undefined}>
              <input id="rc-kg" type="number" inputMode="decimal" min={0} step="0.5" value={kg} onChange={(e) => setKg(e.target.value)} required />
            </Field>
          ) : null}
        </div>
        <Field label="Note (optional)">
          <input id="rc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>
          Confirm delivery{total ? ` · ${money(total)}` : ''}
        </button>
      </form>
    </Card>
  );
}

function PayForm({ total, deposit, busy, onSubmit }: { total: string | null; deposit: string | null; busy: boolean; onSubmit: (v: { method: 'gcash' | 'bank' | 'cash'; reference?: string | null }) => void }) {
  const [method, setMethod] = useState<'gcash' | 'bank' | 'cash'>('gcash');
  const [ref, setRef] = useState('');
  const due = total && deposit ? Number(total) - Number(deposit) : total ? Number(total) : null;
  return (
    <Card title="Pay the farmer">
      <p className="small">
        Balance due {due !== null ? money(due) : '—'}
        {deposit ? ` (${money(total)} less your ${money(deposit)} deposit)` : ''}. Pay the farmer directly, then record it here.
      </p>
      <form
        className="stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit({ method, reference: ref || null });
        }}
      >
        <Field label="How">
          <select id="pay-m" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="gcash">GCash</option>
            <option value="bank">Bank transfer</option>
            <option value="cash">Cash</option>
          </select>
        </Field>
        {method !== 'cash' ? (
          <Field label="Reference number">
            <input id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} />
          </Field>
        ) : null}
        <button className="btn btn-primary btn-block" disabled={busy}>
          I paid the farmer
        </button>
      </form>
    </Card>
  );
}

function DisputeButton({ busy, onSubmit }: { busy: boolean; onSubmit: (reason: 'weight_mismatch' | 'health' | 'non_payment' | 'no_show' | 'other', details: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<'weight_mismatch' | 'health' | 'non_payment' | 'no_show' | 'other'>('weight_mismatch');
  const [details, setDetails] = useState('');
  if (!open)
    return (
      <button className="btn btn-block" onClick={() => setOpen(true)}>
        May problema (dispute)
      </button>
    );
  return (
    <Card title="Open a dispute">
      <p className="small muted">The deal freezes and an admin decides with both sides' figures.</p>
      <form
        className="stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit(reason, details);
        }}
      >
        <Field label="Reason">
          <select id="dp-r" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
            <option value="weight_mismatch">Weight does not match</option>
            <option value="health">Sick or dead animal</option>
            <option value="non_payment">Not paid</option>
            <option value="no_show">Other side did not show</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="What happened">
          <textarea id="dp-d" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} />
        </Field>
        <div className="actions actions-end">
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Back
          </button>
          <button className="btn btn-warn" disabled={busy}>
            Open dispute
          </button>
        </div>
      </form>
    </Card>
  );
}

function CancelButton({ busy, warning, onSubmit }: { busy: boolean; warning: string | null; onSubmit: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open)
    return (
      <button className="btn btn-link" onClick={() => setOpen(true)}>
        Cancel this deal
      </button>
    );
  return (
    <Card title="Cancel the deal">
      {warning ? <div className="note note-error">{warning}</div> : null}
      <form
        className="stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit(reason);
        }}
      >
        <Field label="Reason (the other side reads this)">
          <input id="cx-r" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} />
        </Field>
        <div className="actions actions-end">
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Keep the deal
          </button>
          <button className="btn btn-warn" disabled={busy || reason.trim().length < 3}>
            Cancel deal
          </button>
        </div>
      </form>
    </Card>
  );
}

function RateForm({ busy, onSubmit }: { busy: boolean; onSubmit: (score: number, comment: string) => void }) {
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  if (done) return <div className="note">Salamat! Rating saved.</div>;
  return (
    <Card title="Rate the other side">
      <div className="actions">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={`btn btn-small ${score === n ? 'btn-primary' : ''}`} onClick={() => setScore(n)} aria-label={`${n} stars`}>
            {'★'.repeat(n)}
          </button>
        ))}
      </div>
      <Field label="Comment (optional)">
        <input id="rt-c" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={300} />
      </Field>
      <button
        className="btn btn-primary"
        style={{ marginTop: 8 }}
        disabled={busy}
        onClick={() => {
          onSubmit(score, comment);
          setDone(true);
        }}
      >
        Send rating
      </button>
      <p className="muted small" style={{ marginTop: 8 }}>
        Ratings can be given once per deal. {day(new Date().toISOString().slice(0, 10))}
      </p>
    </Card>
  );
}
