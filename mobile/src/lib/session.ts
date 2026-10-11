/*
 * Who is signed in, which business and outlet they are working in, and the api that uses them. The token lives in the phone's keystore
 * (expo-secure-store), never in plain storage. Signing out clears it and the catalogue copy.
 */
import * as SecureStore from 'expo-secure-store';
import { createApi, type Session } from './api.ts';
import { createStore, useStore } from './store.ts';
import { closeScope, kvGet, kvSet, openScope } from './local.ts';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:5100').replace(/\/$/, '');   // 10.0.2.2 = the computer, seen from an Android emulator
const KEY = 'flowxp.session';

export type Outlet = { branch_id: number; name: string; is_primary: boolean };
export type Business = {
  business_id: number; name: string; business_type: string; currency: string; role: string; upi_vpa: string | null;
  permissions: Record<string, boolean>; effective_permissions?: Record<string, boolean>; branch_id: number | null; outlets: Outlet[];
};
export type User = { user_id: number; name: string; email: string };
type State = { ready: boolean; token: string | null; user: User | null; businesses: Business[]; businessId: number | null; branchId: number | null };

export const sessionStore = createStore<State>({ ready: false, token: null, user: null, businesses: [], businessId: null, branchId: null });

const save = () => {
  const { token, businessId, branchId } = sessionStore.get();
  const value: Session = { token, businessId, branchId };
  (token ? SecureStore.setItemAsync(KEY, JSON.stringify(value)) : SecureStore.deleteItemAsync(KEY)).catch(() => {});
};

export const api = createApi({
  baseUrl: API_URL,
  getSession: () => sessionStore.get(),
  onToken: (token) => { sessionStore.set({ token }); save(); },
  onUnauthorized: () => { void signOut(); }
});

/** Read what the keystore remembers, and slide the session forward if the server is reachable. Offline, the saved session is kept as it is. */
export const restoreSession = async () => {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Session;
      sessionStore.set({ token: saved.token, businessId: saved.businessId, branchId: saved.branchId });
      // with no connection the person and their outlets come from the copy kept at the last sign-in, so the till opens and bills offline
      const cached = await kvGet('me').catch(() => null);
      if (cached) { const me = JSON.parse(cached) as { user: User; businesses: Business[] }; sessionStore.set({ user: me.user, businesses: me.businesses }); }
      await loadMe().catch(() => {});
      const { businessId, branchId } = sessionStore.get();
      if (businessId != null && branchId != null) await openScope(businessId, branchId);
    }
  } finally { sessionStore.set({ ready: true }); }
};

/** The person, their businesses and outlets, and a fresh token (see api.refreshSession). */
export const loadMe = async () => {
  const me = await api.refreshSession() as unknown as { user: User; businesses: Business[] };
  sessionStore.set({ user: me.user, businesses: me.businesses });
  void kvSet('me', JSON.stringify({ user: me.user, businesses: me.businesses })).catch(() => {});
  const { businessId, branchId } = sessionStore.get();
  const business = me.businesses.find((b) => b.business_id === businessId);
  // a business or outlet that is no longer theirs is forgotten
  if (!business) sessionStore.set({ businessId: null, branchId: null });
  else if (branchId != null && !business.outlets.some((o) => o.branch_id === branchId)) sessionStore.set({ branchId: null });
  save();
};

export const signedIn = async (token: string) => { sessionStore.set({ token }); save(); await loadMe(); };

export const chooseOutlet = async (businessId: number, branchId: number) => {
  sessionStore.set({ businessId, branchId });
  save();
  await openScope(businessId, branchId);
};

/* Sign out ends the session and forgets who it was, but keeps the outlet's database: unsent sales are real money, sent after the next sign-in. */
const signOutHooks: (() => Promise<void>)[] = [];
/** Something to do just before a sign-out, while the session still works (taking this phone off the alerts list). Failures are ignored: signing out always completes. */
export const onSignOut = (fn: () => Promise<void>) => { signOutHooks.push(fn); };

let leaving = false;
export const signOut = async () => {
  // the hooks call the server, and a refused call signs out again: only the first sign-out runs them
  if (sessionStore.get().token && !leaving) {
    leaving = true;
    try { await Promise.race([Promise.allSettled(signOutHooks.map((f) => f())), new Promise((r) => setTimeout(r, 3000))]); } finally { leaving = false; }
  }
  closeScope();
  sessionStore.set({ token: null, user: null, businesses: [], businessId: null, branchId: null });
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
  await kvSet('me', '').catch(() => {});
};

export const useSession = () => useStore(sessionStore);
export const currentBusiness = (s: State) => s.businesses.find((b) => b.business_id === s.businessId) ?? null;
