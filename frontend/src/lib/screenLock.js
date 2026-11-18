/*
 * Screen lock (Settings > Business > Screen lock): a 4-digit PIN that covers the app after this browser has been left alone for a while, so a till
 * left open at the counter does not show the business to whoever walks up. Like the phone's App lock it is kept in this browser only (the PIN as
 * a salted SHA-256, never the digits), changes nothing on the server, and "Forgot PIN? Sign out" is the way back in.
 * Being locked is remembered in the browser too, so reloading the page or opening another tab does not get round it.
 */
const KEY = 'flowxp_screen_lock';      // { hash, salt, minutes }
const STATE = 'flowxp_screen_state';   // { locked, active } : active = last time someone used the app
export const MINUTES = [2, 5, 15, 30];

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: no lock */ } };

export const validPin = (p) => /^\d{4}$/.test(String(p));
export const lockSettings = () => read(KEY);

const digest = async (salt, pin) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const setLockPin = async (pin, minutes) => {
  if (!validPin(pin)) return false;
  const salt = crypto.getRandomValues(new Uint32Array(2)).join('-');
  write(KEY, { hash: await digest(salt, pin), salt, minutes: MINUTES.includes(minutes) ? minutes : 5 });
  write(STATE, { locked: false, active: Date.now() });
  return true;
};
/** Lock with the sign-in PIN of this computer (checked by the server), so there is one PIN to remember. */
export const setLockServer = (minutes) => {
  write(KEY, { server: true, minutes: MINUTES.includes(minutes) ? minutes : 5 });
  write(STATE, { locked: false, active: Date.now() });
};
export const unlock = () => write(STATE, { locked: false, active: Date.now() });
export const setLockMinutes = (minutes) => { const s = read(KEY); if (s && MINUTES.includes(minutes)) write(KEY, { ...s, minutes }); };
export const clearLock = () => { write(KEY, null); write(STATE, null); };

export const checkPin = async (pin) => {
  const s = read(KEY);
  if (!s || !validPin(pin) || (await digest(s.salt, pin)) !== s.hash) return false;
  write(STATE, { locked: false, active: Date.now() });
  return true;
};

/** Should the screen be covered now: a PIN is set, and it was locked already or nobody has used the app for the chosen minutes. */
export const shouldBeLocked = (settings, state, now) => {
  if (!settings) return false;
  if (state?.locked) return true;
  return state?.active != null && now - state.active >= settings.minutes * 60 * 1000;
};
export const lockState = () => read(STATE);
export const lockNow = () => { if (read(KEY)) write(STATE, { ...(read(STATE) || {}), locked: true }); };
/** Someone used the app: written at most every few seconds, so moving the mouse does not hammer storage. */
let lastWrite = 0;
export const touch = (now = Date.now(), force = false) => {
  if (!force && now - lastWrite < 5000) return;
  lastWrite = now;
  const st = read(STATE);
  if (read(KEY) && !st?.locked) write(STATE, { locked: false, active: now });
};
export const STORAGE_KEYS = [KEY, STATE];
