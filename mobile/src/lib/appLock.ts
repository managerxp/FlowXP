/*
 * App lock (Settings > App lock): a 4-digit PIN asked when the app opens and when it comes back after being away for a while, so a phone left on the
 * counter does not show the business to whoever picks it up. The PIN stays on this phone only (in the phone's secure storage), is never sent anywhere,
 * and changes nothing stored. Forgot it: signing out clears it, and signing in again brings everything back from the server.
 * No React and no phone modules in here: the storage is passed in, so it can be tested.
 */
import { createStore, useStore } from './store.ts';

export const GRACE_MS = 30 * 1000;   // a quick switch to another app does not lock; half a minute away does
export type SecretStore = { get: () => Promise<string | null>; set: (v: string) => Promise<void>; clear: () => Promise<void> };

export const lockStore = createStore<{ pin: string | null; locked: boolean; loaded: boolean }>({ pin: null, locked: false, loaded: false });
export const useLock = () => useStore(lockStore);

export const validPin = (p: string): boolean => /^\d{4}$/.test(p);

/** Whether coming back to the app should ask for the PIN: there is one, and the app was away for at least the grace time. */
export const shouldLock = (hasPin: boolean, leftAt: number | null, now: number): boolean => hasPin && leftAt != null && now - leftAt >= GRACE_MS;

/** Read the saved PIN when the app opens; with one saved the app starts locked. */
export const loadLock = async (store: SecretStore): Promise<void> => {
  let pin: string | null = null;
  try { const v = await store.get(); pin = v && validPin(v) ? v : null; } catch { /* unreadable: no lock rather than a locked-out owner */ }
  lockStore.set({ pin, locked: pin != null, loaded: true });
};

export const setPin = async (store: SecretStore, pin: string): Promise<boolean> => {
  if (!validPin(pin)) return false;
  await store.set(pin);
  lockStore.set({ pin, locked: false });
  return true;
};

export const clearPin = async (store: SecretStore): Promise<void> => { await store.clear().catch(() => {}); lockStore.set({ pin: null, locked: false }); };

/** Try a PIN on the lock screen; true opens the app. */
export const tryUnlock = (entered: string): boolean => {
  if (entered !== lockStore.get().pin) return false;
  lockStore.set({ locked: false });
  return true;
};
