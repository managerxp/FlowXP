import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const Ctx = createContext(null);
export const useSession = () => useContext(Ctx);

const ORG_KEY = 'fb_org';
const store = (fn) => { try { return fn(); } catch { return null; } };

/** Who is signed in, which organizations they belong to, and which one they are working in. `o(path)` calls the API inside that organization. */
export const SessionProvider = ({ children }) => {
  const [state, setState] = useState({ ready: false, user: null, orgs: [] });
  const [orgId, setOrgId] = useState(() => store(() => localStorage.getItem(ORG_KEY)));

  const refresh = useCallback(async () => {
    if (!getToken()) { setState({ ready: true, user: null, orgs: [] }); return; }
    try { const me = await api('/me'); setState({ ready: true, user: me.user, orgs: me.organizations }); }
    catch { setState({ ready: true, user: null, orgs: [] }); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const out = () => { setToken(null); setState({ ready: true, user: null, orgs: [] }); };
    window.addEventListener('fb-signout', out);
    return () => window.removeEventListener('fb-signout', out);
  }, []);

  const org = state.orgs.find((x) => String(x.id) === String(orgId)) || state.orgs[0] || null;
  const value = useMemo(() => ({
    ...state, org,
    on: (feature) => !(org?.features_off || []).includes(feature),   // false when the FlowXP super admin switched that feature off for this business
    o: (path, opts) => api(`/orgs/${org.id}${path}`, opts),
    pick: (id) => { store(() => localStorage.setItem(ORG_KEY, id)); setOrgId(id); },
    refresh,
    signIn: async (path, body) => { const r = await api(path, { method: 'POST', body }); setToken(r.token); await refresh(); },
    signOut: async () => { try { await api('/auth/logout', { method: 'POST' }); } catch { /* already out */ } setToken(null); setState({ ready: true, user: null, orgs: [] }); }
  }), [state, org, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
