import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../lib/api.ts';
import { api } from '../../lib/session.ts';
import type { PriceList } from '../../lib/pricing.ts';
import { goBack } from '../../lib/nav.ts';
import { setCustomer } from '../../lib/sale.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { creditText, ledgerText, type LedgerLine, type OpenInvoice, type WCustomer, type WOrder } from '../../lib/wholesale.ts';
import { rupees, toPaise } from '../../lib/money.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, Chips, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Stat, Title, color, s } from '../../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));

/* One customer's account: how much they owe and since when, their credit limit, the bills still open, their latest orders and the account statement. Take an order or collect a payment from here. */
export default function WholesaleCustomer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useLoad<WCustomer>(`wcustomer:${id}`, () => api.get<WCustomer>(`/wholesale/customers/${id}`));
  const open = useLoad<{ advance: number; invoices: OpenInvoice[] }>(`wopen:${id}`, () => api.get(`/wholesale/customers/${id}/open-invoices`));
  const orders = useLoad<WOrder[]>(`worders-of:${id}`, () => api.get<WOrder[]>(`/wholesale/orders?customer_id=${id}&limit=5`));
  const ledger = useLoad<{ closing: number; lines: LedgerLine[] }>(`wledger:${id}`, () => api.get(`/wholesale/customers/${id}/ledger`));
  const x = c.data;
  const priceLists = useLoad<PriceList[]>('price-lists-pick', () => api.get<PriceList[]>('/wholesale/price-lists'));
  const [changing, setChanging] = useState(false);
  const [listProblem, setListProblem] = useState('');
  const chooseList = async (v: string) => {
    setListProblem('');
    try { await api.call(`/wholesale/customers/${id}`, { method: 'PUT', body: { price_list_id: v ? Number(v) : null } }); setChanging(false); void c.refresh(); }
    catch (e) { setListProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not change the price list'); }
  };
  const credit = x?.credit ? creditText({ level: x.credit.level ?? 'OK', reasons: x.credit.reasons ?? [], limit: x.credit.limit, outstanding: x.credit.outstanding, available: x.credit.available }) : null;

  const take = (path: '/wholesale-order-new' | '/collect') => { if (x) { setCustomer({ id: x.customer_id, name: x.name, phone: x.phone }); router.push(path); } };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{x?.name ?? 'Customer'}</Title>{x ? <Soft>{[x.phone, x.gstin, x.city].filter(Boolean).join(' · ')}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {c.busy && !x ? <Loading /> : null}
        {c.error && !x ? <Failed message={c.error} onRetry={() => { void c.refresh(); }} /> : null}
        {x ? (
          <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
              <Button title="New order" onPress={() => take('/wholesale-order-new')} style={{ flex: 1 }} />
              <Button title="Collect payment" kind="quiet" onPress={() => take('/collect')} style={{ flex: 1 }} />
            </View>
            <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><Button title="They are returning goods" kind="quiet" onPress={() => { setCustomer({ id: x.customer_id, name: x.name, phone: x.phone }); router.push('/return-sale'); }} /></View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
              <Stat label="Owes" value={money(x.outstanding ?? 0)} tone={(x.outstanding ?? 0) > 0 ? color.warn : undefined} />
              <Stat label="Overdue" value={money(x.overdue ?? 0)} tone={(x.overdue ?? 0) > 0 ? color.danger : undefined} />
              {x.credit_limit > 0 ? <Stat label="Credit limit" value={money(x.credit_limit)} note={x.credit?.available != null ? `${money(x.credit.available)} left` : undefined} /> : null}
              {open.data && open.data.advance > 0 ? <Stat label="Paid in advance" value={money(open.data.advance)} tone={color.ok} /> : null}
            </View>
            {credit && credit.text ? <Text style={{ paddingHorizontal: 16, color: credit.tone === 'bad' ? color.danger : credit.tone === 'warn' ? color.warn : color.soft, fontWeight: '600' }}>{credit.text}</Text> : null}
            <Soft style={{ paddingHorizontal: 16, paddingTop: 4 }}>{[x.payment_terms_days != null ? `Pays in ${x.payment_terms_days} days` : null, x.price_list ? `Price list: ${x.price_list}` : null, x.salesperson ? `Salesperson: ${x.salesperson}` : null].filter(Boolean).join(' · ')}</Soft>

            {priceLists.data && priceLists.data.length > 0 ? (
              <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 8 }}>
                <Button title={changing ? 'Close' : 'Change price list'} kind="quiet" onPress={() => setChanging((v) => !v)} />
                {changing ? <Chips items={[{ id: '', label: 'None' }, ...priceLists.data.filter((l) => l.is_active).map((l) => ({ id: String(l.list_id), label: l.name }))]} value={x.price_list_id ? String(x.price_list_id) : ''} onChange={(v) => { void chooseList(v); }} /> : null}
                <ErrorText>{listProblem}</ErrorText>
              </View>
            ) : null}

            <SectionTitle>Bills not yet paid</SectionTitle>
            {open.data && open.data.invoices.length === 0 ? <Soft style={{ padding: 16 }}>Nothing is owed.</Soft> : null}
            {(open.data?.invoices ?? []).map((i) => <Line key={i.invoice_id} left={i.invoice_number} sub={`${String(i.invoice_date).slice(0, 10)} · due ${String(i.due_date).slice(0, 10)}${i.days_overdue > 0 ? ` · ${i.days_overdue} days late` : ''}`} right={money(i.balance)} />)}

            <SectionTitle>Latest orders</SectionTitle>
            {orders.data && orders.data.length === 0 ? <Soft style={{ padding: 16 }}>No orders yet.</Soft> : null}
            {(orders.data ?? []).map((o) => <Line key={o.order_id} left={o.order_number} sub={`${String(o.order_date).slice(0, 10)} · ${o.status.toLowerCase().replace(/_/g, ' ')}`} right={money(o.total)} onPress={() => router.push({ pathname: '/wholesale-order/[id]', params: { id: String(o.order_id) } })} />)}

            <SectionTitle>Account statement</SectionTitle>
            {(ledger.data?.lines ?? []).slice(-12).reverse().map((l, i) => <Line key={i} left={ledgerText(l)} sub={String(l.date).slice(0, 10)} right={l.debit > 0 ? `+${money(l.debit)}` : `−${money(l.credit)}`} />)}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
