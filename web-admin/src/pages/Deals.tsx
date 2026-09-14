import { useEffect, useState } from 'react';
import { adminListDeals, adminReviewOutlier, getDeal, listLocations } from '../api/admin';
import { day, money, unitLabel, when } from '../api/format';
import { DEAL_STATES, SPECIES, SPECIES_LABEL, type Deal, type DealEvent, type DealState, type Location, type Species } from '../api/types';
import { Badge, Card, Empty, ErrorNote, Loading, PageHeader } from '../ui/components';

const STATE_TONE: Record<DealState, 'ok' | 'warn' | 'info' | 'muted' | 'pending'> = {
  accepted: 'info',
  hauler_assigned: 'info',
  in_transit: 'info',
  delivered: 'pending',
  settled: 'ok',
  disputed: 'warn',
  refunded: 'muted',
  cancelled: 'muted',
};

export function Deals() {
  const [state, setState] = useState<DealState | ''>('');
  const [species, setSpecies] = useState<Species | ''>('');
  const [province, setProvince] = useState('');
  const [outliers, setOutliers] = useState(false);
  const [provinces, setProvinces] = useState<Location[]>([]);
  const [items, setItems] = useState<Deal[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Deal | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    listLocations({ level: 'province', limit: 100 })
      .then((p) => setProvinces(p.items))
      .catch(() => setProvinces([]));
  }, []);

  const load = async (more = false) => {
    setLoading(true);
    setError(null);
    try {
      const page = await adminListDeals({ state: state || undefined, species: species || undefined, province_code: province || undefined, outliers_only: outliers || undefined, cursor: more ? cursor ?? undefined : undefined, limit: 50 });
      setItems((prev) => (more ? [...prev, ...page.items] : page.items));
      setCursor(page.next_cursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, species, province, outliers]);

  const open = async (d: Deal) => {
    setSelected(d);
    try {
      setSelected(await getDeal(d.id));
    } catch (e) {
      setError(e);
    }
  };

  const review = async (d: Deal, counts: boolean) => {
    const note = window.prompt(counts ? 'Why does this deal count? (audit note)' : 'Why is it kept out of the board? (audit note)', '') ?? undefined;
    if (note === undefined) return;
    try {
      const updated = await adminReviewOutlier(d.id, counts, note);
      setSelected(updated);
      setItems((prev) => prev.map((x) => (x.id === d.id ? { ...x, counts_for_price: updated.counts_for_price } : x)));
    } catch (e) {
      setError(e);
    }
  };

  return (
    <>
      <PageHeader
        title="Deals"
        sub="Every deal, newest first. Only settled deals that count feed the board; flagged outliers wait for your review."
        actions={
          <>
            <select value={state} onChange={(e) => setState(e.target.value as DealState | '')} aria-label="State">
              <option value="">All states</option>
              {DEAL_STATES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
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
            <select value={province} onChange={(e) => setProvince(e.target.value)} aria-label="Province">
              <option value="">All provinces</option>
              {provinces.map((p) => (
                <option key={p.psgc_code} value={p.psgc_code}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="check">
              <input type="checkbox" checked={outliers} onChange={(e) => setOutliers(e.target.checked)} /> Flagged only
            </label>
          </>
        }
      />
      <ErrorNote error={error} />
      <div className="split split-wide">
        <Card className="split-list">
          {loading && items.length === 0 ? <Loading /> : null}
          {!loading && items.length === 0 ? <Empty>No deals match. Deals appear when a farmer accepts an offer.</Empty> : null}
          {items.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Accepted</th>
                  <th>Lot</th>
                  <th>Parties</th>
                  <th className="num">Price</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id} className={`clickable ${selected?.id === d.id ? 'row-selected' : ''}`} onClick={() => open(d)}>
                    <td className="nowrap small">{day(d.accepted_at.slice(0, 10))}</td>
                    <td>
                      {SPECIES_LABEL[d.species]} {d.weight_class ? d.weight_class.label : ''} × {d.agreed_heads}
                      <div className="muted small">{d.location.display_name}</div>
                    </td>
                    <td className="small">
                      {d.farmer_name}
                      <div className="muted">→ {d.buyer_name}</div>
                    </td>
                    <td className="num">
                      {money(d.agreed_price)}
                      <span className="muted small">{unitLabel(d.unit)}</span>
                      {d.outlier_flag ? (
                        <div>
                          <Badge status={d.counts_for_price ? 'ok' : 'warn'}>{d.counts_for_price ? 'outlier, counted' : 'outlier, held'}</Badge>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Badge status={STATE_TONE[d.state]}>{d.state.replace('_', ' ')}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {cursor ? (
            <button className="btn btn-link" onClick={() => load(true)} disabled={loading}>
              Load older
            </button>
          ) : null}
        </Card>
        <div className="split-detail">
          {selected ? (
            <Card>
              <div className="detail-head">
                <div>
                  <h2>
                    {SPECIES_LABEL[selected.species]} {selected.weight_class?.label ?? ''} × {selected.agreed_heads}
                  </h2>
                  <div className="muted small">
                    {selected.farmer_name} (farmer) → {selected.buyer_name} (buyer) · {selected.location.display_name}
                  </div>
                </div>
                <Badge status={STATE_TONE[selected.state]}>{selected.state.replace('_', ' ')}</Badge>
              </div>
              <DealFacts deal={selected} />
              {selected.state === 'settled' ? (
                <div className="actions" style={{ marginTop: 10 }}>
                  <Badge status={selected.counts_for_price ? 'ok' : 'warn'}>{selected.counts_for_price ? 'counts for the board' : 'kept out of the board'}</Badge>
                  {selected.counts_for_price ? (
                    <button className="btn btn-small" onClick={() => review(selected, false)}>
                      Keep out of board
                    </button>
                  ) : (
                    <button className="btn btn-small btn-primary" onClick={() => review(selected, true)}>
                      Let it count
                    </button>
                  )}
                </div>
              ) : null}
              <h3>Timeline</h3>
              <DealTimeline events={selected.events ?? []} />
            </Card>
          ) : (
            <Card>Select a deal to see its facts and timeline.</Card>
          )}
        </div>
      </div>
    </>
  );
}

export function DealFacts({ deal }: { deal: Deal }) {
  const rows: [string, string][] = [
    ['Agreed', `${money(deal.agreed_price)}${unitLabel(deal.unit)} × ${deal.agreed_heads} heads${deal.agreed_weight_kg ? ` · ${deal.agreed_weight_kg} kg declared` : ''} · est. ${money(deal.estimated_total)}`],
    ['Delivered', deal.delivered_heads === null ? 'not yet' : `${deal.delivered_heads} heads${deal.delivered_weight_kg ? ` · ${deal.delivered_weight_kg} kg weighed` : ''} · ${money(deal.final_total)} · ${when(deal.delivered_at)}`],
    ['Hauling', deal.needs_hauler ? 'hauler booked in app' : 'buyer brings own truck'],
    ['Payment', deal.payment_method ? `${deal.payment_method}${deal.payment_reference ? ` ref ${deal.payment_reference}` : ''} · buyer ${when(deal.buyer_paid_at)}${deal.farmer_confirmed_at ? ` · farmer confirmed ${when(deal.farmer_confirmed_at)}` : ' · farmer has not confirmed'}` : 'not recorded'],
  ];
  if (deal.cancel_reason) rows.push(['Cancelled', deal.cancel_reason]);
  return (
    <table className="facts">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DealTimeline({ events }: { events: DealEvent[] }) {
  if (events.length === 0) return <p className="muted small">No events loaded.</p>;
  return (
    <ol className="timeline">
      {events.map((e, i) => (
        <li key={i}>
          <b>{e.to_state.replace('_', ' ')}</b> <span className="muted small">{when(e.created_at)}</span>
          {e.note ? <div className="small">{e.note}</div> : null}
        </li>
      ))}
    </ol>
  );
}
