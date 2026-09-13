import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/verification', label: 'Verification' },
  { to: '/reference-prices', label: 'Reference prices' },
  { to: '/restricted-zones', label: 'Restricted zones' },
  { to: '/audit-log', label: 'Audit log' },
  { to: '/account', label: 'Account' },
];

export function Shell() {
  const { user } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <b>Price Board</b>
            <div className="muted small">Admin console</div>
          </div>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot muted small">
          {user?.full_name || 'Admin'}
          <br />
          Every action here is written to the audit log under your name.
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
