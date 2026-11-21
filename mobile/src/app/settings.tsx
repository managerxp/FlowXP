import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '../lib/icons.tsx';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '../lib/nav.ts';
import { currentBusiness, useSession } from '../lib/session.ts';
import { FadeIn } from '../lib/motion.tsx';
import { settingsFor } from '../lib/settingsAreas.ts';
import { Page, Rows } from '../lib/responsive.tsx';
import { Button, Group, Initials, Line, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';
import { Text } from 'react-native';

/* Settings: a short list of areas, each opening on its own page. The business first (details and GST, printers and Bluetooth, UPI), then this phone, then the account. */
export default function Settings() {
  const session = useSession();
  const business = currentBusiness(session);
  let n = 0;
  return (
    <SafeAreaView style={s.screen}>
      <Page max={900}>
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={{ padding: 16, paddingBottom: 0, gap: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Settings</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
            <Pressable accessibilityRole={business?.role === 'OWNER' ? 'button' : undefined} disabled={business?.role !== 'OWNER'} onPress={() => router.push('/business-settings')} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
              <Initials name={business?.name} size={52} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={1} style={{ color: color.ink, fontSize: 17, fontWeight: '700' }}>{business?.name}</Text>
                <Soft>{session.user?.email}</Soft>
              </View>
              {business?.role === 'OWNER' ? <Ionicons name="chevron-forward" size={20} color={color.soft} /> : null}
            </Pressable>
          </View>
          {settingsFor(business?.role).map((g) => (
            <View key={g.title}>
              <SectionTitle>{g.title}</SectionTitle>
              <Group><Rows>{g.items.map((i) => <FadeIn key={i.go} index={n++}><Line icon={i.icon} left={i.left} sub={i.sub} onPress={() => router.push(i.go as never)} /></FadeIn>)}</Rows></Group>
            </View>
          ))}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
