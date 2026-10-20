import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { listFor } from '../lib/bizReports.ts';
import { Page } from '../lib/responsive.tsx';
import AskReports from '../lib/AskReports.tsx';
import { Button, Empty, Line, SectionTitle, Title, s } from '../lib/ui.tsx';

/* Every business report the phone can show, in groups: Day Book, Profit & Loss, GST, stock, parties. The figures are the website's. */
export default function BizReports() {
  const business = currentBusiness(useSession());
  const groups = listFor((perm) => allowed(business, perm));
  return (
    <SafeAreaView style={s.screen}>
      <Page max={900}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title>More reports</Title>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <AskReports />
          {allowed(business, 'export') ? <View style={{ paddingHorizontal: 16 }}><Button title="Accountant pack" kind="quiet" onPress={() => router.push('/accountant-pack')} /></View> : null}
          {groups.length === 0 ? <Empty>You do not have access to any reports.</Empty> : null}
          {groups.map((g) => (
            <View key={g.group}>
              <SectionTitle>{g.group}</SectionTitle>
              {g.defs.map((d) => <Line key={d.id} left={d.title} sub={d.text} onPress={() => router.push({ pathname: '/biz-report', params: { id: d.id } })} />)}
            </View>
          ))}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
