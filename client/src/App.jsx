import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './layouts/AppShell';
import { ADMIN_ROLES } from './context/AuthContext';
import { GuestOnly, RequireAuth, RequireRole } from './routes/Guards';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Registrations from './pages/Registrations';
import Roster from './pages/Roster';
import Structure from './pages/Structure';
import SystemCheck from './pages/SystemCheck';

export default function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route element={<RequireRole allow={ADMIN_ROLES} />}>
            <Route path="/structure" element={<Structure />} />
            <Route path="/roster" element={<Roster />} />
            <Route path="/registrations" element={<Registrations />} />
            <Route path="/system" element={<SystemCheck />} />
          </Route>
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
