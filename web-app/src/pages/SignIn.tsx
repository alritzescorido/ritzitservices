import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ErrorNote, Field } from '../ui/components';

// Wireframes Signin and OtpCode. Mobile number, then the 6-digit code sent by SMS.
export function SignIn() {
  const { user, ready, requestCode, verifyCode } = useAuth();
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  if (ready && user) return <Navigate to="/" replace />;

  const normalise = (p: string) => {
    const d = p.replace(/[^\d+]/g, '');
    if (d.startsWith('09') && d.length === 11) return `+63${d.slice(1)}`;
    if (d.startsWith('9') && d.length === 10) return `+63${d}`;
    if (d.startsWith('63') && d.length === 12) return `+${d}`;
    return d;
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = await requestCode(normalise(phone));
      setChallenge(c.challenge_id);
      setResendIn(c.resend_after_seconds ?? 60);
      setCode('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const u = await verifyCode(challenge, code);
      nav(u.full_name && u.roles.length ? '/' : '/register', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <h1>Presyo ng Hayop</h1>
          <div className="muted small">Running livestock prices. Sell to verified buyers.</div>
        </div>
      </div>
      <ErrorNote error={error} />
      {!challenge ? (
        <form onSubmit={send} className="stack">
          <Field label="Mobile number" hint="We text a 6-digit code. Standard SMS rates.">
            <input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0917 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} required autoFocus />
          </Field>
          <button className="btn btn-primary btn-block" disabled={busy || phone.replace(/\D/g, '').length < 10}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
          <p className="muted small">By continuing you agree that your number, name and documents are used to verify you as a farmer, buyer or hauler.</p>
        </form>
      ) : (
        <form onSubmit={verify} className="stack">
          <Field label={`Code sent to ${normalise(phone)}`} hint="Valid for 5 minutes. 5 wrong tries lock the code.">
            <input id="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
          </Field>
          <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
          <div className="actions">
            <button type="button" className="btn btn-link" onClick={() => send()} disabled={busy || resendIn > 0}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </button>
            <button type="button" className="btn btn-link" onClick={() => setChallenge(null)}>
              Change number
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
