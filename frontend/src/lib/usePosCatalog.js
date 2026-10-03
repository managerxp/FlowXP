/*
 * Keeps this device's copy of the catalogue (lib/posCatalog.js) loaded and fresh for the screen that scans or searches
 * by name: read what the device has, refresh it when stale and every few minutes, and re-render when it changes.
 * (The till does the same inline; receiving and counting use this.)
 */
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { catalogInfo, loadCatalog, subscribeCatalog, syncCatalog } from './posCatalog.js';

export const usePosCatalog = (scope) => {
  const [info, setInfo] = useState(catalogInfo);
  useEffect(() => {
    const off = subscribeCatalog(() => setInfo(catalogInfo()));
    const sync = () => syncCatalog(scope, async (after, limit) => {
      const r = await api(`/products/pos-catalog?after=${after}&limit=${limit}`, { withMeta: true });
      return { data: r.data, next: r.meta?.next_after };
    }).catch(() => {});
    loadCatalog(scope).then(() => { if (!catalogInfo().fresh) sync(); });
    const timer = setInterval(sync, 5 * 60 * 1000);
    window.addEventListener('online', sync);
    return () => { off(); clearInterval(timer); window.removeEventListener('online', sync); };
  }, [scope]);
  return info;
};
