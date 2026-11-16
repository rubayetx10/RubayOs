import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, refreshSession, setOnSessionLost, setToken } from '../services/api';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export const ADMIN_ROLES = ['super_admin', 'college_admin', 'department_admin'];
export const ROLE_LABEL = {
  super_admin: 'Super Admin', college_admin: 'College Admin', department_admin: 'Department Admin',
  teacher: 'Teacher', cr: 'Class Representative', student: 'Student',
};
const OUT = { status: 'out', user: null, roles: [], profile: null };

export function AuthProvider({ children }) {
  const [state, setState] = useState({ ...OUT, status: 'loading' });
  const qc = useQueryClient();

  const loadMe = useCallback(async () => {
    const me = await apiFetch('/auth/me');
    setState({ status: 'in', user: me.user, roles: me.roles.map((r) => r.role), profile: me.profile });
  }, []);

  const clear = useCallback(() => { setToken(null); qc.clear(); setState(OUT); }, [qc]);

  useEffect(() => {
    setOnSessionLost(clear);
    // A returning visitor with a valid cookie lands straight in the app.
    refreshSession().then(loadMe).catch(() => setState(OUT));
  }, [clear, loadMe]);

  const login = useCallback(async (identifier, password) => {
    const d = await apiFetch('/auth/login', { method: 'POST', body: { identifier, password } });
    setToken(d.accessToken);
    await loadMe();
  }, [loadMe]);

  const register = useCallback(async (body) => {
    const d = await apiFetch('/auth/register', { method: 'POST', body });
    if (d.status === 'active') { setToken(d.accessToken); await loadMe(); }
    return d;
  }, [loadMe]);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    clear();
  }, [clear]);

  const value = useMemo(() => ({ ...state, isAdmin: state.roles.some((r) => ADMIN_ROLES.includes(r)), login, register, logout }), [state, login, register, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
