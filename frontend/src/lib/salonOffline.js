/*
 * The salon till's catalogue kept on this device, so the till still opens — and bills can still be rung up — when the
 * connection is down. What is kept: services, team, packages, plans, payment methods, tax mode, and the first page
 * of retail products. It is refreshed every time the till opens online, belongs to one business and outlet, and is
 * wiped on sign-out (lib/pwa.js clearOfflineCaches). Nothing is decided from it beyond what to show: the server
 * still prices, checks and numbers every bill when it arrives.
 */
import { getBranchId, getBusinessId } from './api.js';

const PREFIX = 'flowxp.salon.';
const key = (what) => `${PREFIX}${what}.${getBusinessId() || 0}.${getBranchId() || 0}`;

export const saveOffline = (what, data) => {
  try { localStorage.setItem(key(what), JSON.stringify({ at: Date.now(), data })); } catch { /* storage full or blocked: the till still works online */ }
};

/** { at, data } or null. */
export const readOffline = (what) => {
  try { return JSON.parse(localStorage.getItem(key(what)) || 'null'); } catch { return null; }
};

export const clearSalonOffline = () => {
  try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch { /* nothing cached */ }
};
