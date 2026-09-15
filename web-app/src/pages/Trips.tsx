import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cancelShipment, getShipment, listShipments, markDelivered, pingShipment, startTrip, uploadFile } from '../api/app';
import { money, when } from '../api/format';
import { SPECIES_LABEL, type Shipment } from '../api/types';
import { Badge, Card, Empty, ErrorNote, Field, Loading, Screen } from '../ui/components';

// Wireframes HaulPickup and HaulTransit. The checklist gates "Start trip";
// in transit the phone shares its position and can flag a checkpoint, delay
// or problem; hand-over closes the hauler's part, the buyer confirms the count.
const TONE: Record<Shipment['status'], 'ok' | 'warn' | 'info' | 'muted'> = { assigned: 'info', picked_up: 'info', in_transit: 'info', delivered: 'ok', cancelled: 'muted' };

export function Trips() {
  const { id } = useParams();
  const nav = useNavigate();
  const [items, setItems] = useState<Shipment[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (id) return;
    listShipments()
      .then((r) => setItems(r.items))
      .catch(setError);
  }, [id]);
  if (id) return <TripDetail id={id} onBack={() => nav('/trips')} />;
  return (
    <Screen title="Mga biyahe" sub="Jobs you took: coming up, on the road, done.">
      <ErrorNote error={error} />
      {items === null ? <Loading /> : null}
      {items && items.length === 0 ? <Empty>No trips yet. Take a job under Trabaho.</Empty> : null}
      {items?.map((s) => (
        <Card key={s.id} onClick={() => nav(`/trips/${s.id}`)}>
          <div className="between">
            <b>
              {s.heads} {SPECIES_LABEL[s.species]} · {s.farm_name}
            </b>
            <Badge status={TONE[s.status]}>{s.status.replace('_', ' ')}</Badge>
          </div>
          <div className="muted small">
            {s.pickup.display_name}
            {s.dropoff ? ` → ${s.dropoff.display_name}` : ''} · {s.status === 'assigned' ? `pickup ${when(s.scheduled_pickup_at)}` : s.status === 'delivered' ? `handed over ${when(s.delivered_at)}` : `loaded ${when(s.picked_up_at)}`}
            {s.agreed_fee ? ` · fee ${money(s.agreed_fee)}` : ''}
          </div>
        </Card>
      ))}
    </Screen>
  );
}

function TripDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [s, setS] = useState<Shipment | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const load = () => getShipment(id).then(setS).catch(setError);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Position sharing while in transit: one ping every 2 minutes from the phone's GPS.
  useEffect(() => {
    if (!sharing || !s || s.status !== 'in_transit' || !('geolocation' in navigator)) return;
    const send = () =>
      navigator.geolocation.getCurrentPosition(
        (p) => void pingShipment(id, { lat: p.coords.latitude, lng: p.coords.longitude }).catch(() => undefined),
        () => undefined,
        { enableHighAccuracy: false, maximumAge: 60_000 },
      );
    send();
    const t = setInterval(send, 120_000);
    return () => clearInterval(t);
  }, [sharing, s, id]);

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
  const here = () =>
    new Promise<{ lat: number; lng: number } | null>((resolve) => {
      if (!('geolocation' in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { timeout: 8000 });
    });

  if (!s) return <Screen title="Biyahe">{error ? <ErrorNote error={error} /> : <Loading />}</Screen>;
  return (
    <Screen
      title={`${s.heads} ${SPECIES_LABEL[s.species]} · ${s.farm_name}`}
      sub={`${s.farmer_name} → ${s.buyer_name}${s.dropoff ? `, ${s.dropoff.display_name}` : ''}`}
      actions={
        <button className="btn btn-small" onClick={onBack}>
          ‹ Back
        </button>
      }
    >
      <ErrorNote error={error} />
      <Card>
        <div className="between">
          <Badge status={TONE[s.status]}>{s.status.replace('_', ' ')}</Badge>
          <span className="muted small">deal {s.deal_state.replace('_', ' ')}</span>
        </div>
        <table className="facts" style={{ marginTop: 8 }}>
          <tbody>
            <tr>
              <th>Pickup</th>
              <td>
                {s.pickup.display_name} · {when(s.scheduled_pickup_at)}
              </td>
            </tr>
            <tr>
              <th>Fee</th>
              <td>{money(s.agreed_fee)}</td>
            </tr>
            {s.shipping_permit_no ? (
              <tr>
                <th>Papers</th>
                <td>
                  permit {s.shipping_permit_no} · vet cert {s.vet_health_cert_no} · {s.head_count_at_pickup} heads loaded {when(s.picked_up_at)}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      {s.status === 'assigned' ? <Checklist s={s} busy={busy} onStart={(v) => run(() => startTrip(id, v))} onCancel={(r) => run(() => cancelShipment(id, r))} here={here} /> : null}

      {s.status === 'in_transit' ? (
        <Card title="On the road">
          <label className="check">
            <input type="checkbox" checked={sharing} onChange={(e) => setSharing(e.target.checked)} /> Share my position with the farmer and buyer
          </label>
          <div className="actions" style={{ marginTop: 8 }}>
            <button className="btn btn-small" disabled={busy} onClick={async () => run(async () => pingShipment(id, (await here()) ?? { lat: 0, lng: 0 }, 'checkpoint', 'Checkpoint passed'))}>
              Checkpoint
            </button>
            <button className="btn btn-small" disabled={busy} onClick={async () => run(async () => pingShipment(id, (await here()) ?? { lat: 0, lng: 0 }, 'delay', window.prompt('What is the delay?') ?? 'Delayed'))}>
              Delay
            </button>
            <button className="btn btn-small btn-warn" disabled={busy} onClick={async () => run(async () => pingShipment(id, (await here()) ?? { lat: 0, lng: 0 }, 'problem', window.prompt('What happened?') ?? 'Problem'))}>
              Problem
            </button>
          </div>
          <Handover busy={busy} onSubmit={(v) => run(() => markDelivered(id, v))} here={here} />
        </Card>
      ) : null}
      {s.status === 'delivered' ? <div className="note">Handed over {when(s.delivered_at)}. The buyer confirms the count and weight; your fee is settled with them directly.</div> : null}

      <h3>Events</h3>
      <ul className="timeline">
        {(s.events ?? []).map((e, i) => (
          <li key={i}>
            <b>{e.kind ?? e.status}</b>
            {e.note ? ` · ${e.note}` : ''}
            {e.geo ? <span className="muted small"> · {e.geo.lat.toFixed(4)}, {e.geo.lng.toFixed(4)}</span> : null}
            <div className="muted small">{when(e.created_at)}</div>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

function Checklist({ s, busy, onStart, onCancel, here }: { s: Shipment; busy: boolean; onStart: (v: { shipping_permit_no: string; vet_health_cert_no: string; head_count: number; photo_keys: string[]; note?: string | null; geo?: { lat: number; lng: number } | null }) => void; onCancel: (r: string) => void; here: () => Promise<{ lat: number; lng: number } | null> }) {
  const [permit, setPermit] = useState('');
  const [vet, setVet] = useState('');
  const [heads, setHeads] = useState(String(s.heads));
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const complete = permit.trim().length >= 3 && vet.trim().length >= 3 && Number(heads) >= 1 && photos.length >= 1;
  const addPhoto = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    setError(null);
    try {
      setPhotos((p) => [...p, ...[]]);
      const key = await uploadFile('shipment_photo', f);
      setPhotos((p) => [...p, key]);
    } catch (e) {
      setError(e);
    } finally {
      setUploading(false);
    }
  };
  return (
    <Card title="Pickup checklist">
      <p className="small muted">All four before the trip can start. These records decide disputes.</p>
      <ErrorNote error={error} />
      <form
        className="stack"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          onStart({ shipping_permit_no: permit.trim(), vet_health_cert_no: vet.trim(), head_count: Number(heads), photo_keys: photos, geo: await here() });
        }}
      >
        <Field label={`Heads counted (agreed ${s.heads})`}>
          <input id="ck-heads" type="number" inputMode="numeric" min={1} value={heads} onChange={(e) => setHeads(e.target.value)} required />
        </Field>
        <Field label="LGU shipping permit no.">
          <input id="ck-permit" value={permit} onChange={(e) => setPermit(e.target.value)} placeholder="SP-2026-…" required minLength={3} />
        </Field>
        <Field label="Veterinary health certificate no.">
          <input id="ck-vet" value={vet} onChange={(e) => setVet(e.target.value)} placeholder="VHC-…" required minLength={3} />
        </Field>
        <Field label="Load photo" hint={photos.length ? `${photos.length} photo(s) attached` : 'At least one, animals visible in the truck.'}>
          <input id="ck-photo" type="file" accept="image/*" capture="environment" disabled={uploading} onChange={(e) => addPhoto(e.target.files?.[0])} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy || uploading || !complete}>
          {uploading ? 'Uploading photo…' : complete ? 'Start trip' : 'Complete the checklist to start'}
        </button>
      </form>
      <button
        className="btn btn-link"
        style={{ marginTop: 8 }}
        disabled={busy}
        onClick={() => {
          const r = window.prompt('Why are you withdrawing? The farmer and buyer read this.');
          if (r && r.trim().length >= 3) onCancel(r.trim());
        }}
      >
        Withdraw from this job
      </button>
    </Card>
  );
}

function Handover({ busy, onSubmit, here }: { busy: boolean; onSubmit: (v: { note?: string | null; photo_keys?: string[]; geo?: { lat: number; lng: number } | null }) => void; here: () => Promise<{ lat: number; lng: number } | null> }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  return (
    <div className="stack" style={{ marginTop: 14 }}>
      <h3>Arrived</h3>
      <Field label="Hand-over photo (optional)">
        <input
          id="ho-photo"
          type="file"
          accept="image/*"
          capture="environment"
          disabled={uploading}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setUploading(true);
            try {
              setPhoto(await uploadFile('shipment_photo', f));
            } finally {
              setUploading(false);
            }
          }}
        />
      </Field>
      <Field label="Note (optional)">
        <input id="ho-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </Field>
      <button className="btn btn-primary btn-block" disabled={busy || uploading} onClick={async () => onSubmit({ note: note || null, photo_keys: photo ? [photo] : [], geo: await here() })}>
        Handed over to the buyer
      </button>
    </div>
  );
}
