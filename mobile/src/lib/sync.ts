/*
 * Keeping the phone and the server level: send the unsent sales first (so the stock the phone shows afterwards already counts them), then
 * bring the catalogue up to date. Runs when the till opens, every 30 seconds while the app is in use, when the app comes back to the
 * front, and straight after a sale was queued. A failure of any kind only shows in the badge; it never stops billing.
 */
import { AppState } from 'react-native';
import { createStore, useStore } from './store.ts';
import { ApiError, NetworkError } from './api.ts';
import { scopeStore } from './local.ts';
import { api } from './session.ts';
import { dayOf, sendEntry } from './till.ts';
import { guard, split } from './conflicts.ts';

type SyncState = {
  busy: boolean; pending: number; failed: number; changesPending: number; changesFailed: number; products: number; progress: number; syncedAt: number | null;
  stopped: null | 'offline' | 'server' | 'auth'; error: string;
};
export const syncStore = createStore<SyncState>({ busy: false, pending: 0, failed: 0, changesPending: 0, changesFailed: 0, products: 0, progress: 0, syncedAt: null, stopped: null, error: '' });
export const useSyncState = () => useStore(syncStore);

export const refreshCounts = async () => {
  const scope = scopeStore.get().scope;
  if (!scope) return;
  const c = await scope.outbox.counts(); const a = await scope.actions.counts();
  syncStore.set({ pending: c.pending, failed: c.failed, changesPending: a.pending, changesFailed: a.failed, products: await scope.catalog.count(), syncedAt: await scope.catalog.syncedAt() });
};

/** How long to wait before the next look: soon while something is waiting to send, rarely when all is quiet. */
export const pollDelay = (st: { pending: number; failed: number; changesPending: number; stopped: string | null }): number => (st.pending > 0 || st.changesPending > 0 ? 20000 : 120000);

let running: Promise<void> | null = null;
export const syncAll = (): Promise<void> => {
  if (running) return running;
  running = (async () => {
    const scope = scopeStore.get().scope;
    if (!scope) return;
    syncStore.set({ busy: true, error: '' });
    try {
      const flushed = await scope.outbox.flush(sendEntry(api));
      // then the price and stock changes made offline (bills first: a bill must see the stock as it was when it was made)
      const changed = flushed.stopped === null ? await scope.actions.flush(async (a) => { if ((await guard(api, a)) === 'skip') return; await api.call(a.path, { method: a.method, body: split(a.body).clean, idempotencyKey: a.id, ...(/^\/wholesale\/(orders|receipts)/.test(a.path) ? { headers: { 'X-Offline-Sale': '1' } } : /^\/distributor\/vehicles\/\d+\/sell$/.test(a.path) ? { headers: { 'X-Offline-Sale': '1', 'X-Sale-Date': dayOf(a.created_at) } } : {}) }); }) : null;
      syncStore.set({ stopped: flushed.stopped ?? changed?.stopped ?? null });
      await refreshCounts();
      if (flushed.stopped !== 'offline' && flushed.stopped !== 'auth' && changed?.stopped !== 'offline' && changed?.stopped !== 'auth') {
        try { await scope.catalog.sync(api, (n) => syncStore.set({ progress: n })); }
        catch (e) {
          if (e instanceof NetworkError || e instanceof ApiError) throw e;
          // the phone's own copy of the product list would not update: rebuild just that copy and download again once
          await scope.catalog.rebuild();
          await scope.catalog.sync(api, (n) => syncStore.set({ progress: n }));
        }
      }
    } catch (e) {
      const offline = e instanceof NetworkError;
      if (offline || e instanceof ApiError) {
        syncStore.set({ stopped: offline ? 'offline' : (e.status === 401 ? 'auth' : 'server'), error: offline ? '' : e.message });
      } else {
        // not the network and not the server: this phone's own storage (busy, full). Say so, and try again on the next round.
        syncStore.set({ stopped: null, error: `Could not update the products on this phone. ${e instanceof Error ? e.message.slice(0, 220) : ''} Go to More, Settings, Refresh the product list.` });
      }
    } finally {
      await refreshCounts().catch(() => {});
      syncStore.set({ busy: false });
    }
  })().finally(() => { running = null; });
  return running;
};

/** Start the background sync; returns the function that stops it. */
export const startAutoSync = (): (() => void) => {
  void syncAll();
  // battery: look every 20 seconds only while bills are waiting to go; when everything is sent, every 2 minutes (and whenever the app comes to the front)
  let stopped = false; let timer: ReturnType<typeof setTimeout>;
  const next = () => { if (stopped) return; timer = setTimeout(() => { void syncAll().finally(next); }, pollDelay(syncStore.get())); };
  next();
  const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void syncAll(); });
  return () => { stopped = true; clearTimeout(timer); sub.remove(); };
};
