/*
 * How the language choice is kept and sent (rules in langrules.ts). It shows at once, is remembered on this phone (so the app opens in it
 * with no signal), and is saved on the person's account so it follows them to other devices; if the account cannot be reached it stays
 * "pending" and is sent at the next start or sign-in. Language is display text only.
 */
import { setLangValue, type Lang } from './i18n.ts';
import { deviceLang, isChoice, normaliseLang, parseStored, resolveLang, type Stored } from './langrules.ts';

/** Where the choice is kept on the phone (registered by lang.tsx with the phone's key-value store; a plain map in tests). */
type KV = { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void> };
let kv: KV = { get: async () => null, set: async () => {} };
export const setLanguageStore = (store: KV) => { kv = store; };
const readStored = async (): Promise<Stored | null> => parseStored(await kv.get('language').catch(() => null));
const writeStored = (s: Stored) => kv.set('language', JSON.stringify(s)).catch(() => {});

/** Sends the choice to the account. Registered by lang.tsx (which owns the signed-in api); until then (or when it fails) the choice stays pending. */
let pusher: ((lang: Lang) => Promise<void>) | null = null;
export const setLanguagePusher = (fn: (lang: Lang) => Promise<void>) => { pusher = fn; };

/** At start: show what this phone last showed (or its own language), before anyone is signed in and with no network. */
export const loadLanguage = async () => {
  setLangValue(resolveLang({ stored: await readStored(), device: deviceLang(), checking: true }));
};

/** Someone on this phone chose a language. */
export const chooseLangFor = async (lang: Lang, userId: number | null) => {
  setLangValue(lang);
  if (userId == null) { await writeStored({ lang, uid: null, pending: false, derived: false }); return; }
  await writeStored({ lang, uid: userId, pending: true, derived: false });
  try { if (pusher) { await pusher(lang); await writeStored({ lang, uid: userId, pending: false, derived: false }); } } catch { /* stays pending */ }
};

/** The account was read (sign-in, or start with a signal): show this person's language by the rules. */
export const applyAccountLanguage = async (account: { user_id: number; language?: string | null }, business: { default_language?: string | null } | null) => {
  let user = account;
  let stored = await readStored();
  if (stored?.pending && stored.uid === user.user_id) {
    // a choice made here that the account has not heard yet: send it (it then is the account's value), or keep showing it
    try { if (!pusher) throw new Error('not ready'); await pusher(stored.lang); stored = { ...stored, pending: false }; await writeStored(stored); user = { ...user, language: stored.lang }; } catch { setLangValue(stored.lang); return; }
  }
  if (!normaliseLang(user.language) && stored && stored.uid == null && !stored.derived && pusher) {
    // picked on the sign-in screen before this person had one saved: it becomes theirs
    const lang = stored.lang;
    void pusher(lang).then(() => writeStored({ lang, uid: user.user_id, pending: false, derived: false })).catch(() => writeStored({ lang, uid: user.user_id, pending: true, derived: false }));
  }
  const lang = resolveLang({ user, business, stored, device: deviceLang() });
  setLangValue(lang);
  await writeStored({ lang, uid: user.user_id, pending: false, derived: !isChoice(user, stored) });
};
