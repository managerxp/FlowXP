/*
 * Who is signed in, and which business they are looking at.
 *
 * Context rather than a state library: there are two values here and one of
 * them rarely changes. Redux or Zustand would be a dependency to hold a user
 * object.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearToken, getBranchId, getBusinessId, setBranchId, setBusinessId, setToken } from '../lib/api.js';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [businesses, setBusinesses] = useState([]);
  const [businessId, setActiveBusinessId] = useState(() => Number(getBusinessId()) || null);
  // 'all' or an outlet id; validated against the business's outlets below.
  const [branch, setBranch] = useState(() => getBranchId());
  /* Starts true so a refresh on /app shows a loading state rather than
     bouncing the user to /login for the half-second before /auth/me answers. */
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api('/auth/me');
      setUser(data.user);
      setBusinesses(data.businesses);

      /* Keep the selection honest: a stored id for a business they have been
         removed from must not survive, or every request 404s. */
      setActiveBusinessId((current) => {
        const valid = data.businesses.some((b) => b.business_id === current);
        const next = valid ? current : (data.businesses[0]?.business_id ?? null);
        setBusinessId(next);
        return next;
      });
    } catch {
      setUser(null);
      setBusinesses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const signIn = useCallback((token, nextUser, nextBusinesses) => {
    setToken(token);
    setUser(nextUser);
    setBusinesses(nextBusinesses);
    const first = nextBusinesses[0]?.business_id ?? null;
    setBusinessId(first);
    setActiveBusinessId(first);
    setLoading(false);
    refresh();   // the sign-in reply has no outlet list; /auth/me does
  }, [refresh]);

  const signOut = useCallback(() => {
    // Told after the fact, not waited on: the session is over locally whether
    // or not the request lands, and a failed call must not trap the user in.
    api('/auth/logout', { method: 'POST' }).catch(() => {});
    clearToken();
    setUser(null);
    setBusinesses([]);
    setActiveBusinessId(null);
  }, []);

  const switchBusiness = useCallback((id) => {
    setBusinessId(id);
    setActiveBusinessId(id);
  }, []);

  const business = useMemo(
    () => businesses.find((b) => b.business_id === businessId) || null,
    [businesses, businessId]
  );

  /* Which outlet is being viewed. Someone pinned to one outlet has exactly that one; a group user
     with several picks (default: the main outlet, so billing always has a real outlet); with a
     single outlet there is nothing to pick and no header is sent. */
  const outlets = business?.outlets ?? [];
  const pinned = business?.branch_id != null;
  const canViewAll = !pinned && outlets.length > 1;
  const outletId = useMemo(() => {
    if (outlets.length <= 1) return null;
    if (pinned) return outlets[0]?.branch_id ?? null;
    if (branch === 'all') return 'all';
    const chosen = outlets.find((o) => String(o.branch_id) === String(branch));
    return chosen ? chosen.branch_id : (outlets.find((o) => o.is_primary) ?? outlets[0]).branch_id;
  }, [outlets, pinned, branch]);
  const activeOutlet = outletId === 'all' ? null : outlets.find((o) => o.branch_id === outletId) ?? null;

  // The API client reads the choice from storage, so keep it in step before any page fetches.
  setBranchId(outletId);

  const switchOutlet = useCallback((id) => { setBranchId(id); setBranch(id == null ? null : String(id)); }, []);

  const value = useMemo(() => ({
    user, businesses, business, businessId, loading,
    outlets, outletId, activeOutlet, pinned, canViewAll, switchOutlet,
    signIn, signOut, switchBusiness, refresh
  }), [user, businesses, business, businessId, loading, outlets, outletId, activeOutlet, pinned, canViewAll, switchOutlet, signIn, signOut, switchBusiness, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
};
