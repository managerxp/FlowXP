/*
 * Which language the app shows. Plain functions (no screens, storage or network), the same rules as the web app (frontend/src/i18n/config.js):
 *   signed in:   the person's own saved choice > a choice made on this phone before signing in (then saved for them) > the business default
 *                > the phone's language > English
 *   signed out:  the choice made on this phone > the phone's language > English
 *   starting up / offline: what this phone last showed
 * Language is display text only: it never changes currency, tax, dates on bills or any amount.
 */
import { LANGS, type Lang } from './i18n.ts';

export const normaliseLang = (value: unknown): Lang | null => {
  if (!value) return null;
  const base = String(value).trim().toLowerCase().split(/[-_]/)[0];
  return LANGS.find((l) => l.id === base)?.id ?? null;
};

/** The phone's own language setting ("hi-IN" -> hi), or null when it is not one we offer. Hermes ships Intl, so no extra package is needed. */
export const deviceLang = (): Lang | null => {
  try { return normaliseLang(Intl.DateTimeFormat().resolvedOptions().locale); } catch { return null; }
};

/* What this phone remembers: who chose (uid, null = chosen while signed out), whether the server has been told (pending), and
   derived = merely what was shown last (from the business default or the phone), not a choice. The old format was a bare code. */
export type Stored = { lang: Lang; uid: number | null; pending: boolean; derived: boolean };
export const parseStored = (raw: string | null | undefined): Stored | null => {
  if (!raw) return null;
  if (!raw.trim().startsWith('{')) { const plain = normaliseLang(raw); return plain ? { lang: plain, uid: null, pending: false, derived: false } : null; }
  try {
    const v = JSON.parse(raw) as { lang?: string; uid?: number | null; pending?: boolean; derived?: boolean };
    const lang = normaliseLang(v.lang);
    return lang ? { lang, uid: v.uid ?? null, pending: Boolean(v.pending), derived: Boolean(v.derived) } : null;
  } catch { return null; }
};

type Ctx = { user?: { user_id: number; language?: string | null } | null; business?: { default_language?: string | null } | null; stored?: Stored | null; device?: Lang | null; checking?: boolean };
export const resolveLang = ({ user = null, business = null, stored = null, device = null, checking = false }: Ctx = {}): Lang => {
  const dev = device ?? 'en';
  if (checking || !user) return stored?.lang ?? dev;
  const own = normaliseLang(user.language);
  if (own) return own;
  const mine = stored && !stored.derived && (stored.uid == null || stored.uid === user.user_id) ? stored.lang : null;
  return mine ?? normaliseLang(business?.default_language) ?? dev;
};

/** Whether the language shown for this person came from a choice (theirs, or one made on this phone) rather than the business default or the phone. */
export const isChoice = (user: { user_id: number; language?: string | null }, stored: Stored | null): boolean =>
  normaliseLang(user.language) != null || Boolean(stored && !stored.derived && (stored.uid == null || stored.uid === user.user_id));
