import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../../lib/api.ts';
import { api } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { STATUS_LABEL, creditText, orderActions, type WOrder } from '../../lib/wholesale.ts';
import { qty, rupees, toPaise } from '../../lib/money.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));

/* One order: what was asked for, what is reserved and sent, the credit position, and the next step (send for approval, confirm, cancel). */
export default function WholesaleOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useLoad<WOrder>(`worder:${id}`, () => api.get<WOrder>(`/wholesale/orders/${id}`));
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [override, setOverride] = useState(false);
  const o = order.data;

  const act = async (what: string, path: string, body: object = {}) => {
    setBusy(what); setProblem('');
    try { await api.call(`/wholesale/orders/${id}/${path}`, { method: 'POST', body, idempotencyKey: newKey() }); setOverride(false); await order.refresh(); }
    catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work';
      setProblem(msg);
      if (what === 'confirm' && /credit/i.test(msg)) setOverride(true);   // a manager may confirm over the limit, on the record
    } finally { setBusy(''); }
  };
  const cancel = () => Alert.alert('Cancel this order?', 'Anything reserved for it goes back on the shelf.', [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Cancel order', style: 'destructive', onPress: () => { void act('cancel', 'cancel', { reason: 'Cancelled from the phone' }); } }
  ]);
  const credit = o?.credit ? creditText(o.credit) : null;

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{o?.order_number ?? 'Order'}</Title>{o ? <Soft>{`${o.customer} · ${String(o.order_date).slice(0, 10)}`}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {order.busy && !o ? <Loading /> : null}
        {order.error && !o ? <Failed message={order.error} onRetry={() => { void order.refresh(); }} /> : null}
        {o ? (
          <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
            <View style={{ paddingHorizontal: 16, gap: 4 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: o.status === 'CANCELLED' || o.status === 'REJECTED' ? color.danger : color.ink }}>{STATUS_LABEL[o.status]}</Text>
              <Text style={{ fontSize: 28, fontWeight: '800', color: color.ink }}>{money(o.total)}</Text>
              <Soft>{`Items ${money(o.subtotal)} · GST ${money(o.tax)}`}</Soft>
              {o.customer_po ? <Soft>{`Their PO: ${o.customer_po}`}</Soft> : null}
              {o.expected_delivery ? <Soft>{`Wanted by ${String(o.expected_delivery).slice(0, 10)}`}</Soft> : null}
              {o.notes ? <Soft>{o.notes}</Soft> : null}
              {o.cancel_reason ? <Soft>{`Cancelled: ${o.cancel_reason}`}</Soft> : null}
              {o.reject_reason ? <Soft>{`Turned down: ${o.reject_reason}`}</Soft> : null}
              {credit && credit.text ? <Text style={{ color: credit.tone === 'bad' ? color.danger : credit.tone === 'warn' ? color.warn : color.soft, fontWeight: '600' }}>{credit.text}</Text> : null}
            </View>

            <SectionTitle>Products</SectionTitle>
            {(o.items ?? []).map((i) => (
              <Line key={i.item_id} left={`${i.product}${i.is_free ? ' (free)' : ''}`}
                sub={`${qty(i.quantity)} ${i.unit_name}${i.discount_pct ? ` · ${i.discount_pct}% off` : ''}${i.shipped ? ` · ${qty(i.shipped)} sent` : ''}${i.backorder > 0 ? ` · ${qty(i.backorder)} short of stock` : i.reserved > 0 && !i.shipped ? ' · reserved' : ''}`}
                right={money(i.price * i.quantity)} />
            ))}

            {(o.shipments ?? []).length ? <SectionTitle>Sent out</SectionTitle> : null}
            {(o.shipments ?? []).map((d, k) => <Line key={k} left={d.challan_number ?? 'Delivery'} sub={`${d.status.toLowerCase().replace(/_/g, ' ')}${d.invoice_number ? ` · bill ${d.invoice_number}` : ''}`} right={d.total_paise != null ? rupees(Number(d.total_paise)) : undefined} />)}

            <View style={{ padding: 16, gap: 8 }}>
              <ErrorText>{problem}</ErrorText>
              {orderActions(o).map((a) => (
                <Button key={a.id} title={a.label} kind={a.id === 'cancel' ? 'danger' : a.id === 'confirm' ? 'primary' : 'quiet'} busy={busy === a.id}
                  onPress={() => (a.id === 'cancel' ? cancel() : void act(a.id, a.id))} />
              ))}
              {override ? <Button title="Confirm anyway (manager)" kind="danger" busy={busy === 'confirm'} onPress={() => { void act('confirm', 'confirm', { credit_override: true, reason: 'Approved from the phone' }); }} /> : null}
              {o.status === 'CONFIRMED' || o.status === 'PARTIALLY_FULFILLED' ? <Soft>Picking, packing and sending the order out is done in the warehouse on the FlowXP website for now.</Soft> : null}
            </View>
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
