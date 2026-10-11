import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { PO_LABEL, type DueIn, type PO } from '../lib/purchasing.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { Button, Chips, Empty, Failed, Line, Loading, SavedNote, Soft, Title, s } from '../lib/ui.tsx';

type Show = 'due' | 'draft' | 'open' | 'owed' | 'done';
const FILTER: Record<Exclude<Show, 'due'>, string> = { draft: 'status=DRAFT', open: 'status=ORDERED,CONFIRMED,PARTIAL', owed: 'unpaid=1', done: 'status=RECEIVED,CANCELLED' };
const money = (n: number) => rupees(toPaise(n));

/* Buying: what is due to arrive, the purchase orders, and what is still owed to suppliers. */
export default function Purchasing() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const [show, setShow] = useState<Show>('due');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(text.trim()), 350); return () => clearTimeout(t); }, [text]);
  const due = useLoad<DueIn[]>(`po-due:${scope}`, () => api.get<DueIn[]>('/wholesale/purchase-orders/due-in'), show === 'due');
  const q = show === 'due' ? '' : `${FILTER[show]}&limit=100${search ? `&q=${encodeURIComponent(search)}` : ''}`;
  const list = useLoad<PO[]>(`pos:${scope}:${q}`, () => api.get<PO[]>(`/wholesale/purchase-orders?${q}`), show !== 'due');
  const owed = (list.data ?? []).reduce((a, p) => a + toPaise(p.balance), 0);

  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Buying</Title><Soft>Orders to suppliers, and goods coming in</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="New order" onPress={() => router.push('/purchase-order-new')} style={{ flex: 1 }} />
            <Button title="Receive without an order" kind="quiet" onPress={() => router.push('/goods-received')} style={{ flex: 1 }} />
          </View>
          {show !== 'due' ? <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Order number or supplier" autoCorrect={false} accessibilityLabel="Search orders" /> : null}
        </View>
        <Chips<Show> items={[{ id: 'due', label: 'Due in' }, { id: 'draft', label: 'Drafts' }, { id: 'open', label: 'Ordered' }, { id: 'owed', label: 'Owed to suppliers' }, { id: 'done', label: 'Finished' }]} value={show} onChange={setShow} />
        <SavedNote at={(show === 'due' ? due : list).savedAt} />
        {show === 'owed' && list.data ? <Soft style={{ padding: 16 }}>{`You owe ${money(owed / 100)} on ${list.data.length} order${list.data.length === 1 ? '' : 's'}`}</Soft> : null}
        {(show === 'due' ? due : list).error && !(show === 'due' ? due : list).data ? <Failed message={(show === 'due' ? due : list).error} onRetry={() => { void (show === 'due' ? due : list).refresh(); }} /> : null}
        {(show === 'due' ? due : list).busy && !(show === 'due' ? due : list).data ? <Loading /> : null}
        {show === 'due' ? (
          <ColumnList style={{ flex: 1, marginTop: 8 }} data={due.data ?? []} keyExtractor={(d) => String(d.po_id)} refreshing={due.busy} onRefresh={() => { void due.refresh(); }}
            ListEmptyComponent={due.data ? <Empty>Nothing is due to arrive. Orders that are approved and not yet delivered show here.</Empty> : null}
            renderItem={({ item: d }) => <Line left={`${d.po_number} · ${d.supplier}`} sub={`${d.units} units still due on ${d.lines} product${d.lines === 1 ? '' : 's'}${d.expected_date ? ` · expected ${String(d.expected_date).slice(0, 10)}` : ''}`} right={d.status === 'PARTIAL' ? 'Part' : undefined} onPress={() => router.push({ pathname: '/purchase-order/[id]', params: { id: String(d.po_id) } })} />} />
        ) : (
          <ColumnList style={{ flex: 1, marginTop: 8 }} data={list.data ?? []} keyExtractor={(p) => String(p.po_id)} refreshing={list.busy} onRefresh={() => { void list.refresh(); }} keyboardShouldPersistTaps="handled"
            ListEmptyComponent={list.data ? <Empty>No orders here.</Empty> : null}
            renderItem={({ item: p }) => <Line left={`${p.po_number} · ${p.supplier}`} sub={`${String(p.po_date).slice(0, 10)} · ${PO_LABEL[p.status]}${p.balance > 0 && ['PARTIAL', 'RECEIVED'].includes(p.status) ? ` · owe ${money(p.balance)}` : ''}`} right={money(p.total)} onPress={() => router.push({ pathname: '/purchase-order/[id]', params: { id: String(p.po_id) } })} />} />
        )}
      </Page>
    </SafeAreaView>
  );
}
