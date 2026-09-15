import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { acceptOffer, counterOffer, createListing, listFarms, listListings, listLots, listOffers, rejectOffer } from '../api/app';
import { ago, day, money, unitLabel } from '../api/format';
import { SPECIES_LABEL, type Listing, type Lot, type Offer } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, Empty, ErrorNote, Field, Loading, Screen } from '../ui/components';

// Wireframe Listing: pick a lot, set heads and price against the board, then
// watch offers arrive. Accept, counter or decline each one.
export function Sell() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [offers, setOffers] = useState<Record<string, Offer[]>>({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = async () => {
    setError(null);
    try {
      const r = await listListings({ mine: true, limit: 50 });
      setListings(r.items);
      const active = r.items.filter((l) => l.status === 'active');
      const all = await Promise.all(active.map(async (l) => [l.id, (await listOffers(l.id)).items] as const));
      setOffers(Object.fromEntries(all));
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const verified = user?.verification === 'verified';

  const act = async (fn: () => Promise<unknown>, goDeals = false) => {
    setError(null);
    try {
      const r = await fn();
      if (goDeals && r && typeof r === 'object' && 'id' in r) nav(`/deals/${(r as { id: string }).id}`);
      else await load();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Screen
      title="Ibenta"
      sub="List a lot at your price. Buyers see it next to the board price."
      actions={
        <button className="btn btn-small btn-primary" disabled={!verified} onClick={() => setCreating((c) => !c)}>
          + Listing
        </button>
      }
    >
      {!verified ? <div className="note">Listing opens once your account is verified.</div> : null}
      <ErrorNote error={error} />
      {creating ? (
        <ListingForm
          onDone={() => {
            setCreating(false);
            void load();
          }}
        />
      ) : null}
      {listings === null ? <Loading /> : null}
      {listings && listings.length === 0 && !creating ? <Empty>No listings yet.</Empty> : null}
      {listings?.map((l) => (
        <Card key={l.id}>
          <div className="between">
            <b>
              {SPECIES_LABEL[l.species]} {l.weight_class.label} × {l.heads_offered}
            </b>
            <Badge status={l.status === 'active' ? 'ok' : l.status === 'matched' ? 'info' : 'muted'}>{l.status}</Badge>
          </div>
          <div className="muted small">
            Asking {money(l.asking_price)}
            {unitLabel(l.unit)}
            {l.board_price ? ` · board ${money(l.board_price)} (${l.vs_board_pct !== null && l.vs_board_pct >= 0 ? '+' : ''}${l.vs_board_pct?.toFixed(1) ?? '—'}%)` : ''}
            {l.estimated_total ? ` · est. ${money(l.estimated_total)}` : ''} · {ago(l.created_at)} ago
          </div>
          {(offers[l.id] ?? []).length > 0 ? (
            <div className="stack" style={{ marginTop: 10 }}>
              <h3>Offers</h3>
              {(offers[l.id] ?? []).map((o) => (
                <OfferRow key={o.id} o={o} listing={l} onAct={act} />
              ))}
            </div>
          ) : l.status === 'active' ? (
            <div className="muted small" style={{ marginTop: 6 }}>
              No offers yet. Buyers have 24 hours per offer.
            </div>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}

function OfferRow({ o, listing, onAct }: { o: Offer; listing: Listing; onAct: (fn: () => Promise<unknown>, goDeals?: boolean) => Promise<void> }) {
  const [counter, setCounter] = useState<string | null>(null);
  const mine = o.offered_by === 'farmer';
  return (
    <div className="choice" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div className="between">
        <div>
          <b>
            {money(o.price)}
            {unitLabel(listing.unit)} × {o.heads}
          </b>
          <div className="muted small">
            {mine ? 'Your counter to ' : ''}
            {o.buyer_name}
            {o.estimated_total ? ` · ${money(o.estimated_total)}` : ''}
            {o.pickup_on ? ` · pickup ${day(o.pickup_on)}` : ''} · {o.needs_hauler ? 'wants a hauler' : 'own truck'}
          </div>
          {o.note ? <div className="small">“{o.note}”</div> : null}
        </div>
        <Badge status={o.status === 'pending' ? 'info' : o.status === 'accepted' ? 'ok' : 'muted'}>{o.status}</Badge>
      </div>
      {o.status === 'pending' && !mine ? (
        counter === null ? (
          <div className="actions" style={{ marginTop: 8 }}>
            <button className="btn btn-small btn-primary" onClick={() => onAct(() => acceptOffer(o.id), true)}>
              Accept
            </button>
            <button className="btn btn-small" onClick={() => setCounter(listing.asking_price)}>
              Counter
            </button>
            <button className="btn btn-small btn-warn" onClick={() => onAct(() => rejectOffer(o.id))}>
              Decline
            </button>
          </div>
        ) : (
          <form
            className="actions"
            style={{ marginTop: 8 }}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void onAct(() => counterOffer(o.id, { price: Number(counter).toFixed(2), heads: o.heads }));
              setCounter(null);
            }}
          >
            <input id={`c-${o.id}`} type="number" inputMode="decimal" step="0.5" min={1} value={counter} onChange={(e) => setCounter(e.target.value)} style={{ width: 120 }} />
            <button className="btn btn-small btn-primary">Send counter</button>
            <button type="button" className="btn btn-small" onClick={() => setCounter(null)}>
              Back
            </button>
          </form>
        )
      ) : o.status === 'pending' && mine ? (
        <div className="muted small">Waiting for the buyer. Expires {ago(o.expires_at) === 'just now' ? 'soon' : `in ${Math.max(0, Math.round((new Date(o.expires_at).getTime() - Date.now()) / 3600_000))} h`}.</div>
      ) : null}
    </div>
  );
}

function ListingForm({ onDone }: { onDone: () => void }) {
  const [lots, setLots] = useState<Lot[]>([]);
  const [lotId, setLotId] = useState('');
  const [heads, setHeads] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    listFarms()
      .then(async (r) => {
        const all = await Promise.all(r.items.map((f) => listLots(f.id)));
        const ls = all.flatMap((x) => x.items);
        setLots(ls);
        if (ls[0]) {
          setLotId(ls[0].id);
          setHeads(String(ls[0].head_count));
        }
      })
      .catch(setError);
  }, []);
  const lot = lots.find((l) => l.id === lotId);
  const est = lot && price ? (lot.weight_class.unit === 'per_head' ? Number(price) * Number(heads || 0) : lot.avg_weight_kg ? Number(price) * Number(lot.avg_weight_kg) * Number(heads || 0) : null) : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createListing({ lot_id: lotId, heads_offered: Number(heads), asking_price: Number(price).toFixed(2) });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="New listing">
      <ErrorNote error={error} />
      {lots.length === 0 ? <p className="muted small">Add a lot under Hayop first.</p> : null}
      <form className="stack" onSubmit={submit}>
        <Field label="Lot">
          <select
            id="ls-lot"
            value={lotId}
            onChange={(e) => {
              setLotId(e.target.value);
              const l = lots.find((x) => x.id === e.target.value);
              if (l) setHeads(String(l.head_count));
            }}
          >
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {SPECIES_LABEL[l.species]} {l.weight_class.label} × {l.head_count}
                {l.avg_weight_kg ? ` (avg ${l.avg_weight_kg} kg)` : ''}
              </option>
            ))}
          </select>
        </Field>
        <div className="row">
          <Field label="Heads to sell">
            <input id="ls-heads" type="number" inputMode="numeric" min={1} max={lot?.head_count ?? undefined} value={heads} onChange={(e) => setHeads(e.target.value)} required />
          </Field>
          <Field label={`Price ${lot ? unitLabel(lot.weight_class.unit) : ''}`} hint={est ? `est. ${money(est)}` : 'Check the board first'}>
            <input id="ls-price" type="number" inputMode="decimal" min={1} step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </Field>
        </div>
        <div className="actions actions-end">
          <button type="button" className="btn" onClick={onDone}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !lotId || !heads || !price}>
            {busy ? 'Posting…' : 'Post listing'}
          </button>
        </div>
      </form>
    </Card>
  );
}
