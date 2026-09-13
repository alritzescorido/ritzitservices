import { useEffect, useState, type FormEvent } from 'react';
import { adminCreateRestrictedZone, adminEndRestrictedZone, adminListRestrictedZones, searchLocations } from '../api/admin';
import { day, todayManila } from '../api/format';
import { SPECIES, SPECIES_LABEL, type LocationWithPath, type RestrictedZone, type Species } from '../api/types';
import { Badge, Card, Empty, ErrorNote, Field, Loading, PageHeader } from '../ui/components';

export function RestrictedZones() {
  const [activeOn, setActiveOn] = useState<string>(todayManila());
  const [all, setAll] = useState(false);
  const [zones, setZones] = useState<RestrictedZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setZones((await adminListRestrictedZones(all ? undefined : activeOn)).items);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOn, all]);

  const end = async (z: RestrictedZone) => {
    const d = window.prompt('End date (YYYY-MM-DD). Movement is allowed again the day after.', todayManila());
    if (!d) return;
    try {
      await adminEndRestrictedZone(z.id, d);
      await load();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <>
      <PageHeader
        title="Restricted zones"
        sub="Movement restrictions by location and species, for example African swine fever red zones. Haul jobs inside an active zone are not published."
        actions={
          <>
            <label className="check">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Include past and scheduled
            </label>
            {!all ? <input type="date" value={activeOn} onChange={(e) => setActiveOn(e.target.value)} aria-label="Active on" /> : null}
          </>
        }
      />
      <ErrorNote error={error} />
      <div className="split split-wide">
        <Card className="split-list">
          {loading ? <Loading /> : null}
          {!loading && zones.length === 0 ? <Empty>No restrictions {all ? 'recorded' : `active on ${day(activeOn)}`}.</Empty> : null}
          {zones.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Species</th>
                  <th>Reason</th>
                  <th>From</th>
                  <th>Until</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => {
                  const active = z.starts_on <= todayManila() && (!z.ends_on || z.ends_on >= todayManila());
                  return (
                    <tr key={z.id}>
                      <td>
                        <b>{z.location.name}</b>
                        <div className="muted small">{z.location.display_name}</div>
                      </td>
                      <td>{SPECIES_LABEL[z.species]}</td>
                      <td className="small">{z.reason}</td>
                      <td className="nowrap">{day(z.starts_on)}</td>
                      <td className="nowrap">{z.ends_on ? day(z.ends_on) : <Badge status={active ? 'warn' : 'muted'}>open-ended</Badge>}</td>
                      <td>
                        {!z.ends_on || z.ends_on >= todayManila() ? (
                          <button className="btn btn-small" onClick={() => end(z)}>
                            Set end date
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </Card>
        <div className="split-detail">
          <NewZone onCreated={load} />
        </div>
      </div>
    </>
  );
}

function NewZone({ onCreated }: { onCreated: () => Promise<void> }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<LocationWithPath[]>([]);
  const [loc, setLoc] = useState<LocationWithPath | null>(null);
  const [species, setSpecies] = useState<Species>('hog');
  const [reason, setReason] = useState('');
  const [starts, setStarts] = useState(todayManila());
  const [ends, setEnds] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      searchLocations(q.trim(), 'municipality')
        .then((r) => setHits(r.items))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!loc) return;
    setBusy(true);
    setError(null);
    try {
      await adminCreateRestrictedZone({ location_code: loc.psgc_code, species, reason: reason.trim(), starts_on: starts, ends_on: ends || null });
      setReason('');
      setLoc(null);
      setQ('');
      await onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Mark a location restricted">
      <form onSubmit={submit} className="stack">
        <Field label="Municipality or city" hint="Type at least two letters">
          {loc ? (
            <div className="chip">
              {loc.display_name}
              <button type="button" className="btn btn-link" onClick={() => setLoc(null)}>
                change
              </button>
            </div>
          ) : (
            <>
              <input id="rz-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Talavera" autoComplete="off" />
              {hits.length > 0 ? (
                <ul className="hits">
                  {hits.map((h) => (
                    <li key={h.psgc_code}>
                      <button type="button" className="btn btn-link" onClick={() => setLoc(h)}>
                        {h.display_name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </Field>
        <Field label="Species">
          <select id="rz-species" value={species} onChange={(e) => setSpecies(e.target.value as Species)}>
            {SPECIES.map((s) => (
              <option key={s} value={s}>
                {SPECIES_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reason (memo or order number)">
          <input id="rz-reason" required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ASF red zone, BAI memo 2026-41" />
        </Field>
        <div className="row">
          <Field label="Starts on">
            <input id="rz-starts" type="date" required value={starts} onChange={(e) => setStarts(e.target.value)} />
          </Field>
          <Field label="Ends on" hint="Leave empty if open-ended">
            <input id="rz-ends" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
          </Field>
        </div>
        <ErrorNote error={error} />
        <button className="btn btn-primary" disabled={busy || !loc || !reason.trim()}>
          {busy ? 'Saving…' : 'Restrict'}
        </button>
      </form>
    </Card>
  );
}
