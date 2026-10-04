/*
 * Who is signed in, and which business they are looking at.
 *
 * Context rather than a state library: there are two values here and one of
 * them rarely changes. Redux or Zustand would be a dependency to hold a user
 * object.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearToken, forgetLegacyToken, getBranchId, getBusinessId, setBranchId, setBusinessId } from '../lib/api.js';
import { hasPermission } from '../lib/permissions.js';

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
      forgetLegacyToken();   // the answer carried the session cookie, so an old stored token is no longer needed
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

  /* The sign-in reply has already set the session cookie; the token in it is not kept anywhere in the page. */
  const signIn = useCallback((_token, nextUser, nextBusinesses) => {
    forgetLegacyToken();
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

  // what THIS person can do in the active business — the sidebar and screens read this
  // instead of role alone, so a per-user permission override (Staff → Permissions) is honoured too
  const can = useCallback((permission) => hasPermission(business, permission), [business]);

  // whether the business's PLAN includes a feature at all — separate from `can`, which is per-user.
  // Missing key = on, same rule as the backend (modules/planFeatures.js); a server route can still
  // refuse (402) if this runs on stale data, so this only ever hides a door, never opens one.
  const hasFeature = useCallback(
    (feature) => business?.subscription?.feature_flags?.[feature] !== false,
    [business]
  );

  const value = useMemo(() => ({
    user, businesses, business, businessId, loading,
    outlets, outletId, activeOutlet, pinned, canViewAll, switchOutlet, can, hasFeature,
    signIn, signOut, switchBusiness, refresh
  }), [user, businesses, business, businessId, loading, outlets, outletId, activeOutlet, pinned, canViewAll, switchOutlet, can, hasFeature, signIn, signOut, switchBusiness, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
};
