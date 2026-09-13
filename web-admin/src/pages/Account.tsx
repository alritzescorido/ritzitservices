import { useState, type FormEvent } from 'react';
import { adminChangePassword } from '../api/admin';
import { useAuth } from '../auth/AuthContext';
import { Card, ErrorNote, Field, PageHeader } from '../ui/components';

export function Account() {
  const { user, signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminChangePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Account" sub={user ? `${user.full_name} · ${user.phone_masked}` : ''} actions={<button className="btn" onClick={() => void signOut()}>Sign out</button>} />
      <div className="split">
        <Card title="Change password">
          <form onSubmit={submit} className="stack">
            <Field label="Current password">
              <input id="pw-current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" hint="At least 12 characters. A sentence works well.">
              <input id="pw-next" type="password" autoComplete="new-password" minLength={12} required value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="New password again">
              <input id="pw-again" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
            </Field>
            <ErrorNote error={error} />
            {done ? <div className="note">Password changed. Your other sessions were signed out.</div> : null}
            <button className="btn btn-primary" disabled={busy || next.length < 12 || next !== again}>
              {busy ? 'Saving…' : 'Change password'}
            </button>
          </form>
        </Card>
        <Card title="Authenticator">
          <p>Your authenticator app was enrolled on your first sign-in. If you lose the phone, a national admin resets your account with the admin creation command and you enrol again at the next sign-in.</p>
        </Card>
      </div>
    </>
  );
}
