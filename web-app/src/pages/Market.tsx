import { useEffect, useState, type FormEvent } from 'react';
import { listListings, makeOffer } from '../api/app';
import { ago, day, money, unitLabel } from '../api/format';
import { SPECIES, SPECIES_LABEL, type Listing, type LocationWithPath, type Species } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, Empty, ErrorNote, Field, Loading, LocationPicker, Screen, useHomeLocation } from '../ui/components';

// Wireframes BuyerBrowse and BuyerOffer: listings near me against the board,
// then an offer with pickup day, hauler wanted or own truck, and a delivery point.
export function Market() {
  const { user } = useAuth();
  const [home] = useHomeLocation();
  const [species, setSpecies] = useState<Species | ''>('');
  const [items, setItems] = useState<Listing[] | null>(null);
  const [open, setOpen] = useState<Listing | null>(null);
  const [error, setError] = useState<unknown>(null);

  const provinceOf = (l: LocationWithPath | null) => l?.path?.find((p) => p.level === 'province')?.psgc_code ?? (l?.level === 'province' ? l.psgc_code : undefined);

  useEffect(() => {
    let live = true;
    setItems(null);
    listListings({ species: species || undefined, province_code: provinceOf(home), limit: 50 })
      .then((r) => live && setItems(r.items))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [species, home]);

  return (
    <Screen title="Bilhin" sub={home ? `Listings in ${home.path?.find((p) => p.level === 'province')?.name ?? home.display_name}` : 'Listings everywhere'}>
      <ErrorNote error={error} />
      <div className="segmented" style={{ marginBottom: 10 }}>
        <button className={`btn btn-small ${species === '' ? 'btn-primary' : ''}`} onClick={() => setSpecies('')}>
          Lahat
        </button>
        {SPECIES.map((s) => (
          <button key={s} className={`btn btn-small ${species === s ? 'btn-primary' : ''}`} onClick={() => setSpecies(s)}>
            {SPECIES_LABEL[s]}
          </button>
        ))}
      </div>
      {items === null ? <Loading /> : null}
      {items && items.length === 0 ? <Empty>Nothing listed right now.</Empty> : null}
      {items?.map((l) => (
        <Card key={l.id} onClick={() => setOpen(open?.id === l.id ? null : l)}>
          <div className="between">
            <b>
              {SPECIES_LABEL[l.species]} {l.weight_class.label} × {l.heads_offered}
            </b>
            <span className="price-value" style={{ fontSize: 20 }}>
              {money(l.asking_price)}
              <span className="muted small">{unitLabel(l.unit)}</span>
            </span>
          </div>
          <div className="muted small">
            {l.location.display_name} · {l.farm_name} · {l.farmer_name} {l.farmer_verified ? <Badge status="ok">verified</Badge> : null}
          </div>
          <div className="muted small">
            {l.board_price ? `Board ${money(l.board_price)} · ${l.vs_board_pct !== null && l.vs_board_pct >= 0 ? '+' : ''}${l.vs_board_pct?.toFixed(1) ?? '—'}%` : 'No board price'}
            {l.avg_weight_kg ? ` · avg ${l.avg_weight_kg} kg` : ''}
            {l.estimated_total ? ` · est. ${money(l.estimated_total)}` : ''}
            {l.last_vaccination_on ? ` · vaccinated ${day(l.last_vaccination_on)}` : ''} · {ago(l.created_at)} ago
            {l.pending_offers ? ` · ${l.pending_offers} offer(s)` : ''}
          </div>
          {open?.id === l.id ? (
            <div onClick={(e) => e.stopPropagation()}>
              {user?.verification === 'verified' ? <OfferForm l={l} onDone={() => setOpen(null)} /> : <div className="note" style={{ marginTop: 10 }}>Offers open once your account is verified.</div>}
            </div>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}

function OfferForm({ l, onDone }: { l: Listing; onDone: () => void }) {
  const [price, setPrice] = useState(l.board_price ?? l.asking_price);
  const [heads, setHeads] = useState(String(l.heads_offered));
  const [pickup, setPickup] = useState('');
  const [hauler, setHauler] = useState(true);
  const [dropoff, setDropoff] = useState<LocationWithPath | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const est = l.unit === 'per_head' ? Number(price) * Number(heads || 0) : l.avg_weight_kg ? Number(price) * Number(l.avg_weight_kg) * Number(heads || 0) : null;
  const deposit = est ? Math.min(20000, Math.max(2000, Math.round(est * 0.1))) : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await makeOffer(l.id, { price: Number(price).toFixed(2), heads: Number(heads), pickup_on: pickup || null, needs_hauler: hauler, dropoff_location_code: dropoff?.psgc_code ?? null, note: note || null });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  if (sent)
    return (
      <div className="note" style={{ marginTop: 10 }}>
        Offer sent. The farmer has 24 hours to accept, counter or decline. Watch <b>Deals</b> once accepted.
        <div>
          <button className="btn btn-link" onClick={onDone}>
            close
          </button>
        </div>
      </div>
    );
  return (
    <form className="stack" style={{ marginTop: 12 }} onSubmit={submit}>
      <ErrorNote error={error} />
      <div className="row">
        <Field label={`Offer ${unitLabel(l.unit)}`} hint={est ? `≈ ${money(est)} total` : undefined}>
          <input id={`op-${l.id}`} type="number" inputMode="decimal" step="0.5" min={1} value={price} onChange={(e) => setPrice(e.target.value)} required />
        </Field>
        <Field label="Heads">
          <input id={`oh-${l.id}`} type="number" inputMode="numeric" min={1} max={l.heads_offered} value={heads} onChange={(e) => setHeads(e.target.value)} required />
        </Field>
      </div>
      <Field label="Pickup day">
        <input id={`od-${l.id}`} type="date" value={pickup} onChange={(e) => setPickup(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={hauler} onChange={(e) => setHauler(e.target.checked)} /> Book a hauler in the app
      </label>
      {hauler ? (
        <Field label="Deliver to" hint="Haulers see this on the job board.">
          <LocationPicker level="municipality" value={dropoff} onChange={setDropoff} placeholder="Municipality or city…" />
        </Field>
      ) : null}
      <Field label="Note to the farmer (optional)">
        <input id={`on-${l.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </Field>
      {deposit ? <p className="muted small">If accepted, a booking deposit of about {money(deposit)} is due within 2 hours through GCash, Maya or QR Ph. It counts toward the price.</p> : null}
      <div className="actions actions-end">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send offer'}
        </button>
      </div>
    </form>
  );
}
