import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { adminLogin, adminTotp, getMe, logout as apiLogout } from '../api/admin';
import { loadSession, saveSession, setSessionLostHandler, type Session } from '../api/client';
import type { LoginStep, User } from '../api/types';

interface AuthState {
  session: Session | null;
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<LoginStep>;
  totp: (stepToken: string, code: string) => Promise<void>;
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

  // Confirm the stored session still works and still carries the admin role.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (session) {
        try {
          const me = await getMe();
          if (!cancelled) {
            if (!me.roles.includes('admin')) throw new Error('not admin');
            setUser(me);
          }
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
    // run once at mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback((email: string, password: string) => adminLogin(email, password), []);

  const totp = useCallback(async (stepToken: string, code: string) => {
    const pair = await adminTotp(stepToken, code);
    const s: Session = { access_token: pair.access_token, refresh_token: pair.refresh_token, user: pair.user };
    saveSession(s);
    setSession(s);
    setUser(pair.user);
  }, []);

  const signOut = useCallback(async () => {
    const s = loadSession();
    try {
      if (s) await apiLogout(s.refresh_token);
    } catch {
      // the server session may already be gone; clear locally regardless
    }
    saveSession(null);
    setSession(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ session, user, ready, login, totp, signOut }), [session, user, ready, login, totp, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
