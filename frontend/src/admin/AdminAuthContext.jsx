/*
 * Who is signed in to the super admin console — deliberately separate from
 * ../context/AuthContext.jsx (see lib/adminApi.js for why). Scoped to the
 * /superadmin route subtree in App.jsx rather than wrapping the whole app,
 * since nothing outside that subtree needs it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { adminApi, clearAdminToken, getAdminToken, setAdminToken } from '../lib/adminApi.js';

const AdminAuthContext = createContext(null);

export const AdminAuthProvider = ({ children }) => {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getAdminToken()) {
      setAdmin(null);
      setLoading(false);
      return;
    }
    try {
      setAdmin(await adminApi('/me'));
    } catch {
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const signIn = useCallback((token, nextAdmin) => {
    setAdminToken(token);
    setAdmin(nextAdmin);
    setLoading(false);
  }, []);

  const signOut = useCallback(() => {
    clearAdminToken();
    setAdmin(null);
  }, []);

  const value = useMemo(() => ({ admin, loading, signIn, signOut }), [admin, loading, signIn, signOut]);

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
};

export const useAdminAuth = () => {
  const context = useContext(AdminAuthContext);
  if (!context) throw new Error('useAdminAuth must be used inside AdminAuthProvider');
  return context;
};
