import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '../lib/nav.ts';
import { currentBusiness, useSession } from '../lib/session.ts';
import { FadeIn } from '../lib/motion.tsx';
import { settingsFor } from '../lib/settingsAreas.ts';
import { Page, Rows } from '../lib/responsive.tsx';
import { Button, Line, SectionTitle, Soft, Title, s } from '../lib/ui.tsx';

/* Settings: a short list of areas, each opening on its own page. The business first (details and GST, printers and Bluetooth, UPI), then this phone, then the account. */
export default function Settings() {
  const session = useSession();
  const business = currentBusiness(session);
  let n = 0;
  return (
    <SafeAreaView style={s.screen}>
      <Page max={900}>
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={{ padding: 16, paddingBottom: 0, gap: 4 }}>
            <Title>Settings</Title>
            <Soft>{business?.name} · {session.user?.email}</Soft>
          </View>
          {settingsFor(business?.role).map((g) => (
            <View key={g.title}>
              <SectionTitle>{g.title}</SectionTitle>
              <Rows>{g.items.map((i) => <FadeIn key={i.go} index={n++}><Line icon={i.icon} left={i.left} sub={i.sub} onPress={() => router.push(i.go as never)} /></FadeIn>)}</Rows>
            </View>
          ))}
          <View style={{ padding: 16 }}><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
