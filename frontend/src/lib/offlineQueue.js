/*
 * Sales taken while the connection is down.
 *
 * A till that stops when the wifi does is a till that loses sales, so a sale that cannot reach the server is
 * kept on this device and sent again when it can. Nothing is decided offline: the server still numbers the
 * invoice, checks stock and applies coupons and points when the sale arrives, exactly as if it had been
 * billed on the spot. What makes the replay safe is the Idempotency-Key each sale carries: if the first
 * attempt did reach the server before the connection dropped, sending it again returns the same invoice
 * instead of billing twice.
 *
 * The queue outlives a page reload (localStorage), sends in the order the sales were taken, stops at the
 * first thing that means "try later" (no connection, server error, signed out), and parks a sale the server
 * refused (out of stock, a coupon that expired) where a person can read why and decide.
 */

const KEY = 'flowxp.offlineQueue';
export const MAX_QUEUED = 100;

/**
 * @param storage   { getItem, setItem }  (localStorage in the browser, a Map wrapper in tests)
 * @param send      async (item) => { status, message? }  performs the request; throws on no connection
 * @param onChange  called whenever the queue changes
 */
export const createQueue = ({ storage, send, onChange = () => {}, now = () => Date.now() }) => {
  const read = () => { try { return JSON.parse(storage.getItem(KEY) || '[]'); } catch { return []; } };
  const write = (items) => { try { storage.setItem(KEY, JSON.stringify(items)); } catch { /* storage full or blocked: the queue still works for this page */ } onChange(items); };
  let running = null;

  const queue = {
    list: () => read(),
    size: () => read().filter((i) => i.state !== 'failed').length,

    /** Keep a request for later. Returns the stored item, or null when the queue is full. */
    add: ({ label, path, body, idempotencyKey, scope }) => {
      const items = read();
      if (items.length >= MAX_QUEUED) return null;
      const item = { id: idempotencyKey, label, path, body, idempotencyKey, scope, createdAt: now(), state: 'pending', error: null };
      if (items.some((i) => i.id === item.id)) return items.find((i) => i.id === item.id);   // the same sale twice is still one sale
      write([...items, item]);
      return item;
    },

    remove: (id) => write(read().filter((i) => i.id !== id)),

    /** Give a refused sale another go (after the cause has been fixed). */
    retry: (id) => write(read().map((i) => (i.id === id ? { ...i, state: 'pending', error: null } : i))),

    /**
     * Send everything pending, oldest first. Resolves to { sent, failed, stopped } where `stopped` says why it
     * paused ('offline' | 'server' | 'auth') or is null when it got through the lot. Calls overlap safely.
     */
    flush: () => {
      if (running) return running;
      running = (async () => {
        let sent = 0; let failed = 0; let stopped = null;
        for (const item of read().filter((i) => i.state === 'pending')) {
          let result;
          try { result = await send(item); }
          catch { stopped = 'offline'; break; }

          if (result.status >= 200 && result.status < 300) { queue.remove(item.id); sent += 1; continue; }
          if (result.status === 401) { stopped = 'auth'; break; }
          if (result.status >= 500 || result.status === 429 || result.status === 408) { stopped = 'server'; break; }
          // a definite "no": keep it visible with the reason, and carry on with the others
          write(read().map((i) => (i.id === item.id ? { ...i, state: 'failed', error: result.message || 'The server refused this sale' } : i)));
          failed += 1;
        }
        return { sent, failed, stopped };
      })().finally(() => { running = null; });
      return running;
    }
  };
  return queue;
};
