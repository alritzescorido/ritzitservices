import { useEffect, useState } from 'react';
import { adminReportDealsCsvPath, adminReportSummary, listLocations } from '../api/admin';
import { API_BASE, loadSession } from '../api/client';
import { day, money, todayManila } from '../api/format';
import { SPECIES_LABEL, type Location, type ReportSummary } from '../api/types';
import { Badge, Card, ErrorNote, Field, Loading, PageHeader } from '../ui/components';

// Phase 4: is the system healthy, where is trade thin, and a CSV for the
// province admin's own spreadsheet. Every number comes from one summary call.

const daysAgo = (n: number) => {
  const d = new Date(Date.now() + 8 * 3600_000 - n * 86_400_000);
  return d.toISOString().slice(0, 10);
};

export function Reports() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayManila());
  const [province, setProvince] = useState('');
  const [provinces, setProvinces] = useState<Location[]>([]);
  const [r, setR] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    listLocations({ level: 'province', limit: 100 })
      .then((p) => setProvinces(p.items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    adminReportSummary({ from, to, province_code: province || undefined })
      .then((s) => live && setR(s))
      .catch((e) => live && setError(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [from, to, province]);

  // The CSV needs the bearer token, so fetch it and hand the bytes to the browser.
  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`${API_BASE}${adminReportDealsCsvPath({ from, to, province_code: province || undefined })}`, {
        headers: { Authorization: `Bearer ${loadSession()?.access_token ?? ''}` },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `deals-${from}-${to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e);
    } finally {
      setDownloading(false);
    }
  };

  const total = (xs: { count: number }[]) => xs.reduce((n, x) => n + x.count, 0);
  const hours = (h: number | null) => (h === null ? '—' : h < 48 ? `${h.toFixed(0)} h` : `${(h / 24).toFixed(1)} d`);

  return (
    <>
      <PageHeader
        title="Reports"
        sub="Volume, prices, people, time to settle, disputes, deposits and hauling for a period. Thin municipalities show where the board still leans on reference prices."
        actions={
          <>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <input type="date" value={to} min={from} max={todayManila()} onChange={(e) => setTo(e.target.value)} aria-label="To" />
            <select value={province} onChange={(e) => setProvince(e.target.value)} aria-label="Province">
              <option value="">All provinces</option>
              {provinces.map((p) => (
                <option key={p.psgc_code} value={p.psgc_code}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="btn" onClick={download} disabled={downloading}>
              {downloading ? 'Exporting…' : 'Export deals CSV'}
            </button>
          </>
        }
      />
      <ErrorNote error={error} />
      {loading && !r ? <Loading /> : null}
      {r ? (
        <>
          <div className="tiles">
            <Card>
              <div className="tile-label">Deals accepted</div>
              <div className="tile-value">{total(r.deals.by_state)}</div>
              <div className="muted small">{r.deals.by_state.map((s) => `${s.count} ${s.state.replace('_', ' ')}`).join(' · ') || 'none in the period'}</div>
            </Card>
            <Card>
              <div className="tile-label">Settled</div>
              <div className="tile-value">{r.settlement.settled}</div>
              <div className="muted small">
                median {hours(r.settlement.median_hours_accept_to_settle)} from acceptance · slowest tenth {hours(r.settlement.p90_hours_accept_to_settle)}
              </div>
            </Card>
            <Card>
              <div className="tile-label">Disputes</div>
              <div className="tile-value">{r.disputes.opened}</div>
              <div className="muted small">
                {r.disputes.rate_pct === null ? 'no deliveries yet' : `${r.disputes.rate_pct}% of deliveries`} · {r.disputes.open_now} open now
              </div>
            </Card>
            <Card>
              <div className="tile-label">Held out of the board</div>
              <div className="tile-value">{r.deals.outliers_pending_review}</div>
              <div className="muted small">settled deals flagged as outliers or over the weekly limit, awaiting review under Deals</div>
            </Card>
            <Card>
              <div className="tile-label">Deposits held</div>
              <div className="tile-value">{money(r.deposits.held_net)}</div>
              <div className="muted small">
                {r.deposits.asked} asked · {r.deposits.paid} paid · {r.deposits.lapsed} lapsed · {r.deposits.released} released · {r.deposits.forfeited} forfeited · {r.deposits.refunded} refunded
              </div>
            </Card>
            <Card>
              <div className="tile-label">Hauled in the app</div>
              <div className="tile-value">
                {r.hauling.hauled_in_app}
                <span className="muted small"> / {r.hauling.deals_needing_hauler}</span>
              </div>
              <div className="muted small">{r.hauling.checklist_complete_pct === null ? 'no shipments yet' : `${r.hauling.checklist_complete_pct}% with the full pickup checklist`}</div>
            </Card>
          </div>

          <div className="split-wide">
            <Card title="Settled volume by species">
              {r.deals.settled_by_species.length === 0 ? (
                <p className="empty">Nothing settled in the period.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Species</th>
                      <th className="right">Deals</th>
                      <th className="right">Heads</th>
                      <th className="right">Weighed kg</th>
                      <th className="right">Gross value</th>
                      <th className="right">Median price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.deals.settled_by_species.map((s) => (
                      <tr key={s.species}>
                        <td>{SPECIES_LABEL[s.species]}</td>
                        <td className="right">{s.deals}</td>
                        <td className="right">{s.heads}</td>
                        <td className="right">{s.weight_kg ?? '—'}</td>
                        <td className="right">{money(s.gross_value)}</td>
                        <td className="right">
                          {money(s.median_price)}
                          <span className="muted small">{s.unit === 'per_head' ? '/head' : '/kg'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title="People">
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th className="right">Total</th>
                    <th className="right">Verified</th>
                    <th className="right">Pending</th>
                    <th className="right">Active in period</th>
                  </tr>
                </thead>
                <tbody>
                  {r.users.by_role.map((u) => (
                    <tr key={u.role}>
                      <td>{u.role}</td>
                      <td className="right">{u.total}</td>
                      <td className="right">{u.verified}</td>
                      <td className="right">{u.pending}</td>
                      <td className="right">{u.active_in_period}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">Active means a sign-in, listing, offer, deal or shipment between {day(r.from)} and {day(r.to)}.</p>
            </Card>
          </div>

          <Card title="Thin municipalities (last 30 days)">
            {r.thin_municipalities.length === 0 ? (
              <p className="empty">Every municipality with listings has enough settled deals for a live median.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Municipality</th>
                    <th>Species</th>
                    <th className="right">Listings</th>
                    <th className="right">Settled</th>
                    <th>Board shows</th>
                  </tr>
                </thead>
                <tbody>
                  {r.thin_municipalities.map((t) => (
                    <tr key={`${t.location.psgc_code}-${t.species}`}>
                      <td>{t.location.display_name}</td>
                      <td>{SPECIES_LABEL[t.species]}</td>
                      <td className="right">{t.listings_30d}</td>
                      <td className="right">
                        {t.settled_30d} <span className="muted small">of {t.needed} needed</span>
                      </td>
                      <td>
                        <Badge status="muted">province or reference price</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted small">A municipality needs {r.thin_municipalities[0]?.needed ?? 5} settled deals in the window before the board shows its own median. Until then it falls back to the province, then to the reference price.</p>
          </Card>
        </>
      ) : null}
      {!loading && !r && !error ? <Field label="Period">No data.</Field> : null}
    </>
  );
}
