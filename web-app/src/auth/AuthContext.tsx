import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getMe, logout as apiLogout, otpRequest, otpVerify, refreshToken } from '../api/app';
import { loadSession, saveSession, setSessionLostHandler, type Session } from '../api/client';
import type { OtpChallenge, User } from '../api/types';

interface AuthState {
  user: User | null;
  ready: boolean;
  requestCode: (phone: string) => Promise<OtpChallenge>;
  verifyCode: (challengeId: string, code: string) => Promise<User>;
  /** Re-issue tokens so new roles or verification land in the claims. */
  reload: () => Promise<User | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [user, setUser] = useState<User | null>(() => loadSession()?.user ?? null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSessionLostHandler(() => {
      setSession(null);
      setUser(null);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (session) {
        try {
          const me = await getMe();
          if (!cancelled) setUser(me);
        } catch {
          if (!cancelled) {
            saveSession(null);
            setSession(null);
            setUser(null);
          }
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestCode = useCallback((phone: string) => otpRequest(phone), []);

  const verifyCode = useCallback(async (challengeId: string, code: string) => {
    const pair = await otpVerify(challengeId, code);
    const s = { access_token: pair.access_token, refresh_token: pair.refresh_token, user: pair.user };
    saveSession(s);
    setSession(s);
    setUser(pair.user);
    return pair.user;
  }, []);

  const reload = useCallback(async () => {
    const s = loadSession();
    if (!s) return null;
    try {
      const pair = await refreshToken(s.refresh_token);
      const next = { access_token: pair.access_token, refresh_token: pair.refresh_token, user: pair.user };
      saveSession(next);
      setSession(next);
      setUser(pair.user);
      return pair.user;
    } catch {
      const me = await getMe();
      setUser(me);
      return me;
    }
  }, []);

  const signOut = useCallback(async () => {
    const s = loadSession();
    if (s) await apiLogout(s.refresh_token).catch(() => undefined);
    saveSession(null);
    setSession(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, requestCode, verifyCode, reload, signOut }), [user, ready, requestCode, verifyCode, reload, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
