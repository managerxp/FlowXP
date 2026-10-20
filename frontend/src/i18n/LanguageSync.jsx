/*
 * Keeps the shown language in step with who is signed in (rules in config.js's resolveLanguage), and lets a person choose one.
 * Mounted once inside AuthProvider. A choice shows immediately, is remembered on this device, and is saved on the person's
 * account (PATCH /auth/language); if that cannot be sent (offline) it is kept as "pending" and sent when the app next syncs.
 * Nothing here touches billing, money or any business setting.
 */
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { detectDeviceLang, normaliseLang, readStored, resolveLanguage, writeStored } from './config.js';
import { applyLanguage } from './index.js';

const deviceLang = () => detectDeviceLang(globalThis.navigator?.languages ?? [globalThis.navigator?.language]);

const saveOnServer = (language) => api('/auth/language', { method: 'PATCH', body: { language } });

export const LanguageSync = () => {
  const { user, business, loading } = useAuth();

  useEffect(() => {
    let live = true;
    (async () => {
      let stored = readStored();
      // a choice that never reached the server (made offline): send it now, then it is the person's saved choice
      if (user && stored?.pending && stored.uid === user.user_id) {
        try { await saveOnServer(stored.lang); stored = { ...stored, pending: false }; writeStored(stored); } catch { /* still offline: keep it pending, and show it */ }
        if (stored.pending) { if (live) void applyLanguage(stored.lang); return; }
      }
      // a language picked on the sign-in page before this person had one saved becomes their saved choice
      if (user && !normaliseLang(user.language) && stored && stored.uid == null && !stored.derived) {
        saveOnServer(stored.lang).then(() => writeStored({ lang: stored.lang, uid: user.user_id, pending: false })).catch(() => writeStored({ lang: stored.lang, uid: user.user_id, pending: true }));
      }
      const lang = resolveLanguage({ user, business, stored, device: deviceLang(), checking: loading });
      if (live) void applyLanguage(lang);
      // remember the resolved language of a signed-in person on this device so the next offline start opens in it
      if (user && !loading && lang !== stored?.lang) writeStored({ lang, uid: user.user_id, pending: false, derived: !normaliseLang(user.language) });
    })();
    return () => { live = false; };
  }, [user, business?.default_language, loading]);   // eslint-disable-line react-hooks/exhaustive-deps

  return null;
};

/** { lang, choose(code) } for a language picker. */
export const useLanguage = () => {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const choose = useCallback(async (code) => {
    const lang = normaliseLang(code);
    if (!lang) return;
    await applyLanguage(lang);
    if (!user) { writeStored({ lang, uid: null, pending: false }); return; }
    writeStored({ lang, uid: user.user_id, pending: true });
    try { await saveOnServer(lang); writeStored({ lang, uid: user.user_id, pending: false }); } catch { /* kept pending; LanguageSync sends it later */ }
  }, [user]);
  return { lang: i18n.resolvedLanguage || i18n.language, choose };
};
