import { memo, useEffect, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { SearchBox } from '../../lib/SearchBox.tsx';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../../lib/session.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { ranges } from '../../lib/ranges.ts';
import type { InvoiceRow, InvoiceSummary } from '../../lib/types.ts';
import { rupees, toPaise } from '../../lib/money.ts';
import { useSyncState } from '../../lib/sync.ts';
import { WaitingList } from '../../lib/WaitingList.tsx';
import { Page, ColumnList } from '../../lib/responsive.tsx';
import { markDone } from '../../lib/learn.tsx';
import { Chips, Empty, Failed, ListRow, Loading, SavedNote, Stat, Title, color, s } from '../../lib/ui.tsx';

const money = (r: number) => rupees(toPaise(r));
type Tab = 'bills' | 'phone';
const STATUS: Record<string, { label: string; tone: string }> = { PAID: { label: 'Paid', get tone() { return color.ok; } }, PARTIAL: { label: 'Part paid', get tone() { return color.warn; } }, UNPAID: { label: 'Unpaid', get tone() { return color.danger; } } };

const BillRow = memo(({ i }: { i: InvoiceRow }) => {
  const cancelled = i.status === 'CANCELLED';
  const st = STATUS[i.payment_status] ?? { label: i.payment_status, tone: color.soft };
  const bg = st.label === 'Paid' ? color.okBg : st.label === 'Unpaid' ? color.dangerBg : st.label === 'Part paid' ? color.warnBg : color.wash;
  return (
    <ListRow
      title={i.invoice_number} right={money(i.total)} dim={cancelled}
      sub={`${i.customer_name ?? i.table_name ?? 'Walk-in'} · ${new Date(i.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
      pill={cancelled ? 'Cancelled' : st.label} pillTone={cancelled ? color.soft : st.tone} pillBg={cancelled ? color.wash : bg}
      onPress={() => router.push({ pathname: '/receipt', params: { id: String(i.invoice_id) } })}
    />
  );
});
const renderBill = ({ item }: { item: InvoiceRow }) => <BillRow i={item} />;

/* Every bill, searchable, for a day or a few weeks; and the sales still on this phone. */
export default function Sales() {
  const session = useSession();
  const sync = useSyncState();
  const [tab, setTab] = useState<Tab>('bills');
  const [rangeId, setRangeId] = useState('today');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const range = ranges().find((r) => r.id === rangeId)!;
  useEffect(() => { markDone('first_bills_page'); }, []);

  useEffect(() => { const t = setTimeout(() => setSearch(text.trim()), 350); return () => clearTimeout(t); }, [text]);   // wait for a pause in typing

  const scopeKey = `${session.businessId}:${session.branchId}`;
  const bills = useLoad<InvoiceRow[]>(`bills:${scopeKey}:${range.from}:${range.to}:${search}`, () => api.get<InvoiceRow[]>(`/invoices?from=${range.from}&to=${range.to}${search ? `&search=${encodeURIComponent(search)}` : ''}`), tab === 'bills');
  const summary = useLoad<InvoiceSummary>(`billsum:${scopeKey}:${range.from}:${range.to}`, () => api.get<InvoiceSummary>(`/invoices/summary?from=${range.from}&to=${range.to}`), tab === 'bills');
  const sm = summary.data;

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Page grid>
        <View style={{ padding: 16, paddingBottom: 8 }}><Title>Bills</Title></View>
        {tab === 'phone' || sync.pending + sync.failed > 0 ? (   // the 'waiting to send' tab only shows while something is waiting; More > Bills waiting to send always reaches it
          <Chips<Tab> items={[{ id: 'bills', label: 'All bills' }, { id: 'phone', label: `Waiting to send${sync.pending + sync.failed ? ` (${sync.pending + sync.failed})` : ''}` }]} value={tab} onChange={setTab} />
        ) : null}
        {tab === 'phone' ? <WaitingList /> : (
          <>
            <Chips items={ranges().map((r) => ({ id: r.id, label: r.label }))} value={rangeId as never} onChange={(id) => setRangeId(id)} />
            <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
              <SearchBox value={text} onChange={setText} placeholder="Bill number, customer or phone" label="Search bills" />
            </View>
            <SavedNote at={bills.savedAt} />
            {sm ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
                <Stat label="Bills" value={String(sm.bills)} note={sm.cancelled ? `${sm.cancelled} cancelled` : undefined} />
                <Stat label="Billed" value={money(sm.billed)} note={`Average ${money(sm.average)}`} />
                {sm.due > 0 ? <Stat label="Still owed" value={money(sm.due)} note={`${sm.owing} bills`} tone={color.warn} /> : null}
              </View>
            ) : null}
            {bills.error && !bills.data ? <Failed message={bills.error} onRetry={() => { void bills.refresh(); }} /> : null}
            <ColumnList
              style={{ flex: 1 }} data={bills.data ?? []} keyExtractor={(i) => String(i.invoice_id)}
              refreshControl={<RefreshControl refreshing={bills.busy} onRefresh={() => { void bills.refresh(); void summary.refresh(); }} />}
              ListEmptyComponent={bills.busy ? <Loading what="Loading bills" /> : <Empty>{search ? 'No bill matches that. Check the spelling, or choose a longer period above.' : 'No bills in this period yet. Choose a longer period above, or make a bill on Sell.'}</Empty>}
              ListFooterComponent={bills.data && bills.data.length >= 200 ? <Empty>Showing the latest 200 bills. Search, or choose a shorter period, to find others.</Empty> : null}
              renderItem={renderBill}
            />
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
