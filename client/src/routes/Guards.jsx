import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Splash = () => <div className="grid min-h-screen place-items-center bg-base-200"><span className="loading loading-ring loading-lg" role="status" aria-label="Loading" /></div>;

/** Server enforces access too; this only decides what to show. */
export function RequireAuth() {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <Splash />;
  return status === 'in' ? <Outlet /> : <Navigate to="/login" state={{ from: loc.pathname }} replace />;
}

export function GuestOnly() {
  const { status } = useAuth();
  if (status === 'loading') return <Splash />;
  return status === 'in' ? <Navigate to="/dashboard" replace /> : <Outlet />;
}

export function RequireRole({ allow }) {
  const { roles } = useAuth();
  if (roles.some((r) => allow.includes(r))) return <Outlet />;
  return (
    <section className="mx-auto max-w-xl">
      <h1 className="text-2xl font-extrabold">No access</h1>
      <p className="mt-2 opacity-80">Your account does not have permission to open this page.</p>
    </section>
  );
}
