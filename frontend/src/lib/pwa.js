/*
 * FlowXP as an app on a phone or tablet: the service worker (public/sw.js) that keeps the shell and the
 * menu available offline, and the "install" prompt. Nothing here runs in development, where a worker
 * caching your half-edited files would only confuse.
 */
import { useSyncExternalStore } from 'react';

export const registerServiceWorker = () => {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
};

/** Signing out (or a dead session) must not leave the last person's data cached on a shared device. */
export const clearOfflineCaches = () => {
  try { Object.keys(localStorage).filter((k) => k.startsWith('flowxp.salon.')).forEach((k) => localStorage.removeItem(k)); } catch { /* nothing cached */ }
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_API' }); } catch { /* no worker: nothing cached */ }
};

/* ── install prompt ─────────────────────────────────────────────────────── */

let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferred = event; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
}

const standalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
const isIOS = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

/** { canInstall, install, showIosHint }: Android/desktop Chrome offer a real prompt; iPhones need "Add to Home Screen". */
export const useInstall = () => {
  const available = useSyncExternalStore(subscribe, () => deferred !== null);
  return {
    installed: standalone(),
    canInstall: available && !standalone(),
    showIosHint: isIOS() && !standalone(),
    install: async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null; notify();
    }
  };
};
