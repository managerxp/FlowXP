import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sessionStore } from '../lib/session.ts';
import { LanguagePicker, chooseLanguage } from '../lib/lang.tsx';
import { FadeIn } from '../lib/motion.tsx';
import { markLanguageAsked } from '../lib/langAsked.ts';
import { Logo } from '../lib/Logo.tsx';
import { Page } from '../lib/responsive.tsx';
import { Button, color, s } from '../lib/ui.tsx';
import { t, useLang } from '../lib/i18n.ts';

/* Asked once, right after the first sign-in on a phone, and never before it: which language to show the app in. The choice is saved on the person's account, so it follows them to the website and other phones. It can be changed any time in Settings. */
export default function ChooseLanguage() {
  const lang = useLang();
  const done = async () => {
    const user = sessionStore.get().user;
    if (user) { chooseLanguage(lang); await markLanguageAsked(user.user_id); }   // keeping what is shown counts as a choice, so it is not asked again
    router.replace('/');
  };
  return (
    <SafeAreaView style={s.screen}>
      <Page max={560}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 20 }}>
          <FadeIn><Logo width={150} /></FadeIn>
          <FadeIn index={1}>
            <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '800', color: color.ink }}>{t('Choose your language')}</Text>
            <Text style={{ color: color.soft, fontSize: 16, marginTop: 6 }}>{t('You can change it later in Settings.')}</Text>
          </FadeIn>
          <FadeIn index={2}><LanguagePicker compact /></FadeIn>
        </View>
        <View style={{ padding: 16 }}><Button title="Continue" onPress={() => { void done(); }} /></View>
      </Page>
    </SafeAreaView>
  );
}
