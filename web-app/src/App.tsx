import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Board } from './pages/Board';
import { Deals } from './pages/Deals';
import { Herd } from './pages/Herd';
import { Jobs } from './pages/Jobs';
import { Market } from './pages/Market';
import { Me } from './pages/Me';
import { Register } from './pages/Register';
import { Sell } from './pages/Sell';
import { SignIn } from './pages/SignIn';
import { Trips } from './pages/Trips';
import { Shell } from './ui/Shell';

function RequireUser() {
  const { user, ready } = useAuth();
  const { pathname } = useLocation();
  if (!ready) return <p className="muted center">Loading…</p>;
  if (!user) return <Navigate to="/sign-in" replace />;
  // A phone with no name or role yet finishes registration first (new users are created with an empty name).
  const needsProfile = user.roles.filter((r) => r !== 'admin').length === 0 || !user.full_name;
  if (needsProfile && pathname !== '/register') return <Navigate to="/register" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route element={<RequireUser />}>
        <Route path="/register" element={<Register />} />
        <Route element={<Shell />}>
          <Route index element={<Board />} />
          <Route path="herd" element={<Herd />} />
          <Route path="sell" element={<Sell />} />
          <Route path="market" element={<Market />} />
          <Route path="deals" element={<Deals />} />
          <Route path="deals/:id" element={<Deals />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="trips" element={<Trips />} />
          <Route path="trips/:id" element={<Trips />} />
          <Route path="me" element={<Me />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
