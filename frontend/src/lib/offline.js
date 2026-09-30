/*
 * The browser side of offline sales: one queue for the whole app (see offlineQueue.js for the rules),
 * hooks that show its state, and the triggers that send it when the connection comes back.
 */
import { useSyncExternalStore } from 'react';
import { createQueue } from './offlineQueue.js';
import { getBranchId, getBusinessId, getToken } from './api.js';

const storage = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => localStorage.setItem(k, v)
};

let snapshot = [];
const listeners = new Set();

export const queue = createQueue({
  storage,
  onChange: (items) => { snapshot = items; listeners.forEach((l) => l()); },
  send: async (item) => {
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': item.idempotencyKey };
    const token = getToken(); if (token) headers.Authorization = `Bearer ${token}`;
    if (item.scope?.businessId) headers['X-Business-Id'] = String(item.scope.businessId);
    if (item.scope?.branchId) headers['X-Branch-Id'] = String(item.scope.branchId);
    const response = await fetch(`/api${item.path}`, { method: 'POST', headers, body: JSON.stringify(item.body) });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, message: payload.message };
  }
});
snapshot = queue.list();

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
export const useQueuedSales = () => useSyncExternalStore(subscribe, () => snapshot);

const onlineSubscribe = (l) => { window.addEventListener('online', l); window.addEventListener('offline', l); return () => { window.removeEventListener('online', l); window.removeEventListener('offline', l); }; };
export const useOnline = () => useSyncExternalStore(onlineSubscribe, () => navigator.onLine, () => true);

/** Keep a sale for later. Remembers which business and outlet it was rung up at. A salon sale goes to its own till (`path`). */
export const queueSale = ({ label, body, idempotencyKey, path = '/invoices' }) =>
  queue.add({ label, path, body, idempotencyKey, scope: { businessId: getBusinessId(), branchId: getBranchId() } });

/**
 * Send whatever is waiting: now, whenever the browser says it is back online, and every 20 seconds while
 * something is waiting (the browser's "online" flag is optimistic). `onResult` hears about real progress.
 * Returns a cleanup function.
 */
export const startAutoSync = (onResult) => {
  const run = async () => {
    if (!queue.size() || !navigator.onLine) return;
    const result = await queue.flush();
    if (result.sent || result.failed) onResult(result);
  };
  const timer = setInterval(run, 20000);
  window.addEventListener('online', run);
  run();
  return () => { clearInterval(timer); window.removeEventListener('online', run); };
};
