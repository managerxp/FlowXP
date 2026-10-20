/* Is the server reachable? Every request the app makes tells us: an answer of any kind means yes, "no answer at all" means no. While the answer is no, the app checks again every few
   seconds, so the "No internet" bar goes away by itself the moment the signal is back. */
import { createStore, useStore } from './store.ts';

export const netStore = createStore<{ online: boolean; since: number | null }>({ online: true, since: null });
export const useOnline = (): boolean => useStore(netStore).online;

/** A request got an answer (online) or got none (offline). The time it went offline is kept. */
export const reportNetwork = (reachable: boolean, now = Date.now()): void => {
  const cur = netStore.get();
  if (cur.online === reachable) return;
  netStore.set({ online: reachable, since: reachable ? null : now });
};

/** The words a screen shows for a "could not reach the server" message. */
export const isOfflineMessage = (message: string): boolean => /offline|can't be reached|no internet|network/i.test(message);
export const PROBE_EVERY_MS = 8000;

/** "since 2 min" for the bar, from the moment it went offline. */
export const offlineFor = (since: number | null, now = Date.now()): string => {
  if (since == null) return '';
  const m = Math.floor((now - since) / 60000);
  return m < 1 ? 'just now' : m === 1 ? '1 minute' : m < 60 ? `${m} minutes` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
