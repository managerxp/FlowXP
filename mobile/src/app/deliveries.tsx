import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { STEP_LABEL, deliveryStage, nextStep, type DeliveryOrder, type Rider } from '../lib/delivery.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Empty, ErrorText, Failed, Loading, SavedNote, Soft, Title, color, s } from '../lib/ui.tsx';

/* Open delivery orders: who is bringing each one and where it has got to. Choose a rider, then mark picked up, out for delivery and delivered, one step after the other. */
export default function Deliveries() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const orders = useLoad<DeliveryOrder[]>(`deliveries:${scope}`, () => api.get<DeliveryOrder[]>('/orders?open_only=true&order_type=DELIVERY'));
  const riders = useLoad<Rider[]>(`riders:${scope}`, () => api.get<Rider[]>('/orders/riders'));
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(0);

  const run = async (o: DeliveryOrder, work: () => Promise<unknown>) => {
    setBusy(o.order_id); setProblem('');
    try { await work(); void orders.refresh(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work'); void orders.refresh(); }
    finally { setBusy(0); }
  };
  const chooseRider = (o: DeliveryOrder) => {
    const list = riders.data ?? [];
    if (!list.length) return setProblem('No one is set up to deliver at this outlet. Add a delivery person in Staff on the website.');
    Alert.alert(`Who delivers ${o.order_number}?`, undefined, [
      ...list.slice(0, 6).map((r) => ({ text: r.name, onPress: () => { void run(o, () => api.call(`/orders/${o.order_id}/rider`, { method: 'PATCH', body: { rider_user_id: r.user_id } })); } })),
      { text: 'Cancel', style: 'cancel' as const }
    ]);
  };
  const advance = (o: DeliveryOrder) => { const step = nextStep(o); if (step) void run(o, () => api.call(`/orders/${o.order_id}/delivery-status`, { method: 'POST', body: { status: step } })); };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Deliveries</Title><Soft>Open delivery orders and their riders</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <SavedNote at={orders.savedAt} />
        <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
          {orders.error && !orders.data ? <Failed message={orders.error} onRetry={() => { void orders.refresh(); }} /> : null}
          {orders.busy && !orders.data ? <Loading /> : null}
          {orders.data && orders.data.length === 0 ? <Empty>No delivery orders are open.</Empty> : null}
          {(orders.data ?? []).map((o) => {
            const step = nextStep(o);
            return (
              <View key={o.order_id} style={[s.card, { gap: 6 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: color.ink }}>{o.order_number}{o.customer_name ? ` · ${o.customer_name}` : ''}</Text>
                  {o.summary ? <Text style={{ fontWeight: '600', color: color.ink }}>{rupees(toPaise(o.summary.estimate))}</Text> : null}
                </View>
                <Text style={{ color: o.rider_user_id ? color.ink : color.warn, fontWeight: '600' }}>{deliveryStage(o)}{o.rider_name ? ` · ${o.rider_name}` : ''}</Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {!o.delivered_at ? <Button title={o.rider_user_id ? 'Change rider' : 'Choose a rider'} kind="quiet" onPress={() => chooseRider(o)} disabled={busy === o.order_id} /> : null}
                  {step ? <Button title={`Mark ${STEP_LABEL[step].toLowerCase()}`} onPress={() => advance(o)} busy={busy === o.order_id} /> : null}
                  <Button title="Open order" kind="quiet" onPress={() => router.push({ pathname: '/order/[id]', params: { id: String(o.order_id) } })} />
                </View>
              </View>
            );
          })}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
