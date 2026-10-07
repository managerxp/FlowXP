import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { ranges } from '../lib/ranges.ts';
import type { SalesReport } from '../lib/types.ts';
import { qty, rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, Failed, Line, Loading, SavedNote, SectionTitle, Stat, Title, color, s } from '../lib/ui.tsx';

const money = (r: number) => rupees(toPaise(r));
const CHANNEL: Record<string, string> = { COUNTER: 'Counter', DINE_IN: 'Dine in', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery' };

/* Sales for a period: the figures, how it was paid, the busy hours, what sold, which days were best. */
export default function Reports() {
  const session = useSession();
  const [rangeId, setRangeId] = useState('7d');
  const range = ranges().find((r) => r.id === rangeId)!;
  const { data: r, savedAt, error, busy, refresh } = useLoad<SalesReport>(`report:${session.businessId}:${session.branchId}:${range.from}:${range.to}`, () => api.get<SalesReport>(`/reports/sales?from=${range.from}&to=${range.to}`));
  const busiest = r?.by_hour.length ? [...r.by_hour].sort((a, b) => b.total - a.total)[0] : null;
  const best = r?.by_day.length ? [...r.by_day].sort((a, b) => b.total - a.total)[0] : null;
  const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00 to ${String((h + 1) % 24).padStart(2, '0')}:00`;

  return (
    <SafeAreaView style={s.screen}>
      <Page max={900}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title>Reports</Title>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <Chips items={ranges().map((x) => ({ id: x.id, label: x.label }))} value={rangeId as never} onChange={(id) => setRangeId(id)} />
        <SavedNote at={savedAt} />
        {error && !r ? <Failed message={error} onRetry={() => { void refresh(); }} /> : null}
        {busy && !r ? <Loading /> : null}
        {r ? (
          <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { void refresh(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
              <Stat label="Sales" value={money(r.total_sales)} note={`${r.invoice_count} bills`} />
              <Stat label="Average bill" value={r.invoice_count ? money(r.total_sales / r.invoice_count) : '₹0.00'} />
              <Stat label="GST in it" value={money(r.total_tax)} />
              {r.outstanding > 0 ? <Stat label="Still owed" value={money(r.outstanding)} tone={color.warn} /> : null}
            </View>
            {best ? <Line left="Best day" right={money(best.total)} sub={`${best.date} · ${best.invoice_count} bills`} /> : null}
            {busiest ? <Line left="Busiest hour" right={money(busiest.total)} sub={`${hourLabel(busiest.hour)} · ${busiest.invoice_count} bills`} /> : null}

            <SectionTitle>How it was paid</SectionTitle>
            {r.by_payment_method.length ? r.by_payment_method.map((m) => <Line key={m.method} left={m.method} right={money(m.amount)} sub={r.total_sales > 0 ? `${Math.round((m.amount / r.total_sales) * 100)}% of sales` : undefined} />) : <Empty>No payments in this period.</Empty>}

            {r.by_channel.length > 1 ? (
              <>
                <SectionTitle>Where the sales came from</SectionTitle>
                {r.by_channel.map((c) => <Line key={`${c.channel}${c.platform}`} left={c.platform ?? CHANNEL[c.channel] ?? c.channel} right={money(c.total)} sub={`${c.invoice_count} bills`} />)}
              </>
            ) : null}

            <SectionTitle>Best sellers</SectionTitle>
            {r.top_products.length ? r.top_products.map((p) => <Line key={p.product_id} left={p.name} right={money(p.revenue)} sub={`${qty(p.quantity)} sold`} />) : <Empty>No sales in this period.</Empty>}

            {r.by_category.length > 1 ? (
              <>
                <SectionTitle>By category</SectionTitle>
                {r.by_category.map((c) => <Line key={c.category} left={c.category || 'Other'} right={money(c.revenue)} sub={`${qty(c.quantity)} sold`} />)}
              </>
            ) : null}

            <SectionTitle>Day by day</SectionTitle>
            {[...r.by_day].reverse().map((d) => <Line key={d.date} left={d.date} right={money(d.total)} sub={`${d.invoice_count} bills`} />)}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
