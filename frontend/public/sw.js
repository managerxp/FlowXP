/*
 * FlowXP service worker: makes the app open and the menu readable when the connection is down.
 *
 *   the app shell        network first, falling back to the last copy, so the app still opens offline
 *   built files          cache first (their names change whenever their content does)
 *   photos, icons        cache first
 *   a few API reads      network first (4 s), falling back to the last answer: the menu, categories, tables,
 *                        options, the business and the signed-in user, so the till can still ring up a sale
 *   everything else      straight to the network. Live data (orders, kitchen, stock, reports) is never
 *                        served stale, and writes are never touched here (the app queues sales itself).
 *
 * Cached API answers are kept per business and outlet and are wiped when the person signs out.
 */
const VERSION = 'v1';
const SHELL = `flowxp-shell-${VERSION}`;
const STATIC = `flowxp-static-${VERSION}`;
const API = `flowxp-api-${VERSION}`;
const API_MAX = 150;

const READABLE_OFFLINE = [
  /^\/api\/products(\/|$|\?)/, /^\/api\/categories(\/|$|\?)/, /^\/api\/modifier-groups(\/|$|\?)/, /^\/api\/tables(\/|$|\?)/,
  /^\/api\/businesses\/current$/, /^\/api\/auth\/me$/, /^\/api\/outlets(\/|$|\?)/, /^\/api\/loyalty\/program$/
];

/* The files of this build (written by the build, see vite.config.js). Kept on install so every page works offline, not just the ones visited. */
const builtFiles = async () => { try { return await (await fetch('/precache.json', { cache: 'no-store' })).json(); } catch { return []; } };

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await (await caches.open(SHELL)).addAll(['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']);
    const statics = await caches.open(STATIC);
    await Promise.allSettled((await builtFiles()).map((file) => statics.add(file)));   // one missing file must not stop the install
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (![SHELL, STATIC, API].includes(name)) await caches.delete(name);
    // drop built files from older releases (their names carry a hash, so they would pile up)
    const current = new Set(await builtFiles());
    if (current.size) {
      const statics = await caches.open(STATIC);
      for (const request of await statics.keys()) {
        const path = new URL(request.url).pathname;
        if (path.startsWith('/assets/') && !current.has(path)) await statics.delete(request);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_API') event.waitUntil(caches.delete(API));
});

/* An API answer belongs to one business and outlet: the key says which. */
const apiKey = (request) => {
  const url = new URL(request.url);
  url.searchParams.set('__b', request.headers.get('x-business-id') || '');
  url.searchParams.set('__o', request.headers.get('x-branch-id') || '');
  return url.toString();
};

const trim = async (cache) => {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - API_MAX))) await cache.delete(key);
};

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

const networkFirst = async (request, cacheName, key = request, wait = 4000) => {
  const cache = await caches.open(cacheName);
  try {
    const response = await Promise.race([fetch(request), timeout(wait)]);
    if (response.ok) { cache.put(key, response.clone()); if (cacheName === API) trim(cache); }
    return response;
  } catch (error) {
    const cached = await cache.match(key, { ignoreVary: true });
    if (cached) {
      // tell the app this is the last known answer, not a fresh one
      const headers = new Headers(cached.headers); headers.set('x-flowxp-cache', 'stale');
      return new Response(await cached.blob(), { status: cached.status, statusText: cached.statusText, headers });
    }
    throw error;
  }
};

const cacheFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreVary: true });   // the server may send Vary: Origin; a stored copy is still the file
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // the pages: any address inside the app is the same single page
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(SHELL)).put('/', response.clone());
        return response;
      } catch {
        return (await caches.match('/', { ignoreVary: true })) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    // public pages (the QR menu, a bill link) and anything not on the list: always live
    if (url.pathname.startsWith('/api/public/') || !READABLE_OFFLINE.some((re) => re.test(url.pathname + url.search))) return;
    event.respondWith(networkFirst(request, API, apiKey(request)));
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/uploads/') || /\.(png|svg|jpg|jpeg|webp|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC));
  }
});
