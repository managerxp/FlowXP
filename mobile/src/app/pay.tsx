import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { goBack } from '../lib/nav.ts';
import { router, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, NetworkError, newKey } from '../lib/api.ts';
import { useLoad } from '../lib/useLoad.ts';
import { orderTotals, type Order } from '../lib/orders.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { kvGet, kvSet, useScope } from '../lib/local.ts';
import { METHOD_ORDER, cartSummary, cashSuggestions, isMethod, orderSummary } from '../lib/billing.ts';
import { refreshCounts, syncAll } from '../lib/sync.ts';
import { takeSale } from '../lib/till.ts';
import { clearSale, keyForSale, useSale } from '../lib/sale.ts';
import { markDone } from '../lib/learn.tsx';
import { KITCHEN_TYPES, totals, upiLink } from '../lib/cart.ts';
import { qty, rupees, toPaise } from '../lib/money.ts';
import { t } from '../lib/i18n.ts';
import { Page, useWide } from '../lib/responsive.tsx';
import { Button, ErrorText, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

type Method = 'CASH' | 'UPI' | 'CARD';
const LABEL: Record<Method, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' };
const METHODS = METHOD_ORDER.map((id) => ({ id, label: LABEL[id] }));

export default function Pay() {
  const wide = useWide();
  const session = useSession();
  const business = currentBusiness(session);
  const scope = useScope();
  const { cart, kitchen, offers, customer } = useSale();
  const sum = totals(cart, offers.byKey);
  // billing a table's order instead of the till's bill: the order is on the server and the server prices it
  const { order: orderId } = useLocalSearchParams<{ order?: string }>();
  const order = useLoad<Order>(`order:${session.businessId}:${session.branchId}:${orderId}`, () => api.get<Order>(`/orders/${orderId}`), Boolean(orderId));
  const orderKey = useRef(newKey());   // one key for billing this order: a retry after a dropped signal returns the same invoice
  const ot = order.data ? orderTotals(order.data) : null;
  const total = orderId ? (ot?.totalPaise ?? 0) : sum.totalPaise;
  const lineCount = orderId ? (ot?.lines ?? 0) : cart.lines.length;
  const toKitchen = kitchen && KITCHEN_TYPES.includes(business?.business_type ?? '');
  const [method, setMethod] = useState<Method>('CASH');
  // the way this till was paid last time is the way it starts
  useEffect(() => { void kvGet('last_method').then((m) => { if (isMethod(m)) setMethod(m); }); }, []);
  const [given, setGiven] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const change = method === 'CASH' && given ? toPaise(given) - total : 0;

  const billOrder = async () => {
    setBusy(true); setError('');
    try {
      const invoice = await api.post<{ invoice_id: number }>(`/orders/${orderId}/bill`, { payment: { method, amount: 'FULL', ...(reference.trim() ? { reference_number: reference.trim() } : {}) }, apply_promotions: true }, { idempotencyKey: orderKey.current });
      router.replace({ pathname: '/receipt', params: { id: String(invoice.invoice_id), change: change > 0 ? String(change) : '' } });
    } catch (e) {
      setError(e instanceof NetworkError ? 'No internet. The order is still open and nothing was billed. Tap again when the internet is back. It will not be billed twice.' : e instanceof ApiError ? e.message : 'Could not make the bill');
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (orderId) return billOrder();
    if (!scope) return;
    setBusy(true); setError('');
    try {
      // the same key for every attempt at THIS sale: if the first one reached the server before the signal dropped, a retry returns that invoice.
      // With no signal the sale is kept on the phone and sent later, with that same key.
      const taken = await takeSale({ api, outbox: scope.outbox, cart, method, reference: reference.trim() || undefined, key: keyForSale(), kitchen: toKitchen, customerId: customer?.id ?? null });
      if (taken.kind === 'full') { setError('Too many bills are waiting on this phone. Connect to the internet so they can be sent, then make this bill again.'); return; }
      clearSale(); markDone('first_bill');
      if (taken.kind === 'queued') {
        await refreshCounts(); void syncAll();
        router.replace({ pathname: '/receipt', params: { local: taken.entry.id, change: change > 0 ? String(change) : '' } });
      } else {
        router.replace({ pathname: '/receipt', params: { id: String(taken.invoiceId), change: change > 0 ? String(change) : '' } });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not make the bill. Tap again. It will not be billed twice.');
    } finally { setBusy(false); }
  };

  const vpa = business?.upi_vpa;
  const summary = orderId ? (order.data ? orderSummary(order.data) : null) : cartSummary(cart, offers.byKey);

  /* The bill on one side, the way to pay on the other, so a tablet shows both at once. A phone shows the amount, then the way to pay. */
  const Summary = summary ? (
    <View style={{ gap: 2 }}>
      <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '700', color: color.ink, paddingBottom: 6 }}>{orderId && order.data ? `${order.data.table_name ?? order.data.order_type} · ${order.data.order_number}` : 'This bill'}</Text>
      {customer && !orderId ? <Soft>{customer.name}</Soft> : null}
      {summary.rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderColor: color.line }}>
          <Text style={{ minWidth: 32, fontWeight: '700', color: color.ink }}>{qty(r.qty)}×</Text>
          <Text style={{ flex: 1, color: color.ink, fontSize: 15 }}>{r.name}</Text>
          <Text style={{ color: color.ink, fontWeight: '600' }}>{rupees(r.paise)}</Text>
        </View>
      ))}
      <View style={{ gap: 4, paddingTop: 10, borderTopWidth: 1, borderColor: color.line }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Soft>Items</Soft><Soft>{rupees(summary.subtotalPaise)}</Soft></View>
        {summary.offersPaise > 0 ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: color.ok, fontWeight: '600' }}>{t('Offer')}{offers.names.length && !orderId ? `: ${offers.names.join(', ')}` : ''}</Text><Text style={{ color: color.ok, fontWeight: '600' }}>−{rupees(summary.offersPaise)}</Text></View> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Soft>GST</Soft><Soft>{rupees(summary.taxPaise)}</Soft></View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6 }}><Text style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>{t('Total')}</Text><Text style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>≈ {rupees(summary.totalPaise)}</Text></View>
      </View>
    </View>
  ) : <Loading what="Loading the bill" />;

  if (wide) {
    return (
      <SafeAreaView style={s.screen}>
        <Page max={1120}>
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <ScrollView style={{ flex: 2, borderRightWidth: 1, borderColor: color.line, backgroundColor: color.card }} contentContainerStyle={{ padding: 20, gap: 8 }}>{Summary}</ScrollView>
            <ScrollView style={{ flex: 3 }} contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Title>{rupees(total)}</Title>
        <Soft>About, with GST. {lineCount} lines{orderId && order.data ? ` · ${order.data.table_name ?? order.data.order_type} ${order.data.order_number}` : ''}. The final bill comes from FlowXP.</Soft>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {METHODS.map((m) => (
            <Button key={m.id} title={m.label} kind={method === m.id ? 'primary' : 'quiet'} onPress={() => { setMethod(m.id); void kvSet('last_method', m.id); }} style={{ flex: 1 }} />
          ))}
        </View>

        {method === 'CASH' ? (
          <View style={{ gap: 8 }}>
            <Soft>Cash received (optional)</Soft>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {cashSuggestions(total).map((p, i) => <Button key={p} title={i === 0 ? 'Exact' : rupees(p)} kind={toPaise(given || '0') === p ? 'primary' : 'quiet'} onPress={() => setGiven(String(p / 100))} style={{ minWidth: 88 }} />)}
            </View>
            <TextInput style={s.input} value={given} onChangeText={setGiven} keyboardType="decimal-pad" placeholder={rupees(total)} accessibilityLabel="Cash received" />
            {change > 0 ? <Text style={{ fontSize: 18, fontWeight: '700', color: color.ok }}>Give back {rupees(change)}</Text> : null}
            {given && change < 0 ? <Text style={{ color: color.danger }}>Short by {rupees(-change)}</Text> : null}
          </View>
        ) : null}

        {method === 'UPI' ? (
          <View style={[s.card, { alignItems: 'center', gap: 10 }]}>
            {vpa ? (
              <>
                <QRCode value={upiLink(vpa, business?.name || 'FlowXP', total, 'Bill')} size={220} />
                <Soft>{vpa}</Soft>
                <Soft>Ask the customer to scan, then confirm the money has arrived.</Soft>
              </>
            ) : <Soft>This business has no UPI ID set up. Add one in FlowXP settings, or take the payment another way.</Soft>}
            <TextInput style={[s.input, { alignSelf: 'stretch' }]} value={reference} onChangeText={setReference} placeholder="UPI reference (optional)" accessibilityLabel="UPI reference" />
          </View>
        ) : null}

        {method === 'CARD' ? (
          <View style={{ gap: 8 }}>
            <Soft>Take the card on your machine, then record it here. FlowXP is not connected to the machine.</Soft>
            <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="Slip or approval number (optional)" accessibilityLabel="Card reference" />
          </View>
        ) : null}

        <ErrorText>{error}</ErrorText>
        <Button title={method === 'CASH' ? 'Cash received, make the bill' : method === 'UPI' ? 'Money received, make the bill' : 'Card paid, make the bill'} onPress={confirm} busy={busy} disabled={lineCount === 0 || (Boolean(orderId) && !order.data)} />
        <Button title="Back to the bill" kind="quiet" onPress={() => goBack()} disabled={busy} />
            </ScrollView>
          </View>
        </Page>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <Page max={560}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Title>{rupees(total)}</Title>
        <Soft>About, with GST. {lineCount} lines{orderId && order.data ? ` · ${order.data.table_name ?? order.data.order_type} ${order.data.order_number}` : ''}. The final bill comes from FlowXP.</Soft>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {METHODS.map((m) => (
            <Button key={m.id} title={m.label} kind={method === m.id ? 'primary' : 'quiet'} onPress={() => { setMethod(m.id); void kvSet('last_method', m.id); }} style={{ flex: 1 }} />
          ))}
        </View>

        {method === 'CASH' ? (
          <View style={{ gap: 8 }}>
            <Soft>Cash received (optional)</Soft>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {cashSuggestions(total).map((p, i) => <Button key={p} title={i === 0 ? 'Exact' : rupees(p)} kind={toPaise(given || '0') === p ? 'primary' : 'quiet'} onPress={() => setGiven(String(p / 100))} style={{ minWidth: 88 }} />)}
            </View>
            <TextInput style={s.input} value={given} onChangeText={setGiven} keyboardType="decimal-pad" placeholder={rupees(total)} accessibilityLabel="Cash received" />
            {change > 0 ? <Text style={{ fontSize: 18, fontWeight: '700', color: color.ok }}>Give back {rupees(change)}</Text> : null}
            {given && change < 0 ? <Text style={{ color: color.danger }}>Short by {rupees(-change)}</Text> : null}
          </View>
        ) : null}

        {method === 'UPI' ? (
          <View style={[s.card, { alignItems: 'center', gap: 10 }]}>
            {vpa ? (
              <>
                <QRCode value={upiLink(vpa, business?.name || 'FlowXP', total, 'Bill')} size={220} />
                <Soft>{vpa}</Soft>
                <Soft>Ask the customer to scan, then confirm the money has arrived.</Soft>
              </>
            ) : <Soft>This business has no UPI ID set up. Add one in FlowXP settings, or take the payment another way.</Soft>}
            <TextInput style={[s.input, { alignSelf: 'stretch' }]} value={reference} onChangeText={setReference} placeholder="UPI reference (optional)" accessibilityLabel="UPI reference" />
          </View>
        ) : null}

        {method === 'CARD' ? (
          <View style={{ gap: 8 }}>
            <Soft>Take the card on your machine, then record it here. FlowXP is not connected to the machine.</Soft>
            <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="Slip or approval number (optional)" accessibilityLabel="Card reference" />
          </View>
        ) : null}

        <ErrorText>{error}</ErrorText>
        <Button title={method === 'CASH' ? 'Cash received, make the bill' : method === 'UPI' ? 'Money received, make the bill' : 'Card paid, make the bill'} onPress={confirm} busy={busy} disabled={lineCount === 0 || (Boolean(orderId) && !order.data)} />
        <Button title="Back to the bill" kind="quiet" onPress={() => goBack()} disabled={busy} />
      </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
