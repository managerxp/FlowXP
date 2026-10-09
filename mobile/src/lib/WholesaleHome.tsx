import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from './session.ts';
import { setCustomer } from './sale.ts';
import { useLoad } from './useLoad.ts';
import { rupees, toPaise } from './money.ts';
import { Page } from './responsive.tsx';
import { Button, Failed, Loading, SavedNote, SectionTitle, Soft, Stat, Title, color, s } from './ui.tsx';

type Dash = {
  sections?: { sales: boolean; money: boolean; operations: boolean };
  sales?: { today: { invoices: number; total: number }; month: { total: number; change_pct: number | null } };
  orders?: { pending: number; pending_value: number; to_fulfil: number; needing_approval: number; backorder_lines: number };
  money?: { receivable: number; overdue: number; collected_today: number; credit_exceeded: number; top_debtors: { customer_id: number; name: string; owed: number }[] };
  inventory?: { alerts?: Record<string, number>; low_stock: { product_id: number; name: string; available: number; reorder_level: number }[] };
};
const m = (n: number | undefined) => rupees(toPaise(n ?? 0));

/* The Sell tab for a wholesale or distribution business: the day's money and orders at a glance, and the four things done most (take an order, collect a payment, see orders, see customers). */
export function WholesaleHome() {
  const session = useSession();
  const dash = useLoad<Dash>(`wholesale-dash:${session.businessId}:${session.branchId}`, () => api.get<Dash>('/wholesale/dashboard'));
  const d = dash.data;
  const fresh = () => setCustomer(null);

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Page>
        <View style={{ padding: 16, gap: 4 }}><Title>Orders and payments</Title><Soft>Take an order for a customer, or collect what they owe</Soft></View>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <Button title="New order" onPress={() => { fresh(); router.push('/wholesale-order-new'); }} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="My route" kind="quiet" onPress={() => router.push('/field')} style={{ flex: 1 }} />
              <Button title="My van" kind="quiet" onPress={() => router.push('/van')} style={{ flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Warehouse" kind="quiet" onPress={() => router.push('/warehouse')} style={{ flex: 1 }} />
              <Button title="Buying" kind="quiet" onPress={() => router.push('/purchasing')} style={{ flex: 1 }} />
              <Button title="Returns" kind="quiet" onPress={() => router.push('/returns')} style={{ flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Collect payment" kind="quiet" onPress={() => { fresh(); router.push('/collect'); }} style={{ flex: 1 }} />
              <Button title="Orders" kind="quiet" onPress={() => router.push('/wholesale-orders')} style={{ flex: 1 }} />
              <Button title="Customers" kind="quiet" onPress={() => router.push('/wholesale-customers')} style={{ flex: 1 }} />
            </View>
          </View>
          <SavedNote at={dash.savedAt} />
          {dash.error && !d ? <Failed message={dash.error} onRetry={() => { void dash.refresh(); }} /> : null}
          {dash.busy && !d ? <Loading /> : null}
          {d?.sales ? (
            <>
              <SectionTitle>Sales</SectionTitle>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
                <Stat label="Billed today" value={m(d.sales.today.total)} note={`${d.sales.today.invoices} bills`} />
                <Stat label="Billed this month" value={m(d.sales.month.total)} note={d.sales.month.change_pct != null ? `${d.sales.month.change_pct > 0 ? '+' : ''}${d.sales.month.change_pct}% on last month` : undefined} />
              </View>
            </>
          ) : null}
          {d?.orders ? (
            <>
              <SectionTitle>Orders</SectionTitle>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
                <Stat label="Waiting" value={String(d.orders.pending)} note={m(d.orders.pending_value)} tone={d.orders.pending ? color.warn : undefined} />
                <Stat label="To send out" value={String(d.orders.to_fulfil)} />
                {d.orders.backorder_lines ? <Stat label="Short of stock" value={String(d.orders.backorder_lines)} note="lines promised, not covered" tone={color.danger} /> : null}
              </View>
            </>
          ) : null}
          {d?.money ? (
            <>
              <SectionTitle>Money</SectionTitle>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
                <Stat label="Owed to you" value={m(d.money.receivable)} />
                <Stat label="Overdue" value={m(d.money.overdue)} tone={d.money.overdue ? color.danger : undefined} />
                <Stat label="Collected today" value={m(d.money.collected_today)} tone={color.ok} />
                {d.money.credit_exceeded ? <Stat label="Over their limit" value={String(d.money.credit_exceeded)} note="customers" tone={color.danger} /> : null}
              </View>
              {d.money.top_debtors.length ? <SectionTitle>Who owes the most</SectionTitle> : null}
              {d.money.top_debtors.map((c) => (
                <View key={c.customer_id} style={{ paddingHorizontal: 16 }}>
                  <Button title={`${c.name} · ${m(c.owed)}`} kind="quiet" onPress={() => router.push({ pathname: '/wholesale-customer/[id]', params: { id: String(c.customer_id) } })} style={{ marginBottom: 6 }} />
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
