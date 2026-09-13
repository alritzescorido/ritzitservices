import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ErrorNote, Field } from '../ui/components';
import type { LoginStep } from '../api/types';

export function SignIn() {
  const { user, login, totp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<LoginStep | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (user) return <Navigate to="/" replace />;

  const onPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setStep(await login(email, password));
      setPassword('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const onCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!step) return;
    setBusy(true);
    setError(null);
    try {
      await totp(step.step_token, code);
    } catch (err) {
      setError(err);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <aside className="signin-side">
        <div className="brand brand-invert">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <b>Price Board</b>
            <div className="small">Admin console</div>
          </div>
        </div>
        <div>
          <h1>Staff sign-in</h1>
          <p>Verification, reference prices, restricted zones and the audit log for the pilot provinces.</p>
          <p className="small">Accounts are created by a national admin. There is no self-registration on this page.</p>
        </div>
        <div className="small">Pilot build</div>
      </aside>
      <div className="signin-main">
        {!step ? (
          <form className="signin-form" onSubmit={onPassword}>
            <h2>Sign in</h2>
            <p className="muted">Work email and password, then the code from your authenticator app.</p>
            <Field label="Work email">
              <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <ErrorNote error={error} />
            <button className="btn btn-primary" disabled={busy || !email || !password}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
            <p className="small muted">Five failed attempts lock the account for 15 minutes.</p>
          </form>
        ) : (
          <form className="signin-form" onSubmit={onCode}>
            <h2>Authenticator code</h2>
            {step.totp_setup ? (
              <div className="note">
                <b>First sign-in: set up your authenticator.</b> Add this account in Google Authenticator, Authy or Aegis, then enter the code it shows.
                <div className="totp-secret">
                  <code>{step.totp_setup.secret}</code>
                </div>
                <a href={step.totp_setup.otpauth_url} className="small">
                  Open in an authenticator app on this device
                </a>
              </div>
            ) : (
              <p className="muted">Enter the 6-digit code from your authenticator app.</p>
            )}
            <Field label="6-digit code">
              <input
                id="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="code-input"
              />
            </Field>
            <ErrorNote error={error} />
            <button className="btn btn-primary" disabled={busy || code.length !== 6}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" className="btn btn-link" onClick={() => setStep(null)}>
              Start again
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
