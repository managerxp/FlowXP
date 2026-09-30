/*
 * Helpers shared by the salon screens.
 *
 * Time: a salon's day is the salon's own. "10:00" means 10:00 where the salon is, whatever the browser's zone is,
 * so every conversion between a calendar date + clock time and an instant goes through the salon's timezone (the
 * server sends it with the schedule). Mirrors backend/src/modules/salon/schedule.js.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

export const DEFAULT_TZ = 'Asia/Kolkata';

const formatters = new Map();
const parts = (tz) => {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short'
    }));
  }
  return formatters.get(tz);
};
const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** { date: 'YYYY-MM-DD', minutes, isoDay } of an instant, in `tz`. */
export const localParts = (instant, tz = DEFAULT_TZ) => {
  const p = Object.fromEntries(parts(tz).formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), isoDay: WEEKDAY[p.weekday] };
};

/** The instant at which local `date` + `minutes` occurs in `tz`. */
export const fromLocal = (date, minutes, tz = DEFAULT_TZ) => {
  let guess = new Date(`${date}T00:00:00Z`).getTime() + minutes * 60000;
  for (let i = 0; i < 2; i++) {
    const seen = localParts(guess, tz);
    const wanted = Date.parse(`${date}T00:00:00Z`) / 60000 + minutes;
    const got = Date.parse(`${seen.date}T00:00:00Z`) / 60000 + seen.minutes;
    guess += (wanted - got) * 60000;
  }
  return new Date(guess);
};

export const toMinutes = (hhmm) => { const [h, m] = String(hhmm).split(':'); return Number(h) * 60 + Number(m); };
export const toClock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const todayIn = (tz = DEFAULT_TZ) => localParts(Date.now(), tz).date;
/** Monday of the week containing `date`. */
export const weekStart = (date) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

/** "10:30 am" for an instant, in the salon's zone. */
export const timeText = (instant, tz = DEFAULT_TZ) => clockText(toClock(localParts(instant, tz).minutes));
export const clockText = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
export const dateText = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', opts);
export const longDate = (iso) => dateText(iso, { day: 'numeric', month: 'short', year: 'numeric' });
export const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ── loading ──────────────────────────────────────────────────────────────── */

/**
 * Load `path` (null = wait) and reload when it changes. Returns { data, meta (when paged), error, loading, reload, setData }.
 * A slow answer to an old request never overwrites a newer one.
 */
export const useLoad = (path, { initial = null, paged = false } = {}) => {
  const [state, setState] = useState({ data: initial, error: '', loading: Boolean(path) });
  const seq = useRef(0);
  const run = useCallback(async () => {
    if (!path) { setState((s) => ({ ...s, loading: false })); return; }
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const out = await api(path, paged ? { withMeta: true } : undefined);
      if (mine === seq.current) setState(paged ? { data: out.data, meta: out.meta, error: '', loading: false } : { data: out, error: '', loading: false });
    } catch (error) {
      if (mine === seq.current) setState((s) => ({ ...s, error: error.message, loading: false }));
    }
  }, [path, paged]);
  useEffect(() => { run(); }, [run]);
  const setData = useCallback((data) => setState((s) => ({ ...s, data: typeof data === 'function' ? data(s.data) : data })), []);
  return { ...state, reload: run, setData };
};

/** Query string from an object, leaving out empty values. */
export const qs = (params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : '';
};

/** Debounced copy of a value, for search boxes. */
export const useDebounced = (value, ms = 250) => {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
};

/* ── CSV ──────────────────────────────────────────────────────────────────── */

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Save rows as a CSV file. `columns` are { key, label }. */
export const saveCsv = (filename, columns, rows) => {
  const text = [columns.map((c) => cell(c.label)).join(','), ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};

/* ── words ────────────────────────────────────────────────────────────────── */

export const STAFF_ROLES = {
  HAIR_STYLIST: 'Hair stylist', BARBER: 'Barber', BEAUTICIAN: 'Beautician', MAKEUP_ARTIST: 'Makeup artist',
  THERAPIST: 'Therapist', RECEPTIONIST: 'Receptionist', MANAGER: 'Manager', OTHER: 'Other'
};

export const APPT_STATUS = {
  BOOKED: { label: 'Booked', tone: 'brand' }, CONFIRMED: { label: 'Confirmed', tone: 'brand' }, CHECKED_IN: { label: 'Checked in', tone: 'warning' },
  IN_SERVICE: { label: 'In service', tone: 'warning' }, COMPLETED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' }, NO_SHOW: { label: 'No-show', tone: 'danger' }
};

export const PAYMENT_LABEL = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', WALLET: 'Wallet', GIFT_CARD: 'Gift card', CREDIT: 'Pay later', OTHER: 'Other' };

export const toNumber = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
