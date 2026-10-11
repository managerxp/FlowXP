/* A tiny shared state holder (no library): get, set, subscribe, and a hook that re-renders when it changes. */
import { useSyncExternalStore } from 'react';

export const createStore = <T extends object>(initial: T) => {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (patch: Partial<T> | ((s: T) => Partial<T>)) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; }
  };
};

export type Store<T extends object> = ReturnType<typeof createStore<T>>;
export const useStore = <T extends object>(store: Store<T>): T => useSyncExternalStore(store.subscribe, store.get, store.get);
