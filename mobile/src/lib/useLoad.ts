import { useCallback, useEffect, useRef, useState } from 'react';
import { cachedLoad, cachedRead, type Loaded, type Store } from './cache.ts';
import { kvGet, kvSet } from './local.ts';

const store: Store = { get: kvGet, set: kvSet };

/**
 * Load a page of data: what was kept last time shows at once, the server is asked, and the answer replaces it. `refresh` asks again (pull
 * to refresh). With no signal the kept answer stays, marked as saved; `error` is only set when there is nothing to show or the server refused.
 * `key` must include everything the answer depends on (business, outlet, search text, range).
 */
export const useLoad = <T,>(key: string, fetcher: () => Promise<T>, enabled = true) => {
  const [state, setState] = useState<{ loaded: Loaded<T> | null; error: string; busy: boolean }>({ loaded: null, error: '', busy: enabled });
  const latest = useRef(fetcher);
  latest.current = fetcher;
  const run = useRef(0);

  const load = useCallback(async () => {
    const mine = ++run.current;
    setState((s) => ({ ...s, busy: true, error: '' }));
    try {
      const loaded = await cachedLoad(key, () => latest.current(), store);
      if (mine === run.current) setState({ loaded, error: '', busy: false });
    } catch (e) {
      if (mine === run.current) setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Could not load', busy: false }));
    }
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void cachedRead<T>(key, store).then((kept) => { if (alive && kept) setState((s) => (s.loaded ? s : { ...s, loaded: kept })); });
    void load();
    return () => { alive = false; run.current++; };
  }, [key, enabled, load]);

  return { data: state.loaded?.data ?? null, savedAt: state.loaded?.fromCache ? state.loaded.at : null, error: state.error, busy: state.busy, refresh: load };
};
