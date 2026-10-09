import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { setCustomer } from '../lib/sale.ts';
import { useLoad } from '../lib/useLoad.ts';
import { STATUS_LABEL, type WOrder } from '../lib/wholesale.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { Button, Chips, Empty, Failed, Line, Loading, SavedNote, Soft, Title, s } from '../lib/ui.tsx';

type Show = 'open' | 'waiting' | 'done';
const FILTER: Record<Show, string> = { open: 'open=1', waiting: 'status=DRAFT,PENDING', done: 'status=DELIVERED,FULFILLED,CANCELLED,REJECTED' };

/* Sales orders: the ones being worked, the ones waiting for approval, and the finished ones. */
export default function WholesaleOrders() {
  const session = useSession();
  const [show, setShow] = useState<Show>('open');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(text.trim()), 350); return () => clearTimeout(t); }, [text]);
  const q = `${FILTER[show]}&limit=100${search ? `&q=${encodeURIComponent(search)}` : ''}`;
  const list = useLoad<WOrder[]>(`worders:${session.businessId}:${session.branchId}:${q}`, () => api.get<WOrder[]>(`/wholesale/orders?${q}`));

  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Orders</Title><Soft>What customers have ordered</Soft></View>
          <Button title="New" onPress={() => { setCustomer(null); router.push('/wholesale-order-new'); }} />
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Order number, customer or their PO" autoCorrect={false} accessibilityLabel="Search orders" />
        </View>
        <Chips<Show> items={[{ id: 'open', label: 'Open' }, { id: 'waiting', label: 'Waiting for approval' }, { id: 'done', label: 'Finished' }]} value={show} onChange={setShow} />
        <SavedNote at={list.savedAt} />
        {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
        {list.busy && !list.data ? <Loading /> : null}
        <ColumnList
          style={{ flex: 1, marginTop: 8 }} data={list.data ?? []} keyExtractor={(o) => String(o.order_id)} refreshing={list.busy} onRefresh={() => { void list.refresh(); }} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={list.data ? <Empty>No orders here. Tap New to take one.</Empty> : null}
          renderItem={({ item: o }) => (
            <Line left={`${o.order_number} · ${o.customer}`} sub={`${String(o.order_date).slice(0, 10)} · ${STATUS_LABEL[o.status]}${o.lines ? ` · ${o.lines} products` : ''}`} right={rupees(toPaise(o.total))}
              onPress={() => router.push({ pathname: '/wholesale-order/[id]', params: { id: String(o.order_id) } })} />
          )}
        />
      </Page>
    </SafeAreaView>
  );
}
