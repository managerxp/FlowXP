/*
 * i18next setup for the web app. English is bundled (it is the fallback and must always be complete); every other language is a
 * separate chunk that loads when chosen. The build's precache list (vite.config.js) includes those chunks, so a language that was
 * ever installed works with no connection, and nothing about billing waits on a translation download.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { CODES, FALLBACK, NAMESPACES, detectDeviceLang, dirOf, readStored } from './config.js';
import enCommon from './locales/en/common.json';
import enNav from './locales/en/nav.json';
import enAuth from './locales/en/auth.json';
import enSite from './locales/en/site.json';
import enSettings from './locales/en/settings.json';
import enErrors from './locales/en/errors.json';
import enScreens from './locales/en/screens.json';

const loaders = import.meta.glob(['./locales/*/*.json', '!./locales/en/*.json']);   // { './locales/hi/nav.json': () => import(...) }
const loaded = new Set([FALLBACK]);

const loadLanguage = async (code) => {
  if (loaded.has(code)) return;
  await Promise.all(NAMESPACES.map(async (ns) => {
    const load = loaders[`./locales/${code}/${ns}.json`];
    if (!load) return;   // a namespace not translated yet falls back to English key by key
    i18n.addResourceBundle(code, ns, (await load()).default, true, true);
  }));
  loaded.add(code);
};

const startLang = readStored()?.lang ?? detectDeviceLang(globalThis.navigator?.languages ?? [globalThis.navigator?.language]) ?? FALLBACK;

i18n.use(initReactI18next).init({
  lng: FALLBACK,
  fallbackLng: FALLBACK,
  supportedLngs: CODES,
  ns: NAMESPACES,
  defaultNS: 'common',
  resources: { en: { common: enCommon, nav: enNav, auth: enAuth, site: enSite, settings: enSettings, errors: enErrors, screens: enScreens } },
  interpolation: { escapeValue: false },   // React already escapes
  returnNull: false,
  react: { useSuspense: false },
  saveMissing: import.meta.env.DEV,
  // a key missing even from English is a bug: loud while developing, and never a raw key like "auth.login.title" in front of a customer
  missingKeyHandler: (_langs, ns, key) => { console.warn(`[i18n] missing key ${ns}:${key}`); },
  parseMissingKeyHandler: (key) => (import.meta.env.DEV ? key : String(key).split('.').pop())
});

/** Show this language now (no reload). Falls back to English if its files cannot be loaded. */
export const applyLanguage = async (code) => {
  const target = CODES.includes(code) ? code : FALLBACK;
  try { await loadLanguage(target); } catch { /* offline and never cached: English stays */ }
  const use = loaded.has(target) ? target : FALLBACK;
  await i18n.changeLanguage(use);
  document.documentElement.lang = use;
  document.documentElement.dir = dirOf(use);
  return use;
};

void applyLanguage(startLang);

export default i18n;
