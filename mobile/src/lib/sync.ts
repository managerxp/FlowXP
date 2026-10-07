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
import { sendEntry } from './till.ts';

type SyncState = {
  busy: boolean; pending: number; failed: number; products: number; progress: number; syncedAt: number | null;
  stopped: null | 'offline' | 'server' | 'auth'; error: string;
};
export const syncStore = createStore<SyncState>({ busy: false, pending: 0, failed: 0, products: 0, progress: 0, syncedAt: null, stopped: null, error: '' });
export const useSyncState = () => useStore(syncStore);

export const refreshCounts = async () => {
  const scope = scopeStore.get().scope;
  if (!scope) return;
  const c = await scope.outbox.counts();
  syncStore.set({ pending: c.pending, failed: c.failed, products: await scope.catalog.count(), syncedAt: await scope.catalog.syncedAt() });
};

let running: Promise<void> | null = null;
export const syncAll = (): Promise<void> => {
  if (running) return running;
  running = (async () => {
    const scope = scopeStore.get().scope;
    if (!scope) return;
    syncStore.set({ busy: true, error: '' });
    try {
      const flushed = await scope.outbox.flush(sendEntry(api));
      syncStore.set({ stopped: flushed.stopped });
      await refreshCounts();
      if (flushed.stopped !== 'offline' && flushed.stopped !== 'auth') {
        await scope.catalog.sync(api, (n) => syncStore.set({ progress: n }));
      }
    } catch (e) {
      const offline = e instanceof NetworkError;
      syncStore.set({ stopped: offline ? 'offline' : (e instanceof ApiError && e.status === 401 ? 'auth' : 'server'), error: offline ? '' : e instanceof Error ? e.message : 'Sync failed' });
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
  const timer = setInterval(() => { void syncAll(); }, 30000);
  const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void syncAll(); });
  return () => { clearInterval(timer); sub.remove(); };
};
