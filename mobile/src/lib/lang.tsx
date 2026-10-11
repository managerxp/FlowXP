import { Pressable, Text, View } from 'react-native';
import { kvGet, kvSet } from './local.ts';
import { LANGS, isTranslated, setLangValue, t, useLang, type Lang } from './i18n.ts';
import { color } from './ui.tsx';

/** Read the saved language (called once at start) and change it (remembered; the root layout re-draws every screen when it changes). */
export const loadLanguage = async () => { const v = await kvGet('language').catch(() => null); if (LANGS.some((l) => l.id === v)) setLangValue(v as Lang); };
export const chooseLanguage = (lang: Lang) => { setLangValue(lang); void kvSet('language', lang).catch(() => {}); };

/** Two big buttons, each in its own language so a person can always find theirs. */
export const LanguagePicker = ({ compact = false }: { compact?: boolean }) => {
  const lang = useLang();
  return (
    <View style={{ gap: 6 }}>
      {compact ? null : <Text style={{ color: color.soft }}>{t('Choose the language the app is shown in.')}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {LANGS.map((l) => (
          <Pressable key={l.id} accessibilityRole="button" accessibilityState={{ selected: lang === l.id }} accessibilityLabel={l.label} onPress={() => chooseLanguage(l.id)}
            style={{ minWidth: 96, minHeight: 48, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', borderRadius: 24, borderWidth: 1, borderColor: lang === l.id ? color.brand : color.line, backgroundColor: lang === l.id ? color.brand : color.card }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: lang === l.id ? '#fff' : color.ink }}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
      {isTranslated(lang) ? null : <Text accessibilityLiveRegion="polite" style={{ color: color.warn }}>This language is coming soon. The app shows English for now.</Text>}
    </View>
  );
};
