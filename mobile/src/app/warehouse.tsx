import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { DELIVERY_LABEL, PICK_LABEL, boardLines, type Board, type Delivery, type PickList, type ToPick } from '../lib/warehouse.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SavedNote, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

type Tab = 'orders' | 'lists' | 'road';
const money = (n: number) => rupees(toPaise(n));
const TONE = { warn: color.warn, ok: color.ok, plain: undefined } as const;

/* The warehouse: how many orders wait to be picked, the pick lists in hand, and the deliveries on the road. Start a pick list from an order, then pick, pack and send it out. */
export default function Warehouse() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const [tab, setTab] = useState<Tab>('orders');
  const [busy, setBusy] = useState(0);
  const [problem, setProblem] = useState('');
  const board = useLoad<Board>(`wh-board:${scope}`, () => api.get<Board>('/wholesale/fulfilment/summary'));
  const orders = useLoad<ToPick[]>(`wh-orders:${scope}`, () => api.get<ToPick[]>('/wholesale/orders?pickable=1&limit=50'), tab === 'orders');
  const lists = useLoad<PickList[]>(`wh-lists:${scope}`, () => api.get<PickList[]>('/wholesale/pick-lists?limit=50'), tab === 'lists');
  const road = useLoad<Delivery[]>(`wh-road:${scope}`, () => api.get<Delivery[]>('/wholesale/deliveries?open=1&limit=50'), tab === 'road');
  const refresh = () => { void board.refresh(); void orders.refresh(); void lists.refresh(); void road.refresh(); };

  const startList = async (o: ToPick) => {
    setBusy(o.order_id); setProblem('');
    try {
      const l = await api.post<{ pick_id: number }>(`/wholesale/orders/${o.order_id}/pick-lists`, {}, { idempotencyKey: newKey() });
      router.push({ pathname: '/warehouse-pick/[id]', params: { id: String(l.pick_id) } });
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not start the pick list'); }
    finally { setBusy(0); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Warehouse</Title><Soft>Pick, pack and send out</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView refreshControl={<RefreshControl refreshing={board.busy} onRefresh={refresh} />} contentContainerStyle={{ paddingBottom: 32 }}>
          {board.error && !board.data ? <Failed message={board.error} onRetry={() => { void board.refresh(); }} /> : null}
          {board.busy && !board.data ? <Loading /> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
            {boardLines(board.data).map((l) => <Stat key={l.label} label={l.label} value={String(l.n)} tone={TONE[l.tone]} />)}
          </View>
          <View style={{ height: 8 }} />
          <Chips<Tab> items={[{ id: 'orders', label: 'To pick' }, { id: 'lists', label: 'Pick lists' }, { id: 'road', label: 'On the road' }]} value={tab} onChange={(t) => { setTab(t); setProblem(''); }} />
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><ErrorText>{problem}</ErrorText></View>

          {tab === 'orders' ? (
            <>
              <SavedNote at={orders.savedAt} />
              {orders.data && orders.data.length === 0 ? <Empty>No confirmed order is waiting to be picked.</Empty> : null}
              {(orders.data ?? []).map((o) => <Line key={o.order_id} left={`${o.order_number} · ${o.customer}`} sub={`${String(o.order_date).slice(0, 10)}${o.lines ? ` · ${o.lines} products` : ''} · tap to start a pick list`} right={busy === o.order_id ? '…' : money(o.total)} onPress={busy ? undefined : () => { void startList(o); }} />)}
            </>
          ) : null}
          {tab === 'lists' ? (
            <>
              <SavedNote at={lists.savedAt} />
              {lists.data && lists.data.length === 0 ? <Empty>No pick lists in hand. Start one from an order under To pick.</Empty> : null}
              {(lists.data ?? []).map((l) => <Line key={l.pick_id} left={`${l.pick_number} · ${l.customer}`} sub={`${l.order_number} · ${PICK_LABEL[l.status]}${l.items ? ` · ${l.items} products` : ''}${l.picker_name ? ` · ${l.picker_name}` : ''}`} onPress={() => router.push({ pathname: '/warehouse-pick/[id]', params: { id: String(l.pick_id) } })} />)}
            </>
          ) : null}
          {tab === 'road' ? (
            <>
              <SavedNote at={road.savedAt} />
              {road.data && road.data.length === 0 ? <Empty>Nothing is on the road.</Empty> : null}
              {(road.data ?? []).map((d) => <Line key={d.delivery_id} left={`${d.challan_number} · ${d.customer}`} sub={`${DELIVERY_LABEL[d.status]}${d.vehicle_no ? ` · ${d.vehicle_no}` : ''}${d.driver_name ? ` · ${d.driver_name}` : ''}`} right={d.invoice_total != null ? money(d.invoice_total) : undefined} onPress={() => router.push({ pathname: '/warehouse-delivery/[id]', params: { id: String(d.delivery_id) } })} />)}
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
