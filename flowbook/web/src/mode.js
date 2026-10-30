/* Simple or Full view of the app, kept on this device. Simple is the default: it shows what a shop needs every day and keeps the accountant's screens and options out of the way. */
import { useSyncExternalStore } from 'react';

const KEY = 'fb_mode';
const listeners = new Set();
const read = () => { try { return localStorage.getItem(KEY) === 'full' ? 'full' : 'simple'; } catch { return 'simple'; } };

export const setMode = (mode) => { try { localStorage.setItem(KEY, mode); } catch { /* kept for this visit only */ } listeners.forEach((f) => f()); };
export const useSimple = () => useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => read() === 'simple');
