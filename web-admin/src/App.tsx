import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Account } from './pages/Account';
import { AuditLog } from './pages/AuditLog';
import { Deals } from './pages/Deals';
import { Disputes } from './pages/Disputes';
import { Overview } from './pages/Overview';
import { ReferencePrices } from './pages/ReferencePrices';
import { RestrictedZones } from './pages/RestrictedZones';
import { SignIn } from './pages/SignIn';
import { Verification } from './pages/Verification';
import { Shell } from './ui/Shell';

function RequireAdmin() {
  const { user, ready } = useAuth();
  if (!ready) return <p className="muted center">Loading…</p>;
  if (!user) return <Navigate to="/sign-in" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route element={<RequireAdmin />}>
        <Route element={<Shell />}>
          <Route index element={<Overview />} />
          <Route path="verification" element={<Verification />} />
          <Route path="deals" element={<Deals />} />
          <Route path="disputes" element={<Disputes />} />
          <Route path="reference-prices" element={<ReferencePrices />} />
          <Route path="restricted-zones" element={<RestrictedZones />} />
          <Route path="audit-log" element={<AuditLog />} />
          <Route path="account" element={<Account />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
