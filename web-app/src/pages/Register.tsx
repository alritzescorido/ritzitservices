import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { addRole, createFarm, getPublicSettings, putHaulerProfile, registerDocument, updateMe, uploadFile } from '../api/app';
import type { DocType, LocationWithPath, Role } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorNote, Field, LocationPicker, useHomeLocation } from '../ui/components';

// Wireframes RegisterFarmer, RegisterBuyer, RegisterHauler. One screen, the
// role decides which fields appear. Documents can be added later under Ako.
type PickRole = Exclude<Role, 'admin'>;
const DOCS: Record<PickRole, { type: DocType; label: string; required: boolean }[]> = {
  farmer: [
    { type: 'gov_id', label: 'Government ID', required: false },
    { type: 'barangay_clearance', label: 'Barangay clearance', required: true },
  ],
  buyer: [
    { type: 'gov_id', label: 'Government ID', required: true },
    { type: 'selfie_with_id', label: 'Selfie holding the ID', required: true },
    { type: 'business_permit', label: "Business permit or mayor's permit", required: false },
  ],
  hauler: [
    { type: 'gov_id', label: 'Government ID', required: true },
    { type: 'or_cr', label: 'Vehicle OR/CR', required: true },
    { type: 'ltfrb_franchise', label: 'LTFRB franchise (optional)', required: false },
  ],
};

export function Register() {
  const { user, reload } = useAuth();
  const nav = useNavigate();
  const [, setHome] = useHomeLocation();
  const [name, setName] = useState(user?.full_name ?? '');
  const [lang, setLang] = useState(user?.preferred_lang ?? 'fil');
  const [role, setRole] = useState<PickRole>((user?.roles.find((r) => r !== 'admin') as PickRole | undefined) ?? 'farmer');
  const [farmName, setFarmName] = useState('');
  const [barangay, setBarangay] = useState<LocationWithPath | null>(null);
  const [farmType, setFarmType] = useState<'backyard' | 'commercial' | 'cooperative'>('backyard');
  const [plate, setPlate] = useState('');
  const [truck, setTruck] = useState('Elf truck');
  const [capacity, setCapacity] = useState('10');
  const [files, setFiles] = useState<Partial<Record<DocType, File>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // An admin can switch the ID requirement off from the console.
  const [docsRequired, setDocsRequired] = useState(true);
  useEffect(() => {
    getPublicSettings()
      .then((s) => setDocsRequired(s.require_documents))
      .catch(() => undefined);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateMe({ full_name: name.trim(), preferred_lang: lang });
      if (!user?.roles.includes(role)) {
        await addRole(role);
        // The API reads roles from the token's claims, not the database, so the
        // token must be rotated before the first call that needs the new role.
        await reload();
      }
      if (role === 'farmer' && barangay) {
        await createFarm({ name: farmName.trim() || `${name.trim()} farm`, barangay_code: barangay.psgc_code, farm_type: farmType });
        const muni = barangay.path?.find((p) => p.level === 'municipality');
        if (muni) setHome({ ...muni, display_name: barangay.display_name.split(',').slice(1).join(',').trim() || muni.name });
      }
      if (role === 'hauler' && plate.trim()) await putHaulerProfile({ vehicle_plate: plate.trim(), vehicle_type: truck.trim(), capacity_heads: Number(capacity) || 1 });
      for (const d of DOCS[role]) {
        const f = files[d.type];
        if (f) await registerDocument(d.type, await uploadFile('user_document', f));
      }
      await reload();
      nav('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const missingRequired = docsRequired && DOCS[role].some((d) => d.required && !files[d.type]);

  return (
    <div className="signin">
      <h1>Tell us who you are</h1>
      <p className="muted small">Verification usually takes 2 working days. You can see prices right away.</p>
      <ErrorNote error={error} />
      <form onSubmit={submit} className="stack">
        <Field label="Full name (as on your ID)">
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" />
        </Field>
        <Field label="Language">
          <select id="lang" value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="fil">Filipino</option>
            <option value="en">English</option>
            <option value="ilo">Ilokano</option>
            <option value="ceb">Cebuano</option>
            <option value="hil">Hiligaynon</option>
          </select>
        </Field>
        <h3>I am a</h3>
        <div className="stack">
          {(['farmer', 'buyer', 'hauler'] as PickRole[]).map((r) => (
            <label key={r} className="choice">
              <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />
              <div>
                <b>{r === 'farmer' ? 'Farmer / magsasaka' : r === 'buyer' ? 'Buyer / viajero, trader' : 'Hauler / may truck'}</b>
                <div className="muted small">{r === 'farmer' ? 'List animals, see offers, get paid.' : r === 'buyer' ? 'Browse listings, make offers, book hauling.' : 'Take hauling jobs, run the pickup checklist.'}</div>
              </div>
            </label>
          ))}
        </div>
        {role === 'farmer' ? (
          <>
            <h3>Your farm</h3>
            <Field label="Farm name">
              <input id="farm" value={farmName} onChange={(e) => setFarmName(e.target.value)} placeholder="e.g. Maligaya backyard" />
            </Field>
            <LocationPicker level="barangay" label="Barangay" value={barangay} onChange={setBarangay} />
            <Field label="Type">
              <select id="ftype" value={farmType} onChange={(e) => setFarmType(e.target.value as typeof farmType)}>
                <option value="backyard">Backyard</option>
                <option value="commercial">Commercial</option>
                <option value="cooperative">Cooperative</option>
              </select>
            </Field>
          </>
        ) : null}
        {role === 'hauler' ? (
          <>
            <h3>Your truck</h3>
            <div className="row">
              <Field label="Plate">
                <input id="plate" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="NEB 4521" required />
              </Field>
              <Field label="Capacity, heads">
                <input id="cap" type="number" min={1} max={500} value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
              </Field>
            </div>
            <Field label="Vehicle">
              <input id="truck" value={truck} onChange={(e) => setTruck(e.target.value)} />
            </Field>
          </>
        ) : null}
        <h3>Documents</h3>
        {DOCS[role].map((d) => (
          <Field key={d.type} label={`${d.label}${d.required && docsRequired ? '' : ' (optional)'}`}>
            <input id={`doc-${d.type}`} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={(e) => setFiles((f) => ({ ...f, [d.type]: e.target.files?.[0] }))} />
          </Field>
        ))}
        {missingRequired ? <p className="muted small">You can add the required documents later under Ako, but verification starts only when they are in.</p> : null}
        {!docsRequired ? <p className="muted small">Documents are optional right now. An admin can still verify you without one.</p> : null}
        <button className="btn btn-primary btn-block" disabled={busy || name.trim().length < 2 || (role === 'farmer' && !barangay)}>
          {busy ? 'Saving…' : 'Finish'}
        </button>
      </form>
    </div>
  );
}
