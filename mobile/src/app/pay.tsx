import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { goBack } from '../lib/nav.ts';
import { router, useLocalSearchParams } from 'expo-router';
import { payRequestLines, upiPayLink } from '../lib/upiBill.ts';
import { printReceipt } from '../lib/print.ts';
import { COLUMNS } from '../lib/escpos.ts';
import { kvGet, kvSet, useScope } from '../lib/local.ts';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, NetworkError, newKey } from '../lib/api.ts';
import { useLoad } from '../lib/useLoad.ts';
import { orderTotals, type Order } from '../lib/orders.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { hasFeature } from '../lib/access.ts';
import { METHOD_ORDER, cartSummary, cashSuggestions, isMethod, orderSummary, payPlan, type PayHow } from '../lib/billing.ts';
import { refreshCounts, syncAll } from '../lib/sync.ts';
import { takeSale } from '../lib/till.ts';
import { clearSale, keyForSale, useSale } from '../lib/sale.ts';
import { markDone } from '../lib/learn.tsx';
import { KITCHEN_TYPES, saleBody, totals, upiLink } from '../lib/cart.ts';
import { HOTEL_TYPES, roomChargeBody, roomGuestLine, type RoomGuest } from '../lib/hotel.ts';
import { qty, rupees, toPaise } from '../lib/money.ts';
import { t } from '../lib/i18n.ts';
import { gstView, type Levies } from '../lib/gst.ts';
import { DETAIL_FIELDS, detailsBody } from '../lib/taxInvoice.ts';
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
  const gst = gstView(business);
  const [sendWa, setSendWa] = useState(true);   // the bill goes to the customer on WhatsApp unless this is unticked (plans with messaging only)
  const [levies, setLevies] = useState<Levies>({});   // TCS, TDS, reverse charge ticked on this bill (only offered when the owner enabled them)
  // a hardware shop's GST tax invoice: consignee, delivery and dispatch details taken with the bill (the website's "Tax invoice details")
  const [details, setDetails] = useState<Record<string, string>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const sum = totals(cart, offers.byKey, gst, levies);
  // billing a table's order instead of the till's bill: the order is on the server and the server prices it
  const { order: orderId } = useLocalSearchParams<{ order?: string }>();
  const taxDetails = business?.business_type === 'AUTO_PARTS' && !orderId;
  const order = useLoad<Order>(`order:${session.businessId}:${session.branchId}:${orderId}`, () => api.get<Order>(`/orders/${orderId}`), Boolean(orderId));
  const orderKey = useRef(newKey());   // one key for billing this order: a retry after a dropped signal returns the same invoice
  const ot = order.data ? orderTotals(order.data) : null;
  // what the customer pays now: a table's order is priced by the server; at the till the bill less any TDS the customer holds back (the server records that as paid)
  const total = orderId ? (ot?.totalPaise ?? 0) : sum.totalPaise - sum.tdsPaise;
  const lineCount = orderId ? (ot?.lines ?? 0) : cart.lines.length;
  const toKitchen = kitchen && KITCHEN_TYPES.includes(business?.business_type ?? '');
  const [method, setMethod] = useState<Method>('CASH');
  // the way this till was paid last time is the way it starts
  useEffect(() => { void kvGet('last_method').then((m) => { if (isMethod(m)) setMethod(m); }); }, []);
  const [given, setGiven] = useState('');
  const [how, setHow] = useState<PayHow>('FULL');
  const [nowText, setNowText] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // a hotel's restaurant: the bill can go onto an in-house guest's room instead of being paid here (online only: it is posted to a live folio)
  const hotel = HOTEL_TYPES.includes(business?.business_type ?? '');
  const [onRoom, setOnRoom] = useState(false);
  const [guestText, setGuestText] = useState('');
  const guests = useLoad<RoomGuest[]>(`room-guests:${session.businessId}:${session.branchId}:${guestText}`, async () => (await api.get<RoomGuest[] | { rows: RoomGuest[] }>(`/hotel/room-charge/guests?q=${encodeURIComponent(guestText.trim())}`) as RoomGuest[]), hotel && onRoom);
  const roomKey = useRef(newKey());
  const chargeToRoom = async (g: RoomGuest) => {
    setBusy(true); setError('');
    try {
      const invoice = orderId
        ? await api.post<{ invoice_id: number }>(`/orders/${orderId}/bill`, roomChargeBody({ apply_promotions: true }, g.booking_id), { idempotencyKey: roomKey.current })
        : await api.post<{ invoice_id: number }>('/invoices', roomChargeBody(saleBody(cart, { method: 'CASH', payNowPaise: 0 }, { kitchen: toKitchen, customerId: null }), g.booking_id), { idempotencyKey: roomKey.current });
      if (!orderId) clearSale();
      router.replace({ pathname: '/receipt', params: { id: String(invoice.invoice_id) } });
    } catch (e) {
      setError(e instanceof NetworkError ? 'No internet. Charging a room needs a connection, and nothing was charged. Tap again when it is back.' : e instanceof ApiError ? e.message : 'Could not charge the room');
    } finally { setBusy(false); }
  };

  const hasCustomer = orderId ? Boolean(order.data?.customer_id) : Boolean(customer);
  const owes = (orderId ? order.data?.customer_name : customer?.name) || t('the customer');
  const plan = payPlan({ how, totalPaise: total, now: nowText, hasCustomer });
  const change = method === 'CASH' && how === 'FULL' && given ? toPaise(given) - total : 0;

  const billOrder = async () => {
    setBusy(true); setError('');
    try {
      const invoice = await api.post<{ invoice_id: number }>(`/orders/${orderId}/bill`, { ...(plan.payNowPaise === 0 ? {} : { payment: { method, amount: plan.payNowPaise ? plan.payNowPaise / 100 : 'FULL', ...(reference.trim() ? { reference_number: reference.trim() } : {}) } }), apply_promotions: true }, { idempotencyKey: orderKey.current });
      router.replace({ pathname: '/receipt', params: { id: String(invoice.invoice_id), change: change > 0 ? String(change) : '' } });
    } catch (e) {
      setError(e instanceof NetworkError ? 'No internet. The order is still open and nothing was billed. Tap again when the internet is back. It will not be billed twice.' : e instanceof ApiError ? e.message : 'Could not make the bill');
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!plan.ok) { setError(plan.problem ? t(plan.problem) : t('Enter how much is being paid now.')); return; }
    if (orderId) return billOrder();
    if (!scope) return;
    setBusy(true); setError('');
    try {
      // the same key for every attempt at THIS sale: if the first one reached the server before the signal dropped, a retry returns that invoice.
      // With no signal the sale is kept on the phone and sent later, with that same key.
      const taken = await takeSale({ api, outbox: scope.outbox, cart, method, reference: reference.trim() || undefined, key: keyForSale(), kitchen: toKitchen, customerId: customer?.id ?? null, payNowPaise: plan.payNowPaise, gst, levies, printDetails: taxDetails ? detailsBody(details) : null, sendWhatsapp: sendWa });
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
  const [printing, setPrinting] = useState(false);
  const [printNote, setPrintNote] = useState('');
  const [printProblem, setPrintProblem] = useState('');

  /* UPI: nothing is shown on the phone. The bill is printed with a QR code for exactly what is owed; the customer scans the paper and their UPI app opens with the amount filled in. */
  const printUpiBill = async () => {
    if (!vpa || !summary) return;
    setPrinting(true); setPrintNote(''); setPrintProblem('');
    try {
      const now = plan.payNowPaise ?? total;
      const paper = (await kvGet('paper')) === '80' ? '80' : '58';
      const lines = payRequestLines({ width: COLUMNS[paper], businessName: business?.name || 'FlowXP', title: orderId && order.data ? (order.data.table_name ?? order.data.order_number) : null, customer: customer?.name ?? null, summary, totalPaise: total, payNowPaise: plan.payNowPaise });
      const how = await printReceipt(lines.join('\n'), paper, { qr: upiPayLink(vpa, business?.name || 'FlowXP', now) });
      setPrintNote(how === 'fallback' ? t("Could not use the thermal printer, so the bill went to the phone's print screen.") : t('Printed. Give it to the customer to scan, then confirm the money has arrived.'));
    } catch (e) { setPrintProblem(e instanceof Error ? e.message : t('Could not print.')); } finally { setPrinting(false); }
  };
  const upiNow = plan.payNowPaise ?? total;
  const upiPanel = method === 'UPI' && how !== 'LATER' ? (
    <View style={[s.card, { gap: 10 }]}>
      {vpa ? (
        <>
          <Soft>{t('The bill is printed with a QR code for exactly {amount}. The customer scans the paper and their UPI app opens with the amount filled in.', { amount: rupees(upiNow) })}</Soft>
          <Button title={t('Print the bill with the UPI QR')} onPress={() => { void printUpiBill(); }} busy={printing} disabled={total <= 0 || !plan.ok} />
          <ErrorText>{printProblem}</ErrorText>
          {printNote ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{printNote}</Text> : null}
        </>
      ) : <Soft>This business has no UPI ID set up. Add one in Settings (the owner can), or take the payment another way.</Soft>}
      <TextInput style={[s.input, { alignSelf: 'stretch' }]} value={reference} onChangeText={setReference} placeholder="UPI reference (optional)" accessibilityLabel="UPI reference" />
    </View>
  ) : null;
  const HOWS: { id: PayHow; label: string }[] = [{ id: 'FULL', label: t('Pay in full') }, { id: 'PART', label: t('Part payment') }, { id: 'LATER', label: t('Pay later') }];
  const confirmTitle = how === 'LATER' ? t('Save the bill, {amount} unpaid', { amount: rupees(total) })
    : how === 'PART' ? (plan.ok ? t('Take {now} now, {rest} stays due', { now: rupees(plan.payNowPaise ?? 0), rest: rupees(plan.balancePaise) }) : t('Take part payment'))
    : method === 'CASH' ? 'Cash received, make the bill' : method === 'UPI' ? 'Money received, make the bill' : 'Card paid, make the bill';
  const levyOptions = !orderId ? ([
    gst.tcs ? ['tcs', t('Collect TCS ({rate}%)', { rate: gst.tcsRate })] : null,
    gst.tds ? ['tds', t('Customer deducts TDS ({rate}%)', { rate: gst.tdsRate })] : null,
    gst.reverseCharge ? ['reverse_charge', t('Tax payable on reverse charge')] : null
  ].filter(Boolean) as [keyof Levies, string][]) : [];
  const controls = (
    <>
      {taxDetails ? (
        <View style={{ gap: 8 }}>
          <Button title="Tax invoice details: consignee, delivery, dispatch" kind="quiet" selected={detailsOpen} onPress={() => setDetailsOpen(!detailsOpen)} />
          {detailsOpen ? (
            <View style={[s.card, { gap: 8 }]}>
              <Soft>{t("Printed on the Tally-style invoice. Blank buyer fields use the customer's record; a blank consignee means the same as the buyer.")}</Soft>
              {DETAIL_FIELDS.map(([k, label, big]) => (
                <View key={k} style={{ gap: 2 }}>
                  <Text style={{ color: color.soft, fontSize: 13 }}>{label}</Text>
                  <TextInput style={[s.input, big ? { minHeight: 56, textAlignVertical: 'top' } : null]} multiline={big} maxLength={big ? 300 : 200} value={details[k] ?? ''} onChangeText={(v) => setDetails((o) => ({ ...o, [k]: v }))} accessibilityLabel={label} />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {levyOptions.length ? (
        <View style={{ gap: 8 }}>
          {levyOptions.map(([k, label]) => <Button key={k} title={label} kind="quiet" selected={Boolean(levies[k])} onPress={() => setLevies((o) => ({ ...o, [k]: !o[k] }))} />)}
        </View>
      ) : null}
      {hasFeature(business, 'messaging') && hasCustomer ? <Button title={t('Send the bill on WhatsApp')} kind="quiet" selected={sendWa} onPress={() => setSendWa(!sendWa)} disabled={busy} /> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {HOWS.map((h) => <Button key={h.id} title={h.label} selected={how === h.id} onPress={() => { setHow(h.id); setError(''); }} style={{ flex: 1 }} />)}
      </View>
      {hotel ? <Button title={onRoom ? 'Pay here instead' : 'Charge to a room'} kind="quiet" onPress={() => { setOnRoom(!onRoom); setError(''); }} disabled={busy} /> : null}
      {hotel && onRoom ? (
        <View style={{ gap: 8 }}>
          <Soft>The bill goes on the guest's room bill and is paid when they check out.</Soft>
          <TextInput style={s.input} value={guestText} onChangeText={setGuestText} placeholder="Guest name or room number" accessibilityLabel="Find a guest" />
          {guests.busy && !guests.data ? <Loading /> : null}
          {guests.data && guests.data.length === 0 ? <Soft>No guest is checked in{guestText ? ' with that name or room' : ''}.</Soft> : null}
          {(guests.data ?? []).map((g) => <Button key={g.booking_id} title={`Charge ${rupees(total)} to ${roomGuestLine(g)}`} kind="quiet" onPress={() => { void chargeToRoom(g); }} busy={busy} disabled={total <= 0} />)}
          <ErrorText>{error}</ErrorText>
        </View>
      ) : null}
      {how === 'PART' && !onRoom ? (
        <View style={{ gap: 8 }}>
          <Soft>{t('How much is being paid now?')}</Soft>
          <TextInput style={s.input} value={nowText} onChangeText={setNowText} keyboardType="decimal-pad" placeholder="0" accessibilityLabel={t('Paying now')} />
          {plan.ok ? <Text accessibilityLiveRegion="polite" style={{ color: color.warn, fontWeight: '700' }}>{t('{amount} stays due on {name}.', { amount: rupees(plan.balancePaise), name: owes })}</Text> : null}
        </View>
      ) : null}
      {how === 'LATER' ? <Text style={{ color: color.warn, fontWeight: '700' }}>{t('The whole bill, {amount}, is left unpaid on {name}.', { amount: rupees(total), name: owes })}</Text> : null}
      {how !== 'FULL' && plan.problem ? <ErrorText>{t(plan.problem)}</ErrorText> : null}

      {how !== 'LATER' ? (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {METHODS.map((m) => (
              <Button key={m.id} title={m.label} selected={method === m.id} onPress={() => { setMethod(m.id); void kvSet('last_method', m.id); }} style={{ flex: 1 }} />
            ))}
          </View>

          {method === 'CASH' && how === 'FULL' ? (
            <View style={{ gap: 8 }}>
              <Soft>Cash received (optional)</Soft>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {cashSuggestions(total).map((p, i) => <Button key={p} title={i === 0 ? 'Exact' : rupees(p)} selected={toPaise(given || '0') === p} onPress={() => setGiven(String(p / 100))} style={{ minWidth: 88 }} />)}
              </View>
              <TextInput style={s.input} value={given} onChangeText={setGiven} keyboardType="decimal-pad" placeholder={rupees(total)} accessibilityLabel="Cash received" />
              {change > 0 ? <Text style={{ fontSize: 18, fontWeight: '700', color: color.ok }}>Give back {rupees(change)}</Text> : null}
              {given && change < 0 ? <Text style={{ color: color.danger }}>Short by {rupees(-change)}</Text> : null}
            </View>
          ) : null}

          {upiPanel}

          {method === 'CARD' ? (
            <View style={{ gap: 8 }}>
              <Soft>Take the card on your machine, then record it here. FlowXP is not connected to the machine.</Soft>
              <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="Slip or approval number (optional)" accessibilityLabel="Card reference" />
            </View>
          ) : null}
        </>
      ) : null}

      <ErrorText>{error}</ErrorText>
      <Button title={confirmTitle} onPress={confirm} busy={busy} disabled={lineCount === 0 || (Boolean(orderId) && !order.data)} />
    </>
  );
  const summary = orderId ? (order.data ? orderSummary(order.data) : null) : cartSummary(cart, offers.byKey, gst, levies);

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
        {summary.cessPaise ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Soft>{t('Cess')}</Soft><Soft>{rupees(summary.cessPaise)}</Soft></View> : null}
        {summary.tcsPaise ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Soft>TCS</Soft><Soft>{rupees(summary.tcsPaise)}</Soft></View> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6 }}><Text style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>{t('Total')}</Text><Text style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>≈ {rupees(summary.totalPaise)}</Text></View>
        {summary.tdsPaise ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Soft>{t('TDS held back by the customer')}</Soft><Soft>−{rupees(summary.tdsPaise)}</Soft></View> : null}
        {summary.tdsPaise ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontWeight: '700', color: color.ink }}>{t('Customer pays')}</Text><Text style={{ fontWeight: '700', color: color.ink }}>≈ {rupees(summary.totalPaise - summary.tdsPaise)}</Text></View> : null}
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
        {controls}
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
        {controls}
        <Button title="Back to the bill" kind="quiet" onPress={() => goBack()} disabled={busy} />
      </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
