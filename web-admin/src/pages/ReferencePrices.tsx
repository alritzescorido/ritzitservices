import { useEffect, useState, type FormEvent } from 'react';
import { adminImportReferencePrices, adminListReferencePrices, adminSetReferencePrice, listLocations, listWeightClasses } from '../api/admin';
import { day, money, todayManila, unitLabel, when } from '../api/format';
import { SPECIES, SPECIES_LABEL, type Location, type ReferencePrice, type Species, type WeightClass } from '../api/types';
import { Badge, Card, Empty, ErrorNote, Field, Loading, PageHeader } from '../ui/components';

export function ReferencePrices() {
  const [provinces, setProvinces] = useState<Location[]>([]);
  const [classes, setClasses] = useState<WeightClass[]>([]);
  const [province, setProvince] = useState('');
  const [species, setSpecies] = useState<Species | ''>('hog');
  const [history, setHistory] = useState(false);
  const [rows, setRows] = useState<ReferencePrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listLocations({ level: 'province', limit: 100 }), listWeightClasses()])
      .then(([p, w]) => {
        setProvinces(p.items);
        setClasses(w.items);
        if (!province && p.items[0]) setProvince(p.items[0].psgc_code);
      })
      .catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminListReferencePrices({ province_code: province || undefined, species: species || undefined, include_history: history });
      setRows(r.items);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [province, species, history]);

  const className = (id: number | null) => (id === null ? 'species-wide' : classes.find((c) => c.id === id)?.label ?? `class ${id}`);
  const provinceName = (code: string) => provinces.find((p) => p.psgc_code === code)?.name ?? code;

  return (
    <>
      <PageHeader
        title="Reference prices"
        sub="Used on the board when a municipality has fewer than 5 sales in 7 days. Farmers see these greyed, labelled as reference."
        actions={
          <>
            <select value={province} onChange={(e) => setProvince(e.target.value)} aria-label="Province">
              <option value="">All provinces</option>
              {provinces.map((p) => (
                <option key={p.psgc_code} value={p.psgc_code}>
                  {p.name}
                </option>
              ))}
            </select>
            <select value={species} onChange={(e) => setSpecies(e.target.value as Species | '')} aria-label="Species">
              <option value="">All species</option>
              {SPECIES.map((s) => (
                <option key={s} value={s}>
                  {SPECIES_LABEL[s]}
                </option>
              ))}
            </select>
            <label className="check">
              <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> Show history
            </label>
          </>
        }
      />
      <ErrorNote error={error} />
      {flash ? <div className="note">{flash}</div> : null}
      <div className="split split-wide">
        <Card className="split-list">
          {loading ? <Loading /> : null}
          {!loading && rows.length === 0 ? <Empty>No reference prices for this filter. Set one on the right or import the PSA series.</Empty> : null}
          {rows.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Province</th>
                  <th>Species</th>
                  <th>Weight class</th>
                  <th className="num">Price</th>
                  <th>Effective</th>
                  <th>Source</th>
                  {history ? <th>Set</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{provinceName(r.province_code)}</td>
                    <td>{SPECIES_LABEL[r.species]}</td>
                    <td>{className(r.weight_class_id)}</td>
                    <td className="num">
                      {money(r.price)}
                      <span className="muted small">{unitLabel(r.unit)}</span>
                    </td>
                    <td className="nowrap">{day(r.effective_from)}</td>
                    <td className="muted small">{r.source}</td>
                    {history ? <td className="muted small nowrap">{when(r.created_at)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>
        <div className="split-detail stack">
          <SetPriceForm
            provinces={provinces}
            classes={classes}
            defaultProvince={province}
            onSaved={(r) => {
              setFlash(r.large_change ? `Saved. This is more than 30% from the previous ${money(r.previous_price)}: flagged for a second admin.` : 'Saved.');
              void load();
            }}
          />
          <ImportCsv
            onImported={(n, large) => {
              setFlash(`Imported ${n} rows${large ? `, ${large} flagged as large changes` : ''}.`);
              void load();
            }}
          />
        </div>
      </div>
    </>
  );
}

function SetPriceForm({ provinces, classes, defaultProvince, onSaved }: { provinces: Location[]; classes: WeightClass[]; defaultProvince: string; onSaved: (r: ReferencePrice) => void }) {
  const [province, setProvince] = useState(defaultProvince);
  const [species, setSpecies] = useState<Species>('hog');
  const [weightClass, setWeightClass] = useState<string>('');
  const [price, setPrice] = useState('');
  const [source, setSource] = useState('');
  const [effective, setEffective] = useState(todayManila());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => setProvince(defaultProvince), [defaultProvince]);
  const speciesClasses = classes.filter((c) => c.species === species);
  const unit = speciesClasses[0]?.unit ?? 'per_kg_liveweight';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await adminSetReferencePrice({
        province_code: province,
        species,
        weight_class_id: weightClass ? Number(weightClass) : null,
        unit,
        price: Number(price).toFixed(2),
        source: source.trim(),
        effective_from: effective,
      });
      onSaved(r);
      setPrice('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Set a reference price">
      <form onSubmit={submit} className="stack">
        <Field label="Province">
          <select id="rp-province" value={province} onChange={(e) => setProvince(e.target.value)} required>
            {provinces.map((p) => (
              <option key={p.psgc_code} value={p.psgc_code}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="row">
          <Field label="Species">
            <select
              id="rp-species"
              value={species}
              onChange={(e) => {
                setSpecies(e.target.value as Species);
                setWeightClass('');
              }}
            >
              {SPECIES.map((s) => (
                <option key={s} value={s}>
                  {SPECIES_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Weight class" hint="Species-wide covers every class without its own row">
            <select id="rp-class" value={weightClass} onChange={(e) => setWeightClass(e.target.value)}>
              <option value="">Species-wide</option>
              {speciesClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="row">
          <Field label={`Price, pesos ${unitLabel(unit)}`}>
            <input id="rp-price" type="number" min="0.01" step="0.01" required value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Effective from" hint="Not earlier than 7 days ago">
            <input id="rp-effective" type="date" required value={effective} onChange={(e) => setEffective(e.target.value)} />
          </Field>
        </div>
        <Field label="Source (shown in the audit log)">
          <input id="rp-source" required maxLength={200} placeholder="PSA farmgate, week 36 2026" value={source} onChange={(e) => setSource(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <button className="btn btn-primary" disabled={busy || !province || !price || !source.trim()}>
          {busy ? 'Saving…' : 'Publish price'}
        </button>
        <p className="small muted">A change of more than 30% from the previous row is accepted but flagged for a second admin.</p>
      </form>
    </Card>
  );
}

function ImportCsv({ onImported }: { onImported: (inserted: number, large: number) => void }) {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const onFile = async (f: File | undefined) => {
    if (f) setCsv(await f.text());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await adminImportReferencePrices(csv);
      onImported(r.inserted, r.large_changes.length);
      setCsv('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Import a CSV (PSA farmgate series)">
      <form onSubmit={submit} className="stack">
        <p className="small muted">
          Columns: <code>province_code, species, weight_class_label, unit, price, effective_from, source</code>. The whole file is checked first; any bad row rejects it with line numbers and nothing is written.
        </p>
        <input id="rp-file" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
        <textarea id="rp-csv" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="paste CSV here or choose a file" />
        <ErrorNote error={error} />
        <button className="btn" disabled={busy || !csv.trim()}>
          {busy ? 'Importing…' : 'Import'}
        </button>
        {error ? <Badge status="warn">nothing was written</Badge> : null}
      </form>
    </Card>
  );
}
