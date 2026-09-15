import { useEffect, useState } from 'react';
import { getBoard, listFarms } from '../api/app';
import { day } from '../api/format';
import { SPECIES, SPECIES_LABEL, type Board as BoardDto, type BoardRow, type Species } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Card, Empty, ErrorNote, Loading, LocationPicker, Price, Screen, useHomeLocation } from '../ui/components';

// Wireframe Main: the running price per weight class for my municipality,
// with where the number comes from on every row. Updated 5:00 AM and after
// every sale. The last good board is kept on the device for the field.
export function Board() {
  const { user } = useAuth();
  const [home, setHome] = useHomeLocation();
  const [species, setSpecies] = useState<Species | ''>('');
  const [board, setBoard] = useState<BoardDto | null>(() => {
    try {
      const raw = localStorage.getItem('lpb.board');
      return raw ? (JSON.parse(raw) as BoardDto) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // First run for a farmer: take the municipality from the first farm.
  useEffect(() => {
    if (home || !user?.roles.includes('farmer')) return;
    listFarms()
      .then((r) => {
        const f = r.items[0];
        const muni = f?.location.path?.find((p) => p.level === 'municipality');
        if (muni) setHome({ ...muni, display_name: f.location.display_name.split(',').slice(1).join(',').trim() || muni.name });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home, user]);

  useEffect(() => {
    if (!home) return;
    let live = true;
    setLoading(true);
    setError(null);
    getBoard(home.psgc_code, species || undefined)
      .then((b) => {
        if (!live) return;
        setBoard(b);
        setOffline(false);
        try {
          if (!species) localStorage.setItem('lpb.board', JSON.stringify(b));
        } catch {
          // no storage: fine
        }
      })
      .catch((e) => {
        if (!live) return;
        if (board && board.municipality.psgc_code === home.psgc_code) setOffline(true);
        else setError(e);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home, species]);

  const rows = (board?.items ?? []).filter((r) => !species || r.species === species);

  return (
    <Screen title="Presyo ngayon" sub={board ? `${board.municipality.name}${board.province ? `, ${board.province.name}` : ''} · as of ${day(board.as_of)}` : 'Pick your municipality'}>
      {!home ? (
        <Card title="Saang bayan?">
          <LocationPicker level="municipality" value={null} onChange={setHome} placeholder="Municipality or city…" />
        </Card>
      ) : (
        <div className="between small" style={{ marginBottom: 10 }}>
          <span className="muted">Prices for {home.display_name}</span>
          <button className="btn btn-link" onClick={() => setHome(null)}>
            change
          </button>
        </div>
      )}
      {offline ? <div className="note">Offline. Showing the last saved board from {board ? day(board.as_of) : ''}.</div> : null}
      <ErrorNote error={error} />
      <div className="segmented" style={{ marginBottom: 10 }}>
        <button className={`btn btn-small ${species === '' ? 'btn-primary' : ''}`} onClick={() => setSpecies('')}>
          Lahat
        </button>
        {SPECIES.map((s) => (
          <button key={s} className={`btn btn-small ${species === s ? 'btn-primary' : ''}`} onClick={() => setSpecies(s)}>
            {SPECIES_LABEL[s]}
          </button>
        ))}
      </div>
      {loading && !board ? <Loading /> : null}
      {home && board && rows.length === 0 ? <Empty>No prices yet for this selection.</Empty> : null}
      {rows.map((r) => (
        <BoardCard key={`${r.species}-${r.weight_class.id}`} row={r} />
      ))}
      {board ? <p className="muted small center">Median of settled deals in the last {board.items[0]?.window_days ?? 7} days. A municipality needs 5 sales before it shows its own price; otherwise the province, then the PSA reference.</p> : null}
    </Screen>
  );
}

function BoardCard({ row }: { row: BoardRow }) {
  const pts = row.sparkline.map((v) => (v === null ? null : Number(v)));
  const nums = pts.filter((v): v is number => v !== null);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return (
    <Card>
      <div className="between">
        <b>
          {SPECIES_LABEL[row.species]} · {row.weight_class.label}
        </b>
        <span className={`badge ${row.source === 'municipality' ? 'badge-ok' : row.source === 'province' ? 'badge-info' : ''}`}>{row.source === 'municipality' ? 'live, this town' : row.source === 'province' ? 'live, province' : 'reference'}</span>
      </div>
      <Price row={row} />
      {nums.length > 1 ? (
        <div className="spark" aria-label="last 14 days">
          {pts.map((v, i) => (
            <i key={i} style={{ height: v === null ? 2 : max === min ? 14 : 4 + ((v - min) / (max - min)) * 24, opacity: v === null ? 0.15 : undefined }} />
          ))}
        </div>
      ) : null}
    </Card>
  );
}
