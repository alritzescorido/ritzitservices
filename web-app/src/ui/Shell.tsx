import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

// Bottom tab bar, one set per role. A person with two roles sees both sets merged.
const TABS = {
  farmer: [
    { to: '/', label: 'Presyo', end: true },
    { to: '/herd', label: 'Hayop' },
    { to: '/sell', label: 'Ibenta' },
    { to: '/deals', label: 'Deals' },
  ],
  buyer: [
    { to: '/', label: 'Presyo', end: true },
    { to: '/market', label: 'Bilhin' },
    { to: '/deals', label: 'Deals' },
  ],
  hauler: [
    { to: '/', label: 'Presyo', end: true },
    { to: '/jobs', label: 'Trabaho' },
    { to: '/trips', label: 'Biyahe' },
  ],
};

export function Shell() {
  const { user } = useAuth();
  const roles = (user?.roles ?? []).filter((r): r is 'farmer' | 'buyer' | 'hauler' => r in TABS);
  const seen = new Set<string>();
  const tabs = roles.flatMap((r) => TABS[r]).filter((t) => (seen.has(t.to) ? false : (seen.add(t.to), true)));
  tabs.push({ to: '/me', label: 'Ako' });
  return (
    <div className="app">
      {user && user.verification !== 'verified' ? (
        <div className={`banner ${user.verification === 'rejected' || user.verification === 'suspended' ? 'banner-warn' : ''}`}>
          {user.verification === 'pending' ? 'Account under review. Usually 2 working days. You can browse prices meanwhile.' : user.verification === 'rejected' ? `Verification rejected${user.verification_notes ? `: ${user.verification_notes}` : ''}. Fix the documents under Ako.` : 'Account suspended. Contact support.'}
        </div>
      ) : null}
      <main className="content">
        <Outlet />
      </main>
      <nav className="tabs">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={'end' in t && t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
