/*
 * A small in-memory cache with a time limit, for reads that are asked for far more often than they change (the offers that
 * are on, the retail dashboard's stock figures). It lives in this process only, which is right while the API is one process
 * (see ecosystem.config.cjs); with several instances each would keep its own copy, so a write would clear only its own and
 * the others would show the old figure for at most the time limit below.
 *
 *   wrap(key, load)   the cached value, or `load()` once when there is none: callers that ask at the same moment share
 *                     that one load instead of each running the query
 *   drop(prefix)      forget every key that starts with prefix (a write calls this for its business)
 *
 * It never holds more than `max` entries (the oldest go first), and a load that fails is not remembered.
 */
export const createCache = ({ ttlMs = 30000, max = 1000 } = {}) => {
  const hits = new Map();       // key -> { value, until }
  const loading = new Map();    // key -> promise of a load in flight

  const get = (key) => {
    const e = hits.get(key);
    if (!e) return undefined;
    if (e.until <= Date.now()) { hits.delete(key); return undefined; }
    return e.value;
  };
  const set = (key, value) => {
    hits.delete(key);
    hits.set(key, { value, until: Date.now() + ttlMs });
    while (hits.size > max) hits.delete(hits.keys().next().value);
    return value;
  };
  const wrap = async (key, load) => {
    const cached = get(key);
    if (cached !== undefined) return cached;
    if (loading.has(key)) return loading.get(key);
    const p = (async () => set(key, await load()))().finally(() => loading.delete(key));
    loading.set(key, p);
    return p;
  };
  const drop = (prefix = '') => { for (const k of [...hits.keys()]) if (k.startsWith(prefix)) hits.delete(k); };
  return { get, set, wrap, drop, size: () => hits.size };
};
