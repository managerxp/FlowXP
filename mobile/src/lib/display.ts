/*
 * How this phone shows things (Settings > Display): the theme (light, dark, or the phone's own), the date format and the decimal places on
 * amounts. They are this phone's own preference, kept on the phone; they change nothing that is stored, sent or printed on a thermal receipt's
 * layout (amounts and dates inside a printed receipt follow them too, since the text is made from the same helpers).
 * No React and no phone modules in here: the storage is passed in, so it can be tested.
 */
import { createStore, useStore } from './store.ts';

export type ThemePref = 'light' | 'dark' | 'system';
export type DatePref = 'auto' | 'dmy' | 'mdy' | 'ymd';
export type DecimalsPref = 0 | 1 | 2;
export type Display = { theme: ThemePref; date: DatePref; decimals: DecimalsPref };

export const DISPLAY_DEFAULTS: Display = { theme: 'light', date: 'auto', decimals: 2 };   // light, so nothing changes for anyone until they choose
export const THEMES: ThemePref[] = ['system', 'light', 'dark'];
export const DATE_FORMATS: DatePref[] = ['auto', 'dmy', 'mdy', 'ymd'];
export const DECIMALS: DecimalsPref[] = [0, 1, 2];
const KEY = 'display';

export type KvStore = { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void> };

/** Anything unreadable or out of range becomes the default for that one setting. */
export const cleanDisplay = (raw: unknown): Display => {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    theme: THEMES.includes(o.theme as ThemePref) ? o.theme as ThemePref : DISPLAY_DEFAULTS.theme,
    date: DATE_FORMATS.includes(o.date as DatePref) ? o.date as DatePref : DISPLAY_DEFAULTS.date,
    decimals: DECIMALS.includes(o.decimals as DecimalsPref) ? o.decimals as DecimalsPref : DISPLAY_DEFAULTS.decimals
  };
};

const store = createStore<Display>({ ...DISPLAY_DEFAULTS });
export const getDisplay = (): Display => store.get();
export const useDisplay = (): Display => useStore(store);

/** Read what this phone kept, at start. */
export const loadDisplay = async (kv: KvStore): Promise<void> => {
  try { const raw = await kv.get(KEY); store.set(cleanDisplay(raw ? JSON.parse(raw) : null)); } catch { store.set({ ...DISPLAY_DEFAULTS }); }
};
/** Change one or more settings and keep them. */
export const setDisplay = async (patch: Partial<Display>, kv: KvStore): Promise<void> => {
  const next = cleanDisplay({ ...store.get(), ...patch });
  store.set(next);
  try { await kv.set(KEY, JSON.stringify(next)); } catch { /* not kept: it lasts until the app closes */ }
};

/** The theme to draw with, given what the phone itself is set to. */
export const resolveTheme = (pref: ThemePref, system: string | null | undefined): 'light' | 'dark' => (pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A calendar day (YYYY-MM-DD, or a timestamp starting with one) in the chosen format. 'auto' keeps what the app always showed: the ISO day.
 * Anything that does not start with a date is returned as it is.
 */
export const formatDate = (value: unknown, pref: DatePref = store.get().date): string => {
  const s = String(value ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const [, y, mo, d] = m;
  switch (pref) {
    case 'dmy': return `${d}/${mo}/${y}`;
    case 'mdy': return `${mo}/${d}/${y}`;
    case 'ymd': return `${y}-${mo}-${d}`;
    default: return `${y}-${mo}-${d}`;
  }
};
/** The same, with the month in words (for places that have room): 15 Oct 2026, whatever the numeric format is, unless the person chose month-first. */
export const formatDateLong = (value: unknown, pref: DatePref = store.get().date): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!m) return String(value ?? '');
  const month = MONTHS[Number(m[2]) - 1] ?? m[2];
  return pref === 'mdy' ? `${month} ${Number(m[3])}, ${m[1]}` : `${Number(m[3])} ${month} ${m[1]}`;
};
