import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useAuth } from '../../context/AuthContext.jsx';

const Ctx = createContext(null);
export const useSession = () => useContext(Ctx);

/** Who is working and in which books. There is one set of books per FlowXP business, and it is the business FlowXP is working in; `o(path)` calls the API inside it. */
export const SessionProvider = ({ children }) => {
  const { signOut, businessId } = useAuth();
  const [state, setState] = useState({ ready: false, user: null, orgs: [], error: '' });

  const refresh = useCallback(async () => {
    try { const me = await api('/me'); setState({ ready: true, user: me.user, orgs: me.organizations, error: '' }); }
    catch (e) { setState({ ready: true, user: null, orgs: [], error: e.message }); }
  }, []);
  useEffect(() => { setState((s) => ({ ...s, ready: false })); refresh(); }, [refresh, businessId]);

  const org = state.orgs[0] || null;
  const value = useMemo(() => ({
    ...state, org,
    on: (feature) => !(org?.features_off || []).includes(feature),   // false when the FlowXP super admin switched that feature off for this business
    o: (path, opts) => api(`/orgs/${org.id}${path}`, opts),
    refresh, signOut
  }), [state, org, refresh, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
