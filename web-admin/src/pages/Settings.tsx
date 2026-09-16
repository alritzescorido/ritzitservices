import { useEffect, useState } from 'react';
import { adminListSettings, adminSetSetting } from '../api/admin';
import { when } from '../api/format';
import type { PlatformSetting } from '../api/types';
import { Card, ErrorNote, Loading, PageHeader } from '../ui/components';

// Settings that change how the platform behaves, without a deploy. Every save
// writes an audit row, so the audit log answers who changed the commission and
// when. The help text comes from the API so it cannot drift from the code.
export function Settings() {
  const [items, setItems] = useState<PlatformSetting[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = async () => {
    setError(null);
    try {
      setItems((await adminListSettings()).items);
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const save = async (key: string, value: string | number | boolean) => {
    setError(null);
    try {
      setItems((await adminSetSetting(key, value)).items);
    } catch (e) {
      setError(e);
      await load();
    }
  };

  return (
    <>
      <PageHeader title="Settings" sub="How the platform behaves. A change takes effect on the next deal, and is written to the audit log under your name." />
      <ErrorNote error={error} />
      {items === null ? <Loading /> : null}
      {items?.map((s) => (
        <Card key={s.key} title={s.label}>
          <p className="muted small" style={{ maxWidth: '68ch' }}>
            {s.help}
          </p>
          {s.type === 'boolean' ? <BooleanSetting s={s} onSave={save} /> : <NumberSetting s={s} onSave={save} />}
          <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
            {s.set_by_admin ? `Last changed by ${s.updated_by_name ?? 'an admin'}, ${when(s.updated_at)}.` : 'Never changed here. Still using the value the server started with.'}
          </p>
        </Card>
      ))}
    </>
  );
}

function BooleanSetting({ s, onSave }: { s: PlatformSetting; onSave: (key: string, value: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const on = s.value === true;
  const toggle = async () => {
    setBusy(true);
    await onSave(s.key, !on);
    setBusy(false);
  };
  return (
    <div className="actions">
      <span className={`badge ${on ? 'badge-ok' : 'badge-muted'}`}>{on ? 'Required' : 'Not required'}</span>
      <button className="btn btn-small" disabled={busy} onClick={toggle}>
        {busy ? 'Saving…' : on ? 'Make it optional' : 'Make it required'}
      </button>
    </div>
  );
}

function NumberSetting({ s, onSave }: { s: PlatformSetting; onSave: (key: string, value: number) => Promise<void> }) {
  const current = Number(s.value);
  const [draft, setDraft] = useState(String(current));
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(String(Number(s.value))), [s.value]);

  const n = Number(draft);
  const valid = draft.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 20;
  const changed = valid && n !== current;
  // 10 hogs at 92 kg and ₱180 is a typical deal on this board.
  const example = 165_600;

  return (
    <>
      <div className="actions">
        <input id={`set-${s.key}`} type="number" min={0} max={20} step="0.1" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: 120 }} aria-label={s.label} />
        <span className="muted">%</span>
        <button
          className="btn btn-small btn-primary"
          disabled={busy || !changed}
          onClick={async () => {
            setBusy(true);
            await onSave(s.key, n);
            setBusy(false);
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {changed ? (
          <button className="btn btn-small" onClick={() => setDraft(String(current))}>
            Cancel
          </button>
        ) : null}
      </div>
      {!valid && draft.trim() !== '' ? <p className="small warn-text">Enter a number between 0 and 20.</p> : null}
      <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
        {n === 0
          ? 'Nothing is charged. Each deal still costs the platform roughly ₱380 in gateway and transfer fees.'
          : `On a ₱165,600 deal, 10 hogs at 92 kg and ₱180 a kilo, the buyer would pay ₱${Math.round((example * n) / 100).toLocaleString('en-PH')} on top of the ₱16,560 deposit. The farmer still receives ₱16,560.`}
      </p>
    </>
  );
}
