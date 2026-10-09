import { useRef, useState } from 'react';
import { Linking, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../../lib/api.ts';
import { api, useSession } from '../../lib/session.ts';
import { METHOD_ORDER } from '../../lib/billing.ts';
import { paymentBody, paymentProblem, since, type PayMethod } from '../../lib/customers.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { setCustomer } from '../../lib/sale.ts';
import type { Customer } from '../../lib/types.ts';
import { rupees, toPaise } from '../../lib/money.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Line, SavedNote, SectionTitle, Soft, Stat, Title, color, s } from '../../lib/ui.tsx';

const money = (r: number) => rupees(toPaise(r));
type Bill = { invoice_id: number; invoice_number: string; invoice_date: string; total: number; balance_due: number; payment_status: string; status: string };

/* One customer: what they have bought, what they owe, their recent bills. Start a bill for them with one tap. */
export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const customer = useLoad<Customer>(`customer:${session.businessId}:${id}`, () => api.get<Customer>(`/customers/${id}`));
  const bills = useLoad<Bill[]>(`customer-bills:${session.businessId}:${id}`, () => api.get<Bill[]>(`/customers/${id}/invoices`));
  const c = customer.data;
  // taking a payment against one unpaid bill
  const [paying, setPaying] = useState<Bill | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('UPI');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState('');
  const key = useRef(newKey());   // one key per payment: a double tap takes it once
  const owing = (bills.data ?? []).filter((b) => b.status !== 'CANCELLED' && b.balance_due > 0);
  const start = (b: Bill) => { setPaying(b); setAmount(String(b.balance_due)); setReference(''); setProblem(''); setDone(''); key.current = newKey(); };
  const bad = paying ? paymentProblem(amount, paying.balance_due) : '';
  const collect = async () => {
    if (!paying) return;
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      await api.post(`/invoices/${paying.invoice_id}/payments`, paymentBody(amount, method, reference), { idempotencyKey: key.current });
      setDone(`${money(Number(amount))} received for ${paying.invoice_number}.`); setPaying(null);
      void customer.refresh(); void bills.refresh();
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'The payment did not go through. Your data is safe. Try again.'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}><Title>{c?.name ?? 'Customer'}</Title>{c?.phone ? <Soft>{c.phone}</Soft> : null}</View>
            <Button title="Back" kind="quiet" onPress={() => goBack()} />
          </View>
          <SavedNote at={customer.savedAt} />
          {customer.error && !c ? <Failed message={customer.error} onRetry={() => { void customer.refresh(); }} /> : null}
          {c ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
                <Stat label="Bought so far" value={money(c.total_purchases)} note={`${c.bills} bills`} />
                <Stat label="Owes you" value={money(c.outstanding_balance)} tone={c.outstanding_balance > 0 ? color.warn : undefined} note={c.credit_limit > 0 ? `Limit ${money(c.credit_limit)}` : undefined} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, padding: 16 }}>
                <Button title="Start a bill" onPress={() => { setCustomer({ id: c.customer_id, name: c.name, phone: c.phone }); router.navigate('/sell'); }} style={{ flex: 1 }} />
                {c.phone ? <Button title="Call" kind="quiet" onPress={() => { void Linking.openURL(`tel:${c.phone}`); }} /> : null}
              </View>
              {c.email ? <Line left="Email" right={c.email} /> : null}
              {c.gstin ? <Line left="GSTIN" right={c.gstin} /> : null}
              {c.last_bill_date ? <Line left="Last bill" right={since(c.last_bill_date)} sub={c.first_bill_date ? `Customer since ${String(c.first_bill_date).slice(0, 10)}` : undefined} /> : null}
            </>
          ) : null}
          {owing.length > 0 || done ? <SectionTitle>Customer dues</SectionTitle> : null}
          {done ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '600', paddingHorizontal: 16, paddingBottom: 6 }}>{done}</Text> : null}
          {owing.map((b) => <Line key={`due-${b.invoice_id}`} icon="cash-outline" left={b.invoice_number} sub={`${String(b.invoice_date).slice(0, 10)} · of ${money(b.total)}`} right={`${money(b.balance_due)} due`} onPress={() => start(b)} />)}
          {paying ? (
            <View style={{ padding: 16, gap: 10, backgroundColor: '#eaf1ff' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: color.ink }}>{`Payment for ${paying.invoice_number}`}</Text>
              <TextInput style={s.input} value={amount} onChangeText={(v) => { setAmount(v); setProblem(''); }} keyboardType="decimal-pad" accessibilityLabel="Amount paid" placeholder="How much did they pay?" />
              <Chips<PayMethod> items={METHOD_ORDER.map((m) => ({ id: m, label: m === 'UPI' ? 'UPI' : m === 'CASH' ? 'Cash' : 'Card' }))} value={method} onChange={setMethod} />
              {method !== 'CASH' ? <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="Reference (optional)" accessibilityLabel="Reference" /> : null}
              <ErrorText>{problem || bad}</ErrorText>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Cancel" kind="quiet" onPress={() => setPaying(null)} disabled={busy} />
                <Button title="Money received" onPress={() => { void collect(); }} busy={busy} disabled={Boolean(bad)} style={{ flex: 1 }} />
              </View>
            </View>
          ) : null}

          <SectionTitle>Recent bills</SectionTitle>
          {bills.data?.length ? bills.data.map((b) => (
            <Line key={b.invoice_id} left={b.invoice_number} right={money(b.total)} sub={`${String(b.invoice_date).slice(0, 10)}${b.status === 'CANCELLED' ? ' · Cancelled' : b.balance_due > 0 ? ` · Owes ${money(b.balance_due)}` : ''}`} onPress={() => router.push({ pathname: '/receipt', params: { id: String(b.invoice_id) } })} />
          )) : <Empty>{bills.busy ? 'Loading…' : 'No bills yet.'}</Empty>}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
