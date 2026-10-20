/*
 * Languages and which one to show. Plain functions, no React and no i18next, so they are easy to test and the
 * phone app can follow the same rules (mobile/src/lib/i18n.ts).
 *
 * Language is display text only. It never changes currency, country, timezone, tax or any stored amount.
 *
 * Which language wins, first match:
 *   signed in:   the person's own saved choice  >  a choice made on this device before signing in (and now saved for them)
 *                >  the business default  >  the device's language  >  English
 *   signed out:  the choice made on this device  >  the device's language  >  English
 *   while the session is still being checked (or offline): the last choice kept on this device, else the device language.
 * Adding a language: add it below and in backend/src/utils/locales.js, then add src/i18n/locales/<code>/*.json.
 */

/* status: 'source' = written by us; 'machine' = machine-generated and NOT yet checked by a native speaker (the test suite lists these);
   'reviewed' = a native speaker has signed it off (change the value when that happens). dir is the writing direction. */
export const LANGUAGES = [
  { code: 'en', name: 'English', english: 'English', dir: 'ltr', status: 'source' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi', dir: 'ltr', status: 'machine' },
  { code: 'ml', name: 'മലയാളം', english: 'Malayalam', dir: 'ltr', status: 'machine' },
  { code: 'ta', name: 'தமிழ்', english: 'Tamil', dir: 'ltr', status: 'machine' },
  { code: 'bn', name: 'বাংলা', english: 'Bengali', dir: 'ltr', status: 'machine' },
  { code: 'te', name: 'తెలుగు', english: 'Telugu', dir: 'ltr', status: 'machine' },
  { code: 'kn', name: 'ಕನ್ನಡ', english: 'Kannada', dir: 'ltr', status: 'machine' }
];
export const CODES = LANGUAGES.map((l) => l.code);
export const FALLBACK = 'en';
export const NAMESPACES = ['common', 'nav', 'auth', 'site', 'settings', 'errors', 'screens'];   // screens: the English text is the key (useT.js)

/** "hi-IN" -> "hi"; null when it is not a language we offer. */
export const normaliseLang = (value) => {
  if (!value) return null;
  const base = String(value).trim().toLowerCase().split(/[-_]/)[0];
  return CODES.includes(base) ? base : null;
};

/** The first language in the browser's ordered list that we offer. */
export const detectDeviceLang = (languages = []) => {
  for (const l of languages) { const c = normaliseLang(l); if (c) return c; }
  return null;
};

export const dirOf = (code) => LANGUAGES.find((l) => l.code === code)?.dir ?? 'ltr';

/** The BCP 47 tag used for Intl formatting of dates and numbers (never for currency or rounding). */
export const intlTag = (code) => (code === 'en' ? 'en-IN' : `${code}-IN`);

/* What this device remembers: { lang, uid, pending, derived }. uid = who chose it (null = chosen while signed out);
   pending = chosen while signed in but not yet saved on the server (offline), so it is sent when we can;
   derived = not a choice, just what was shown last (from the business default or the device), kept so an offline start opens in it. */
const KEY = 'flowxp.lang';
export const readStored = (storage = globalThis.localStorage) => {
  try {
    const v = JSON.parse(storage.getItem(KEY));
    const lang = normaliseLang(v?.lang);
    return lang ? { lang, uid: v.uid ?? null, pending: Boolean(v.pending), derived: Boolean(v.derived) } : null;
  } catch { return null; }
};
export const writeStored = (value, storage = globalThis.localStorage) => {
  try { if (value) storage.setItem(KEY, JSON.stringify(value)); else storage.removeItem(KEY); } catch { /* private mode: the language just is not remembered here */ }
};

/**
 * Which language to show now.
 * @param {{ user?: {user_id:number, language?:string|null}|null, business?: {default_language?:string|null}|null, stored?: {lang:string, uid:number|null}|null, device?: string|null, checking?: boolean }} ctx
 */
export const resolveLanguage = ({ user = null, business = null, stored = null, device = null, checking = false } = {}) => {
  const dev = normaliseLang(device) ?? FALLBACK;
  if (checking) return stored?.lang ?? dev;
  if (!user) return stored?.lang ?? dev;
  const own = normaliseLang(user.language);
  if (own) return own;
  // a choice made on this device while signed out, or by this same person, counts as theirs; another person's does not
  const mine = stored && !stored.derived && (stored.uid == null || stored.uid === user.user_id) ? stored.lang : null;
  return mine ?? normaliseLang(business?.default_language) ?? dev;
};
