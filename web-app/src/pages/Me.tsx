import { useEffect, useState, type FormEvent } from 'react';
import { getHaulerProfile, getPayoutAccount, listDocuments, putHaulerProfile, putPayoutAccount, registerDocument, updateMe, uploadFile } from '../api/app';
import { when } from '../api/format';
import type { DocType, HaulerProfile, PayoutAccount, UserDocument } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, ErrorNote, Field, Screen } from '../ui/components';

// Wireframe Profile: who I am, my documents and their review status, where I
// get paid (farmers), my truck (haulers), language, sign out.
const DOC_LABEL: Record<DocType, string> = {
  gov_id: 'Government ID',
  selfie_with_id: 'Selfie with ID',
  business_permit: 'Business permit',
  ltfrb_franchise: 'LTFRB franchise',
  or_cr: 'Vehicle OR/CR',
  coop_membership: 'Cooperative membership',
  barangay_clearance: 'Barangay clearance',
};

export function Me() {
  const { user, reload, signOut } = useAuth();
  const [docs, setDocs] = useState<UserDocument[]>([]);
  const [payout, setPayout] = useState<PayoutAccount | null>(null);
  const [truck, setTruck] = useState<HaulerProfile | null>(null);
  const [error, setError] = useState<unknown>(null);
  const isFarmer = user?.roles.includes('farmer');
  const isHauler = user?.roles.includes('hauler');

  const load = async () => {
    setError(null);
    try {
      setDocs((await listDocuments()).items);
      if (isFarmer) setPayout(await getPayoutAccount().catch(() => null));
      if (isHauler) setTruck(await getHaulerProfile().catch(() => null));
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) return null;
  return (
    <Screen title={user.full_name} sub={`${user.phone_masked} · ${user.roles.filter((r) => r !== 'admin').join(', ')}`}>
      <ErrorNote error={error} />
      <Card>
        <div className="between">
          <b>Verification</b>
          <Badge status={user.verification}>{user.verification}</Badge>
        </div>
        {user.verification_notes ? <p className="small warn-text">{user.verification_notes}</p> : null}
        <p className="muted small">{user.verified_at ? `Verified ${when(user.verified_at)}.` : 'An admin checks your documents, usually within 2 working days.'}</p>
        <button className="btn btn-link" onClick={() => reload().then(load)}>
          Refresh status
        </button>
      </Card>

      <Card title="Documents">
        <div className="stack">
          {docs.map((d) => (
            <div key={d.id} className="between small">
              <span>
                {DOC_LABEL[d.doc_type]}
                <span className="muted"> · {when(d.uploaded_at)}</span>
                {d.notes ? <div className="warn-text">{d.notes}</div> : null}
              </span>
              <Badge status={d.status}>{d.status}</Badge>
            </div>
          ))}
          {docs.length === 0 ? <p className="muted small">No documents yet.</p> : null}
        </div>
        <AddDoc onDone={load} />
      </Card>

      {isFarmer ? <PayoutCard current={payout} name={user.full_name} onDone={load} /> : null}
      {isHauler ? <TruckCard current={truck} onDone={load} /> : null}

      <Card title="Language">
        <select
          id="me-lang"
          value={user.preferred_lang}
          onChange={async (e) => {
            await updateMe({ preferred_lang: e.target.value }).catch(setError);
            await reload();
          }}
        >
          <option value="fil">Filipino</option>
          <option value="en">English</option>
          <option value="ilo">Ilokano</option>
          <option value="ceb">Cebuano</option>
          <option value="hil">Hiligaynon</option>
        </select>
      </Card>
      <button className="btn btn-block" onClick={() => signOut()}>
        Sign out
      </button>
    </Screen>
  );
}

function AddDoc({ onDone }: { onDone: () => Promise<void> }) {
  const [type, setType] = useState<DocType>('gov_id');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <form
      className="row"
      style={{ marginTop: 10, alignItems: 'end' }}
      onSubmit={(e: FormEvent) => e.preventDefault()}
    >
      <ErrorNote error={error} />
      <Field label="Add">
        <select id="doc-type" value={type} onChange={(e) => setType(e.target.value as DocType)}>
          {(Object.keys(DOC_LABEL) as DocType[]).map((t) => (
            <option key={t} value={t}>
              {DOC_LABEL[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="File">
        <input
          id="doc-file"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          capture="environment"
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            setError(null);
            try {
              await registerDocument(type, await uploadFile('user_document', f));
              await onDone();
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
              e.target.value = '';
            }
          }}
        />
      </Field>
    </form>
  );
}

function PayoutCard({ current, name, onDone }: { current: PayoutAccount | null; name: string; onDone: () => Promise<void> }) {
  const [edit, setEdit] = useState(!current);
  const [kind, setKind] = useState<'gcash' | 'bank'>(current?.kind ?? 'gcash');
  const [no, setNo] = useState('');
  const [bank, setBank] = useState(current?.bank_code ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setEdit(!current), [current]);
  return (
    <Card title="Where I get paid">
      <p className="muted small">Released deposits go here. The name must match your ID: {name}. A one-peso test transfer verifies it.</p>
      {current && !edit ? (
        <div className="between">
          <span>
            {current.kind === 'gcash' ? 'GCash' : `Bank ${current.bank_code ?? ''}`} {current.account_no_masked} <Badge status={current.verified ? 'ok' : 'warn'}>{current.verified ? 'verified' : 'unverified'}</Badge>
          </span>
          <button className="btn btn-link" onClick={() => setEdit(true)}>
            change
          </button>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await putPayoutAccount({ kind, account_no: no.trim(), account_name: name, bank_code: kind === 'bank' ? bank.trim() : null });
              await onDone();
              setEdit(false);
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <ErrorNote error={error} />
          <div className="row">
            <Field label="Type">
              <select id="po-kind" value={kind} onChange={(e) => setKind(e.target.value as 'gcash' | 'bank')}>
                <option value="gcash">GCash</option>
                <option value="bank">Bank (InstaPay)</option>
              </select>
            </Field>
            <Field label={kind === 'gcash' ? 'GCash number' : 'Account number'}>
              <input id="po-no" inputMode="numeric" value={no} onChange={(e) => setNo(e.target.value)} placeholder={kind === 'gcash' ? '09171234567' : ''} required minLength={6} />
            </Field>
          </div>
          {kind === 'bank' ? (
            <Field label="Bank code" hint="e.g. BPI, BDO, LBP">
              <input id="po-bank" value={bank} onChange={(e) => setBank(e.target.value.toUpperCase())} required />
            </Field>
          ) : null}
          <div className="actions actions-end">
            {current ? (
              <button type="button" className="btn" onClick={() => setEdit(false)}>
                Cancel
              </button>
            ) : null}
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Verifying…' : 'Save and verify'}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

function TruckCard({ current, onDone }: { current: HaulerProfile | null; onDone: () => Promise<void> }) {
  const [plate, setPlate] = useState(current?.vehicle_plate ?? '');
  const [type, setType] = useState(current?.vehicle_type ?? 'Elf truck');
  const [cap, setCap] = useState(String(current?.capacity_heads ?? 10));
  const [rate, setRate] = useState(current?.rate_per_head ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (current) {
      setPlate(current.vehicle_plate);
      setType(current.vehicle_type);
      setCap(String(current.capacity_heads));
      setRate(current.rate_per_head ?? '');
    }
  }, [current]);
  return (
    <Card title="My truck">
      <form
        className="stack"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await putHaulerProfile({ vehicle_plate: plate.trim(), vehicle_type: type.trim(), capacity_heads: Number(cap), rate_per_head: rate ? Number(rate).toFixed(2) : null });
            await onDone();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorNote error={error} />
        <div className="row">
          <Field label="Plate">
            <input id="tk-plate" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} required minLength={4} />
          </Field>
          <Field label="Capacity, heads">
            <input id="tk-cap" type="number" inputMode="numeric" min={1} max={500} value={cap} onChange={(e) => setCap(e.target.value)} required />
          </Field>
        </div>
        <div className="row">
          <Field label="Vehicle">
            <input id="tk-type" value={type} onChange={(e) => setType(e.target.value)} required />
          </Field>
          <Field label="Rate per head, ₱ (optional)">
            <input id="tk-rate" type="number" inputMode="numeric" min={0} value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
        </div>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save truck'}
        </button>
      </form>
    </Card>
  );
}
