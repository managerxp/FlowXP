/* Simple or Full view of the app, kept on this device. Simple is the default: it shows what a shop needs every day and keeps the accountant's screens and options out of the way. */
import { useSyncExternalStore } from 'react';

const KEY = 'fb_mode';
const listeners = new Set();
const read = () => { try { const m = localStorage.getItem(KEY); return m === 'full' || m === 'builder' ? m : 'simple'; } catch { return 'simple'; } };

export const setMode = (mode) => { try { localStorage.setItem(KEY, mode); } catch { /* kept for this visit only */ } listeners.forEach((f) => f()); };
/** 'simple', 'builder' (projects, units, bills, payments; every field a site needs) or 'full' */
export const useMode = () => useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, read);
export const useSimple = () => useMode() === 'simple';
