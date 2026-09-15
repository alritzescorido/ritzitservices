import { useEffect, useState, type FormEvent } from 'react';
import { createFarm, createLot, listFarms, listLots, uploadFile } from '../api/app';
import { day } from '../api/format';
import { SPECIES, SPECIES_LABEL, type Farm, type LocationWithPath, type Lot, type Species } from '../api/types';
import { Card, Empty, ErrorNote, Field, Loading, LocationPicker, Screen } from '../ui/components';

// Wireframe Herd: farms and their lots. Add a farm, add a lot with head count,
// average weight and a photo. The weight class is derived by the API.
export function Herd() {
  const [farms, setFarms] = useState<Farm[] | null>(null);
  const [lots, setLots] = useState<Record<string, Lot[]>>({});
  const [adding, setAdding] = useState<'farm' | string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = async () => {
    setError(null);
    try {
      const r = await listFarms();
      setFarms(r.items);
      const all = await Promise.all(r.items.map(async (f) => [f.id, (await listLots(f.id)).items] as const));
      setLots(Object.fromEntries(all));
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  return (
    <Screen
      title="Mga hayop ko"
      sub="Your farms and lots. A lot is a group you would sell together."
      actions={
        <button className="btn btn-small" onClick={() => setAdding(adding === 'farm' ? null : 'farm')}>
          + Farm
        </button>
      }
    >
      <ErrorNote error={error} />
      {adding === 'farm' ? (
        <FarmForm
          onDone={() => {
            setAdding(null);
            void load();
          }}
        />
      ) : null}
      {farms === null ? <Loading /> : null}
      {farms && farms.length === 0 && adding !== 'farm' ? <Empty>No farm yet. Add one to start listing animals.</Empty> : null}
      {farms?.map((f) => (
        <Card key={f.id} title={f.name}>
          <div className="muted small">
            {f.location.display_name} · {f.farm_type ?? 'farm'}
          </div>
          <div className="stack" style={{ marginTop: 10 }}>
            {(lots[f.id] ?? []).map((l) => (
              <div key={l.id} className="between">
                <div>
                  <b>
                    {SPECIES_LABEL[l.species]} × {l.head_count}
                  </b>
                  <div className="muted small">
                    {l.weight_class.label}
                    {l.avg_weight_kg ? ` · avg ${l.avg_weight_kg} kg` : ''}
                    {l.breed ? ` · ${l.breed}` : ''}
                    {l.last_vaccination_on ? ` · vaccinated ${day(l.last_vaccination_on)}` : ''}
                  </div>
                </div>
                {l.photo_keys.length ? <span className="badge">{l.photo_keys.length} photo</span> : null}
              </div>
            ))}
            {(lots[f.id] ?? []).length === 0 ? <div className="muted small">No lots yet.</div> : null}
          </div>
          {adding === f.id ? (
            <LotForm
              farmId={f.id}
              onDone={() => {
                setAdding(null);
                void load();
              }}
            />
          ) : (
            <button className="btn btn-small" style={{ marginTop: 10 }} onClick={() => setAdding(f.id)}>
              + Lot
            </button>
          )}
        </Card>
      ))}
    </Screen>
  );
}

function FarmForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [barangay, setBarangay] = useState<LocationWithPath | null>(null);
  const [type, setType] = useState('backyard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!barangay) return;
    setBusy(true);
    try {
      await createFarm({ name: name.trim(), barangay_code: barangay.psgc_code, farm_type: type });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="New farm">
      <ErrorNote error={error} />
      <form className="stack" onSubmit={submit}>
        <Field label="Name">
          <input id="nf-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </Field>
        <LocationPicker level="barangay" label="Barangay" value={barangay} onChange={setBarangay} />
        <Field label="Type">
          <select id="nf-type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="backyard">Backyard</option>
            <option value="commercial">Commercial</option>
            <option value="cooperative">Cooperative</option>
          </select>
        </Field>
        <div className="actions actions-end">
          <button type="button" className="btn" onClick={onDone}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !barangay}>
            {busy ? 'Saving…' : 'Save farm'}
          </button>
        </div>
      </form>
    </Card>
  );
}

function LotForm({ farmId, onDone }: { farmId: string; onDone: () => void }) {
  const [species, setSpecies] = useState<Species>('hog');
  const [heads, setHeads] = useState('');
  const [avg, setAvg] = useState('');
  const [breed, setBreed] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const photo_keys = photo ? [await uploadFile('lot_photo', photo)] : [];
      await createLot(farmId, { species, head_count: Number(heads), avg_weight_kg: avg ? avg : null, breed: breed || null, photo_keys });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" style={{ marginTop: 10 }} onSubmit={submit}>
      <ErrorNote error={error} />
      <div className="row">
        <Field label="Species">
          <select id="nl-sp" value={species} onChange={(e) => setSpecies(e.target.value as Species)}>
            {SPECIES.map((s) => (
              <option key={s} value={s}>
                {SPECIES_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Heads">
          <input id="nl-heads" type="number" inputMode="numeric" min={1} value={heads} onChange={(e) => setHeads(e.target.value)} required />
        </Field>
      </div>
      <div className="row">
        <Field label="Average weight, kg" hint="Sets the weight class and the estimate.">
          <input id="nl-avg" type="number" inputMode="decimal" min={1} step="0.5" value={avg} onChange={(e) => setAvg(e.target.value)} />
        </Field>
        <Field label="Breed (optional)">
          <input id="nl-breed" value={breed} onChange={(e) => setBreed(e.target.value)} />
        </Field>
      </div>
      <Field label="Photo (optional)">
        <input id="nl-photo" type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </Field>
      <div className="actions actions-end">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy || !heads}>
          {busy ? 'Saving…' : 'Save lot'}
        </button>
      </div>
    </form>
  );
}
