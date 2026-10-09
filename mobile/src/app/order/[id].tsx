import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../lib/api.ts';
import { api, useSession } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { ITEM_LABEL, itemName, orderTotals, type Order, type OrderItem } from '../../lib/orders.ts';
import { qty, rupees, toPaise } from '../../lib/money.ts';
import { Page } from '../../lib/responsive.tsx';
import { Hint } from '../../lib/learn.tsx';
import { Button, Empty, ErrorText, Failed, Loading, SavedNote, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

const TONE: Record<OrderItem['status'], string> = { PENDING: color.warn, PREPARING: color.brand, READY: color.ok, SERVED: color.soft, CANCELLED: color.danger };

/* One order: what the table has had, what the kitchen has done, and the next step (add, send, serve, bill). */
export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const order = useLoad<Order>(`order:${session.businessId}:${session.branchId}:${id}`, () => api.get<Order>(`/orders/${id}`));
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState('');
  const o = order.data;
  const t = o ? orderTotals(o) : null;

  // the kitchen moves while you stand there: refresh every 10 seconds while this screen is showing, and when you come back to it from adding items
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); void order.refresh(); return () => setFocused(false); }, []));   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focused) return;
    const timer = setInterval(() => { void order.refresh(); }, 10000);
    return () => clearInterval(timer);
  }, [focused]);   // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (what: string, work: () => Promise<void>) => {
    setBusy(what); setProblem(''); setNote('');
    try { await work(); await order.refresh(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work'); }
    finally { setBusy(''); }
  };

  const setQtyOf = (i: OrderItem, quantity: number) => act(`item-${i.order_item_id}`, async () => {
    await api.call(`/orders/${id}/items/${i.order_item_id}`, { method: 'PATCH', body: quantity > 0 ? { quantity } : { status: 'CANCELLED' } });
  });
  const setStatus = (i: OrderItem, status: OrderItem['status']) => act(`item-${i.order_item_id}`, async () => { await api.call(`/orders/${id}/items/${i.order_item_id}`, { method: 'PATCH', body: { status } }); });
  const cancelItem = (i: OrderItem) => Alert.alert('Cancel this item?', `${itemName(i)} was already sent to the kitchen. It comes off the bill.`, [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel item', style: 'destructive', onPress: () => { void setStatus(i, 'CANCELLED'); } }]);

  const send = () => act('send', async () => {
    const kot = await api.post<{ kot_number?: string; kot?: { kot_number: string } }>(`/orders/${id}/kot`, {});
    setNote(`Sent to the kitchen${kot?.kot_number ? `: ${kot.kot_number}` : kot?.kot?.kot_number ? `: ${kot.kot.kot_number}` : ''}.`);
  });

  const cancelOrder = () => Alert.alert('Cancel the whole order?', 'Every item comes off and the table is freed. Items already billed stay billed.', [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Cancel order', style: 'destructive', onPress: () => { void act('cancel', async () => { await api.call(`/orders/${id}/cancel`, { method: 'POST', body: {} }); goBack(); }); } }
  ]);

  const title = o ? (o.table_name ?? (o.order_type === 'DELIVERY' ? 'Delivery' : 'Takeaway')) : 'Order';
  const items = o ? o.items.filter((i) => !i.billed) : [];
  const done = o ? o.items.filter((i) => i.billed).length : 0;
  const closed = o ? ['BILLED', 'CANCELLED', 'MERGED'].includes(o.status) : false;

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{title}</Title>{o ? <Soft>{o.order_number}{o.customer_name ? ` · ${o.customer_name}` : ''}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <SavedNote at={order.savedAt} />
        <Hint id="order" />
        {order.error && !o ? <Failed message={order.error} onRetry={() => { void order.refresh(); }} /> : null}
        {order.busy && !o ? <Loading what="Loading the order" /> : null}
        {o ? (
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            {closed ? <Text style={{ padding: 16, color: color.warn, fontWeight: '600' }}>This order is {o.status.toLowerCase()}.</Text> : null}
            <SectionTitle>Items</SectionTitle>
            {items.length === 0 ? <Empty>Nothing on this order yet. Tap Add items below, then tap what the guests want.</Empty> : items.map((i) => {
              const editable = i.status === 'PENDING' && !closed;
              return (
                <View key={i.order_item_id} style={{ paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card, gap: 6, opacity: i.status === 'CANCELLED' ? 0.5 : 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, color: color.ink, textDecorationLine: i.status === 'CANCELLED' ? 'line-through' : 'none' }}>{itemName(i)}</Text>
                      <Text style={{ color: TONE[i.status], fontWeight: '600', fontSize: 13 }}>{ITEM_LABEL[i.status]}{i.kitchen_notes ? ` · ${i.kitchen_notes}` : ''}</Text>
                    </View>
                    {editable ? (
                      <>
                        <Pressable accessibilityRole="button" accessibilityLabel={`One less ${i.description}`} disabled={Boolean(busy)} onPress={() => { void setQtyOf(i, i.quantity - 1); }} style={stepper}><Text style={stepText}>−</Text></Pressable>
                        <Text style={{ minWidth: 28, textAlign: 'center', fontWeight: '600' }}>{qty(i.quantity)}</Text>
                        <Pressable accessibilityRole="button" accessibilityLabel={`One more ${i.description}`} disabled={Boolean(busy)} onPress={() => { void setQtyOf(i, i.quantity + 1); }} style={stepper}><Text style={stepText}>+</Text></Pressable>
                      </>
                    ) : <Text style={{ fontWeight: '600', color: color.ink }}>× {qty(i.quantity)}</Text>}
                    <Text style={{ minWidth: 70, textAlign: 'right', fontWeight: '600', color: color.ink }}>{rupees(toPaise(i.line_total))}</Text>
                  </View>
                  {!closed && i.status === 'READY' ? <Button title="Mark served" kind="quiet" onPress={() => { void setStatus(i, 'SERVED'); }} busy={busy === `item-${i.order_item_id}`} /> : null}
                  {!closed && (i.status === 'PREPARING' || i.status === 'READY' || i.status === 'SERVED') ? <Pressable accessibilityRole="button" onPress={() => cancelItem(i)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: color.danger }}>Cancel this item</Text></Pressable> : null}
                </View>
              );
            })}
            {done > 0 ? <Soft style={{ padding: 16 }}>{done} item{done === 1 ? ' is' : 's are'} already billed on this table.</Soft> : null}
          </ScrollView>
        ) : null}

        {o && t && !closed ? (
          <View style={{ padding: 12, gap: 8, backgroundColor: color.card, borderTopWidth: 1, borderColor: color.line }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Soft>{qty(t.items)} items · GST {rupees(t.taxPaise)}{t.notSent ? ` · ${t.notSent} not sent` : ''}{t.ready ? ` · ${t.ready} ready` : ''}</Soft>
              <Text style={{ fontSize: 20, fontWeight: '700', color: color.ink }}>{rupees(t.totalPaise)}</Text>
            </View>
            <ErrorText>{problem}</ErrorText>
            {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '600' }}>{note}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Add items" kind="quiet" onPress={() => router.push({ pathname: '/order/add', params: { id: String(id) } })} style={{ flex: 1 }} />
              <Button title={t.notSent ? `Send ${t.notSent} to kitchen` : 'Sent'} kind={t.notSent ? 'primary' : 'quiet'} onPress={send} busy={busy === 'send'} disabled={!t.notSent} style={{ flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Customer" kind="quiet" onPress={() => router.push({ pathname: '/customers', params: { pick: `order-${id}` } })} />
              <Button title="Table" kind="quiet" onPress={() => router.push({ pathname: '/order/table', params: { id: String(id) } })} />
              <Button title="Bill and pay" onPress={() => router.push({ pathname: '/pay', params: { order: String(id) } })} disabled={t.lines === 0} style={{ flex: 1 }} />
            </View>
            <Pressable accessibilityRole="button" onPress={cancelOrder} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: color.danger, textAlign: 'center' }}>Cancel the whole order</Text></Pressable>
          </View>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}

const stepper = { width: 48, height: 48, borderRadius: 24, backgroundColor: '#eaf1ff', alignItems: 'center' as const, justifyContent: 'center' as const };
const stepText = { fontSize: 22, color: color.brand, fontWeight: '600' as const };
