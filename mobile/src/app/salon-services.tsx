import { useState } from 'react';
import { RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { grouped, rowText, type MenuService } from '../lib/salonMenu.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page, Rows } from '../lib/responsive.tsx';
import { Button, Chips, Empty, Failed, Line, Loading, SavedNote, SectionTitle, Soft, Title, s } from '../lib/ui.tsx';

type Show = 'ACTIVE' | 'ARCHIVED';

/* The salon's service menu: what you offer, what it costs and how long it takes. Tap one to change it. */
export default function SalonServices() {
  const session = useSession();
  const [show, setShow] = useState<Show>('ACTIVE');
  const [text, setText] = useState('');
  const list = useLoad<MenuService[]>(`salon-services:${session.businessId}:${show}`, () => api.get<MenuService[]>(`/salon/services?status=${show}&limit=200`));
  const rows = (list.data ?? []).filter((r) => !text.trim() || r.name.toLowerCase().includes(text.trim().toLowerCase()));
  return (
    <SafeAreaView style={s.screen}>
      <Page max={1040}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Service menu</Title><Soft>What you offer, and what it costs</Soft></View>
          <Button title="Add" onPress={() => router.push('/salon-service/new')} />
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}><TextInput style={s.input} value={text} onChangeText={setText} placeholder="Search for a service" accessibilityLabel="Search services" autoCorrect={false} /></View>
        <Chips<Show> items={[{ id: 'ACTIVE', label: 'On the menu' }, { id: 'ARCHIVED', label: 'Removed' }]} value={show} onChange={setShow} />
        <SavedNote at={list.savedAt} />
        {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
        {list.busy && !list.data ? <Loading /> : null}
        <ScrollView refreshControl={<RefreshControl refreshing={list.busy} onRefresh={() => { void list.refresh(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
          {list.data && rows.length === 0 ? <Empty>{text ? 'No service matches.' : show === 'ACTIVE' ? 'No services yet. Add what you offer so it can be billed and booked.' : 'Nothing has been removed.'}</Empty> : null}
          {grouped(rows).map((g) => (
            <View key={g.category}>
              <SectionTitle>{g.category}</SectionTitle>
              <Rows>{g.rows.map((r) => <Line key={r.service_id} left={r.name} sub={rowText(r)} right={rupees(toPaise(r.price))} onPress={() => router.push({ pathname: '/salon-service/[id]', params: { id: String(r.service_id) } })} />)}</Rows>
            </View>
          ))}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
