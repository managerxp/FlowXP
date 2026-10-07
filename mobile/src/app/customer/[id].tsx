import { Linking, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { setCustomer } from '../../lib/sale.ts';
import type { Customer } from '../../lib/types.ts';
import { rupees, toPaise } from '../../lib/money.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, Empty, Failed, Line, SavedNote, SectionTitle, Soft, Stat, Title, color, s } from '../../lib/ui.tsx';

const money = (r: number) => rupees(toPaise(r));
type Bill = { invoice_id: number; invoice_number: string; invoice_date: string; total: number; balance_due: number; payment_status: string; status: string };

/* One customer: what they have bought, what they owe, their recent bills. Start a bill for them with one tap. */
export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const customer = useLoad<Customer>(`customer:${session.businessId}:${id}`, () => api.get<Customer>(`/customers/${id}`));
  const bills = useLoad<Bill[]>(`customer-bills:${session.businessId}:${id}`, () => api.get<Bill[]>(`/customers/${id}/invoices`));
  const c = customer.data;

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
              {c.last_bill_date ? <Line left="Last bill" right={String(c.last_bill_date).slice(0, 10)} sub={c.first_bill_date ? `Customer since ${String(c.first_bill_date).slice(0, 10)}` : undefined} /> : null}
            </>
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
