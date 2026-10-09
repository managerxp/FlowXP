import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { clientLine, type Segment, type SalonClient } from '../lib/salon.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { Button, Chips, Empty, Failed, Line, Loading, SavedNote, Soft, Title, s } from '../lib/ui.tsx';

/* The salon's clients: visits, last visit, what they have (membership, points), and groups like new, regular or gone quiet. */
export default function SalonClients() {
  const session = useSession();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(text.trim()), 350); return () => clearTimeout(t); }, [text]);
  const segs = useLoad<{ total: number; segments: Segment[] }>(`salon-segments:${session.businessId}`, () => api.get('/salon/clients/segments'));
  const list = useLoad<SalonClient[]>(`salon-clients:${session.businessId}:${search}:${segment}`, () => api.get<SalonClient[]>(`/salon/clients?limit=100${search ? `&q=${encodeURIComponent(search)}` : ''}${segment ? `&segment=${segment}` : ''}`));
  const rows = list.data ?? [];

  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Clients</Title><Soft>{segs.data ? `${segs.data.total} clients` : 'Everyone who has visited'}</Soft></View>
          <Button title="Add" onPress={() => router.push('/customers')} />
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Search by name or phone" autoCorrect={false} accessibilityLabel="Search clients" />
        </View>
        {segs.data && segs.data.segments.length ? <Chips items={[{ id: '', label: 'Everyone' }, ...segs.data.segments.map((x) => ({ id: x.key, label: `${x.label} (${x.count})` }))]} value={segment} onChange={setSegment} /> : null}
        <SavedNote at={list.savedAt} />
        {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
        {list.busy && !list.data ? <Loading /> : null}
        <ColumnList
          style={{ flex: 1, marginTop: 8 }} data={rows} keyExtractor={(c) => String(c.customer_id)} refreshing={list.busy} onRefresh={() => { void list.refresh(); }} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={list.data ? <Empty>No client matches.</Empty> : null}
          renderItem={({ item: c }) => (
            <Line left={c.name} sub={`${clientLine(c)}${c.membership ? ` · ${c.membership}` : ''}`} right={c.outstanding && c.outstanding > 0 ? `Owes ${rupees(toPaise(c.outstanding))}` : c.total_spent != null ? rupees(toPaise(c.total_spent)) : undefined}
              onPress={() => router.push({ pathname: '/salon-client/[id]', params: { id: String(c.customer_id) } })} />
          )}
        />
      </Page>
    </SafeAreaView>
  );
}
