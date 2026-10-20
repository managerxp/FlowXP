import { Pressable, Text, View } from 'react-native';
import { api, sessionStore } from './session.ts';
import { LANGS, t, useLang, type Lang } from './i18n.ts';
import { kvGet, kvSet } from './local.ts';
import { chooseLangFor, loadLanguage, setLanguagePusher, setLanguageStore } from './langpref.ts';
import { color } from './ui.tsx';

export { loadLanguage };
setLanguageStore({ get: kvGet, set: kvSet });
/** Saving the choice on the person's account (so it follows them to other phones and the website). Display text only: nothing else is touched. */
setLanguagePusher(async (lang) => { await api.call('/auth/language', { method: 'PATCH', body: { language: lang } }); });
/** Change the language (shown at once, remembered on this phone, saved on the account when signed in). */
export const chooseLanguage = (lang: Lang) => { void chooseLangFor(lang, sessionStore.get().user?.user_id ?? null); };

/** One button per language, each in its own language so a person can always find theirs. */
export const LanguagePicker = ({ compact = false }: { compact?: boolean }) => {
  const lang = useLang();
  return (
    <View style={{ gap: 6 }}>
      {compact ? null : <Text style={{ color: color.soft }}>{t('Choose the language the app is shown in.')}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {LANGS.map((l) => (
          <Pressable key={l.id} accessibilityRole="button" accessibilityState={{ selected: lang === l.id }} accessibilityLabel={`${l.label}, ${l.english}`} onPress={() => chooseLanguage(l.id)}
            style={{ minWidth: 96, minHeight: 48, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', borderRadius: 24, borderWidth: 1, borderColor: lang === l.id ? color.brand : color.line, backgroundColor: lang === l.id ? color.brand : color.card }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: lang === l.id ? '#fff' : color.ink }}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
      {lang === 'en' ? null : <Text accessibilityLiveRegion="polite" style={{ color: color.soft, fontSize: 12 }}>{t('Machine-translated and not yet checked by a native speaker. Anything not translated yet is shown in English.')}</Text>}
    </View>
  );
};
