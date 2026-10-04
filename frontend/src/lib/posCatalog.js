/*
 * The till's own copy of the catalogue, so scanning and searching work with no connection and answer instantly.
 *
 * GET /api/products/pos-catalog pages the whole catalogue (every product with all its barcodes) in id order. It is
 * kept in IndexedDB, one database per business and outlet (prices and stock follow the outlet), and held in memory as
 * a barcode map plus a list for name search, which stays fast well past 100,000 products. The server is still the
 * authority: a bill is priced and stock-checked there when it is sent; this only makes finding the product immediate.
 */
const PAGE = 1000;
const STALE_MS = 10 * 60 * 1000;

const state = { scope: null, byId: new Map(), byBarcode: new Map(), list: [], syncedAt: 0, loading: null };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

const open = (scope) => new Promise((resolve, reject) => {
  const request = indexedDB.open(`flowxp-pos-${scope}`, 1);
  request.onupgradeneeded = () => { request.result.createObjectStore('products', { keyPath: 'product_id' }); request.result.createObjectStore('meta'); };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
const all = (store) => new Promise((resolve, reject) => { const r = store.getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

const searchText = (p) => `${p.name} ${p.sku || ''} ${(p.barcodes || []).join(' ')} ${p.category_name || ''}`.toLowerCase();

const index = (rows) => {
  state.byId = new Map(); state.byBarcode = new Map(); state.list = [];
  for (const row of rows) {
    const p = { ...row, _s: searchText(row) };
    state.byId.set(p.product_id, p); state.list.push(p);
    for (const b of p.barcodes || []) state.byBarcode.set(b, p);
  }
  state.list.sort((a, b) => a.name.localeCompare(b.name));
};

/** Read what this device already has (instant), for this business and outlet. */
export const loadCatalog = async (scope) => {
  if (state.scope === scope && state.list.length) return;
  state.scope = scope;
  try {
    const db = await open(scope);
    const rows = await all(db.transaction('products').objectStore('products'));
    const meta = await new Promise((resolve) => { const r = db.transaction('meta').objectStore('meta').get('syncedAt'); r.onsuccess = () => resolve(r.result || 0); r.onerror = () => resolve(0); });
    db.close();
    index(rows); state.syncedAt = meta;
  } catch { index([]); state.syncedAt = 0; }
  emit();
};

/** Fetch the whole catalogue page by page, then replace the local copy in one transaction. `fetchPage(after)` -> { data, next }. */
export const syncCatalog = async (scope, fetchPage) => {
  if (state.loading) return state.loading;
  state.loading = (async () => {
    const rows = [];
    let after = 0;
    for (;;) {
      const { data, next } = await fetchPage(after, PAGE);
      rows.push(...data);
      if (!next) break;
      after = next;
    }
    if (state.scope !== scope) return;                          // the outlet changed while this ran
    try {
      const db = await open(scope);
      const tx = db.transaction(['products', 'meta'], 'readwrite');
      tx.objectStore('products').clear();
      for (const r of rows) tx.objectStore('products').put(r);
      tx.objectStore('meta').put(Date.now(), 'syncedAt');
      await done(tx); db.close();
    } catch { /* the in-memory copy below still serves this session */ }
    index(rows); state.syncedAt = Date.now(); emit();
  })().finally(() => { state.loading = null; emit(); });   // after clearing, so "updating…" goes away
  return state.loading;
};

/** A product made at the till is findable at once, before the next sync. */
export const upsertLocal = (product) => {
  const p = { ...product, barcodes: product.barcodes || (product.barcode ? [product.barcode] : []) };
  const row = { ...p, _s: searchText(p) };
  const existing = state.byId.get(p.product_id);
  if (existing) state.list = state.list.filter((x) => x.product_id !== p.product_id);
  state.byId.set(p.product_id, row); state.list.push(row);
  for (const b of row.barcodes) state.byBarcode.set(b, row);
  emit();
};

const strip = ({ _s, ...p }) => p;
export const localLookup = (code) => { const p = state.byBarcode.get(String(code).trim()); return p ? strip(p) : null; };
export const localSearch = (query, limit = 60, category = '') => {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const p of state.list) {
    if (category && p.category_name !== category) continue;
    if (words.every((w) => p._s.includes(w))) { out.push(strip(p)); if (out.length >= limit) break; }
  }
  return out;
};
export const catalogInfo = () => ({ ready: state.list.length > 0, count: state.list.length, syncedAt: state.syncedAt, fresh: Date.now() - state.syncedAt < STALE_MS, syncing: Boolean(state.loading) });
export const subscribeCatalog = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
