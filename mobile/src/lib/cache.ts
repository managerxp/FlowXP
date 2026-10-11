/*
 * Reading a page of data so it still shows something with no signal. Ask the server; on success remember the answer on the phone; if the
 * server cannot be reached, show the last answer, marked with when it was from. A refusal from the server (not allowed, not found) is NOT
 * hidden behind old data: the person must see it.
 */
import { NetworkError } from './api.ts';

export type Store = { get: (key: string) => Promise<string | null>; set: (key: string, value: string) => Promise<void> };
export type Loaded<T> = { data: T; at: number; fromCache: boolean };

export const cachedLoad = async <T,>(key: string, fetcher: () => Promise<T>, store: Store, now: () => number = () => Date.now()): Promise<Loaded<T>> => {
  try {
    const data = await fetcher();
    const at = now();
    store.set(`cache:${key}`, JSON.stringify({ at, data })).catch(() => {});
    return { data, at, fromCache: false };
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    const raw = await store.get(`cache:${key}`).catch(() => null);
    if (!raw) throw e;
    try { const kept = JSON.parse(raw) as { at: number; data: T }; return { data: kept.data, at: kept.at, fromCache: true }; } catch { throw e; }
  }
};

/** What was kept last time, without asking the server (to paint a page at once while it refreshes). */
export const cachedRead = async <T,>(key: string, store: Store): Promise<Loaded<T> | null> => {
  const raw = await store.get(`cache:${key}`).catch(() => null);
  if (!raw) return null;
  try { const kept = JSON.parse(raw) as { at: number; data: T }; return { data: kept.data, at: kept.at, fromCache: true }; } catch { return null; }
};
