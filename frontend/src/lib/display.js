/*
 * How this device shows things: the theme (light, dark, or follow the system), the date format and the decimal places on amounts. They are a
 * person's own preference for the screen in front of them, so they live in this browser (not on the business) and change nothing that is stored or
 * printed: the theme only applies on screen, never to paper, and amounts and dates on bills keep their own formats.
 */
const KEY = 'flowxp_display';
export const DISPLAY_DEFAULTS = { theme: 'system', date: 'auto', decimals: 2 };
export const THEMES = ['system', 'light', 'dark'];
export const DATE_FORMATS = ['auto', 'dmy', 'mdy', 'ymd'];   // auto = the browser's own short date, as before
export const DECIMALS = [0, 1, 2];

let cache = null;
export const getDisplay = () => {
  if (cache) return cache;
  try { cache = { ...DISPLAY_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { cache = { ...DISPLAY_DEFAULTS }; }
  if (!THEMES.includes(cache.theme)) cache.theme = 'system';
  if (!DATE_FORMATS.includes(cache.date)) cache.date = 'auto';
  if (!DECIMALS.includes(cache.decimals)) cache.decimals = 2;
  return cache;
};

const prefersDark = () => { try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; } };

/** Put the chosen theme on the page (the colour tokens in index.css do the rest); called when the app opens and when the choice changes. */
export const applyTheme = () => {
  const { theme } = getDisplay();
  document.documentElement.dataset.theme = theme === 'dark' || (theme === 'system' && prefersDark()) ? 'dark' : 'light';
};
/** Public pages (the customer's menu, a shared bill) are never themed: they are not the staff member's screen. */
export const clearTheme = () => { delete document.documentElement.dataset.theme; };

export const setDisplay = (patch) => {
  cache = { ...getDisplay(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* not saved: it lasts until the page closes */ }
  applyTheme();
};

/* a calendar date or a timestamp, as a Date (a bare YYYY-MM-DD is that day here, not midnight UTC) */
const toDate = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  const s = String(value);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00` : s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const two = (n) => String(n).padStart(2, '0');

/** A full date (day, month and year) in the format this device chose. */
export const formatDate = (value) => {
  const d = toDate(value);
  if (!d) return '';
  switch (getDisplay().date) {
    case 'dmy': return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
    case 'mdy': return `${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()}`;
    case 'ymd': return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
    default: return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }
};
