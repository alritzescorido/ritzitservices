import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { acceptHaulJob, getHaulerProfile, listHaulJobs } from '../api/app';
import { day, money } from '../api/format';
import { SPECIES_LABEL, type HaulJob, type HaulerProfile } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, Empty, ErrorNote, Field, Loading, Screen } from '../ui/components';

// Wireframe HaulJobs: booked deals that want a truck, soonest pickup first.
export function Jobs() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [profile, setProfile] = useState<HaulerProfile | null>(null);
  const [jobs, setJobs] = useState<HaulJob[] | null>(null);
  const [fits, setFits] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = async () => {
    setError(null);
    try {
      setProfile(await getHaulerProfile().catch(() => null));
      setJobs((await listHaulJobs(fits || undefined)).items);
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fits]);

  return (
    <Screen
      title="Trabaho"
      sub={profile ? `${profile.vehicle_type} ${profile.vehicle_plate}, up to ${profile.capacity_heads} heads` : 'Add your truck under Ako to take jobs.'}
      actions={
        <label className="check small">
          <input type="checkbox" checked={fits} onChange={(e) => setFits(e.target.checked)} /> Fits my truck
        </label>
      }
    >
      {user?.verification !== 'verified' ? <div className="note">You can take jobs once your OR/CR and ID are verified.</div> : null}
      <ErrorNote error={error} />
      {jobs === null ? <Loading /> : null}
      {jobs && jobs.length === 0 ? <Empty>No open jobs right now. Jobs appear when a buyer's deposit is paid.</Empty> : null}
      {jobs?.map((j) => (
        <Card key={j.deal_id} onClick={() => setOpen(open === j.deal_id ? null : j.deal_id)}>
          <div className="between">
            <b>
              {j.heads} {SPECIES_LABEL[j.species]}
              {j.estimated_weight_kg ? ` · ~${Math.round(Number(j.estimated_weight_kg))} kg` : ''}
            </b>
            {j.fits_capacity === false ? <Badge status="warn">over capacity</Badge> : j.pickup_on ? <Badge status="info">{day(j.pickup_on)}</Badge> : null}
          </div>
          <div className="small">
            {j.farm_name}, {j.pickup.display_name}
            {j.dropoff ? ` → ${j.dropoff.display_name}` : ' → delivery point to be arranged'}
          </div>
          <div className="muted small">Needs: {j.needs.join(', ')}</div>
          {open === j.deal_id ? (
            <div onClick={(e) => e.stopPropagation()}>
              <AcceptForm j={j} profile={profile} disabled={user?.verification !== 'verified'} onDone={(id) => nav(`/trips/${id}`)} />
            </div>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}

function AcceptForm({ j, profile, disabled, onDone }: { j: HaulJob; profile: HaulerProfile | null; disabled: boolean; onDone: (shipmentId: string) => void }) {
  const [fee, setFee] = useState(profile?.rate_per_head ? String(Math.round(Number(profile.rate_per_head) * j.heads)) : profile?.rate_per_trip ?? '');
  const [when, setWhen] = useState(`${j.pickup_on ?? new Date(Date.now() + 86400000).toISOString().slice(0, 10)}T06:00`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await acceptHaulJob(j.deal_id, { agreed_fee: Number(fee).toFixed(2), scheduled_pickup_at: new Date(when).toISOString() });
      onDone(s.id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" style={{ marginTop: 12 }} onSubmit={submit}>
      <ErrorNote error={error} />
      <div className="row">
        <Field label="Your fee, ₱" hint={fee ? `${money(Number(fee) / j.heads)} per head` : undefined}>
          <input id={`fee-${j.deal_id}`} type="number" inputMode="numeric" min={1} value={fee} onChange={(e) => setFee(e.target.value)} required />
        </Field>
        <Field label="Pickup">
          <input id={`when-${j.deal_id}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
        </Field>
      </div>
      <button className="btn btn-primary btn-block" disabled={busy || disabled || !profile || j.fits_capacity === false}>
        {busy ? 'Taking…' : 'Take this job'}
      </button>
      <p className="muted small">Bring the LGU shipping permit and the veterinary health certificate. The trip cannot start without their numbers and a load photo.</p>
    </form>
  );
}
