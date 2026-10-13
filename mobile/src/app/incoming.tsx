import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, Vibration, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { hasNewOrders, platformLabel, pendingTotal, rejectBody, waitedText, type PendingOrder } from '../lib/delivery.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Empty, ErrorText, Failed, Loading, SavedNote, Soft, Title, color, s } from '../lib/ui.tsx';

/* Orders waiting to be accepted: from Zomato, Swiggy, ONDC, Magicpin, and QR or website orders. Accept sends it to the kitchen; turn it down with a reason if the kitchen cannot make it.
   Checks every few seconds while open and buzzes when a new one arrives. */
export default function Incoming() {
  const session = useSession();
  const list = useLoad<PendingOrder[]>(`incoming:${session.businessId}:${session.branchId}`, () => api.get<PendingOrder[]>('/orders/pending-deliveries'));
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(0);
  const [rejecting, setRejecting] = useState(0);
  const [reason, setReason] = useState('');
  const seen = useRef(0);

  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    if (!focused) return;
    const t = setInterval(() => { void list.refresh(); }, 6000);
    return () => clearInterval(t);
  }, [focused]);   // eslint-disable-line react-hooks/exhaustive-deps
  const count = list.data?.length ?? 0;
  useEffect(() => { if (list.data) { if (hasNewOrders(seen.current, count)) Vibration.vibrate([0, 300, 150, 300]); seen.current = count; } }, [count]);   // eslint-disable-line react-hooks/exhaustive-deps


  const act = async (o: PendingOrder, what: 'accept' | 'reject') => {
    setBusy(o.order_id); setProblem('');
    try {
      await api.call(`/orders/${o.order_id}/${what}`, { method: 'POST', body: what === 'reject' ? rejectBody(reason) : {}, idempotencyKey: newKey() });
      setRejecting(0); setReason(''); void list.refresh();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work');
      void list.refresh();   // already accepted or turned down elsewhere: the list shows what is really waiting
    } finally { setBusy(0); }
  };
  const accept = (o: PendingOrder) => Alert.alert(`Accept ${o.order_number}?`, `${platformLabel(o.platform)} · ${rupees(toPaise(pendingTotal(o)))} before GST. It goes to the kitchen now.`, [{ text: 'Not yet', style: 'cancel' }, { text: 'Accept', onPress: () => { void act(o, 'accept'); } }]);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>New online orders</Title><Soft>{count ? `${count} waiting for you` : 'Nothing is waiting'}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <SavedNote at={list.savedAt} />
        <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
          {list.busy && !list.data ? <Loading /> : null}
          {list.data && count === 0 ? <Empty>No orders are waiting. This screen checks by itself and buzzes when one comes in.</Empty> : null}
          {(list.data ?? []).map((o) => (
            <View key={o.order_id} style={[s.card, { gap: 6, borderColor: color.danger, borderWidth: 2 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: color.ink }}>{platformLabel(o.platform)} · {o.order_number}</Text>
                <Text style={{ color: color.soft }}>{waitedText(o.created_at)}</Text>
              </View>
              <Soft>{[o.customer_name || 'Customer not given', o.customer_phone, o.external_order_number ? `their order ${o.external_order_number}` : null].filter(Boolean).join(' · ')}</Soft>
              {o.items.map((i) => <Text key={i.order_item_id} style={{ color: color.ink, fontSize: 15 }}>{i.quantity} x {i.description}</Text>)}
              {o.notes ? <Text style={{ color: color.warn }}>{o.notes}</Text> : null}
              <Text style={{ fontWeight: '700', color: color.ink }}>{rupees(toPaise(pendingTotal(o)))} before GST</Text>
              {rejecting === o.order_id ? (
                <View style={{ gap: 8 }}>
                  <TextInput style={s.input} value={reason} onChangeText={setReason} placeholder="Why? (optional, for your records)" accessibilityLabel="Reason for turning it down" />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button title="Turn it down" kind="danger" onPress={() => { void act(o, 'reject'); }} busy={busy === o.order_id} style={{ flex: 1 }} />
                    <Button title="Cancel" kind="quiet" onPress={() => { setRejecting(0); setReason(''); }} />
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title="Accept" onPress={() => accept(o)} busy={busy === o.order_id} style={{ flex: 1 }} />
                  <Button title="Turn down" kind="quiet" onPress={() => { setRejecting(o.order_id); setReason(''); }} disabled={busy === o.order_id} />
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
