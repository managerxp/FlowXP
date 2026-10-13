/* Shared by the gaming lounge screens: words for states, the station kinds, clocks that tick between refreshes, and small helpers. Money from the server
   arrives as rupees beside every paise figure; times arrive as instants and are shown in the browser's own zone (a lounge and its staff share one). */
import { useEffect, useRef, useState } from 'react';
import { formatCurrency } from './api.js';

export { qs, useDebounced, useLoad } from './salon.js';

export const rs = (rupees) => formatCurrency(rupees || 0);
/** A price without .00 when it is a whole number of rupees: an hourly rate reads "₹150", not "₹150.00". */
export const rsShort = (rupees) => (Number.isInteger(Number(rupees || 0)) ? formatCurrency(rupees || 0).replace(/\.00$/, '') : formatCurrency(rupees || 0));
export const rsPaise = (paise) => formatCurrency((paise || 0) / 100);

export const KINDS = [
  ['CONSOLE', 'Console (PS5, Xbox, Switch)'], ['VR', 'VR'], ['POOL', 'Pool table'], ['SNOOKER', 'Snooker table'], ['TABLE_GAME', 'Table game (foosball, table tennis, carrom)'], ['OTHER', 'Other']
];
export const KIND_LABEL = Object.fromEntries(KINDS.map(([k, l]) => [k, l.replace(/ \(.*\)$/, '')]));

/* Where a station stands on the board. */
export const STATE = {
  AVAILABLE: { label: 'Free', tone: 'success' },
  RUNNING: { label: 'Playing', tone: 'brand' },
  PAUSED: { label: 'Paused', tone: 'warning' },
  TO_BILL: { label: 'To bill', tone: 'danger' },
  RESERVED: { label: 'Booked soon', tone: 'warning' },
  OUT_OF_SERVICE: { label: 'Out of service', tone: 'neutral' }
};

export const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];

/** 3725 -> "1:02:05"; 125 -> "2:05". A negative value (over time) keeps its sign. */
export const clock = (seconds) => {
  const s = Math.abs(Math.round(seconds || 0));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
  return seconds < 0 ? `-${body}` : body;
};

/** "1h 05m" or "42m", for lists. */
export const duration = (seconds) => {
  const m = Math.floor(Math.max(0, seconds || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};

export const timeText = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
export const dateTimeText = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

/**
 * A one-second ticker, so a running timer moves between refreshes. `fetchedAt` is when the numbers were loaded; the tick says how many seconds have gone
 * by since. The server is still the authority: every refresh replaces what the clock has been adding.
 */
export const useSecondsSince = (fetchedAt) => {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  return fetchedAt ? Math.max(0, (Date.now() - fetchedAt) / 1000) : 0;
};

/** The seconds on a session's clock now: what the server said when it was loaded, plus the time since if it is running. */
export const liveElapsed = (session, since) => (session.elapsed_seconds || 0) + (session.status === 'RUNNING' ? since : 0);
export const liveRemaining = (session, since) => (session.remaining_seconds == null ? null : session.remaining_seconds - (session.status === 'RUNNING' ? since : 0));
/** What the session has cost so far, extrapolated at the current hourly rate between refreshes. */
export const liveCharge = (session, since) => (session.charge || 0) + (session.status === 'RUNNING' && session.bills_time && session.hour_rate ? session.hour_rate * since / 3600 : 0);

/** Run `fn` every `ms` while the tab is visible, and straight away when it becomes visible again. */
export const usePolling = (fn, ms) => {
  const saved = useRef(fn);
  useEffect(() => { saved.current = fn; });
  useEffect(() => {
    const tick = () => { if (!document.hidden) saved.current(); };
    const timer = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [ms]);
};
