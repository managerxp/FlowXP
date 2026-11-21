import { useState } from 'react';
import { display } from '../lib/theme.ts';
import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { useLoad } from '../lib/useLoad.ts';
import { ranges } from '../lib/ranges.ts';
import type { SalesReport } from '../lib/types.ts';
import { qty, rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { averageBill, insights, profitNote, type Profit } from '../lib/reportsView.ts';
import AskReports from '../lib/AskReports.tsx';
import { Button, Chips, Empty, Failed, Group, Line, Loading, SavedNote, SectionTitle, Soft, Title, TrendBars, color, s } from '../lib/ui.tsx';
import { barHeights } from '../lib/ranges.ts';

const money = (r: number) => rupees(toPaise(r));
const CHANNEL: Record<string, string> = { COUNTER: 'Counter', DINE_IN: 'Dine in', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery' };

/* Sales for a period: the figures, how it was paid, the busy hours, what sold, which days were best. */
export default function Reports() {
  const session = useSession();
  const business = currentBusiness(session);
  const [rangeId, setRangeId] = useState('today');
  const range = ranges().find((r) => r.id === rangeId)!;
  const { data: r, savedAt, error, busy, refresh } = useLoad<SalesReport>(`report:${session.businessId}:${session.branchId}:${range.from}:${range.to}`, () => api.get<SalesReport>(`/reports/sales?from=${range.from}&to=${range.to}`));
  // the estimated profit is on plans with advanced reports: when it is not there, the figure is simply not shown
  const profit = useLoad<{ totals: Profit }>(`profit:${session.businessId}:${session.branchId}:${range.from}:${range.to}`, () => api.get<{ totals: Profit }>(`/profitability?from=${range.from}&to=${range.to}`));
  const [detail, setDetail] = useState(false);
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
            <AskReports />
            <View style={{ margin: 16, padding: 20, gap: 16, borderRadius: 24, borderCurve: 'continuous', backgroundColor: color.navy }}>
              <Text style={{ color: color.onNavySoft, fontSize: 14, fontWeight: '500' }}>{t(rangeId === 'today' ? "Today's sales" : 'Sales')}</Text>
              <Text selectable adjustsFontSizeToFit numberOfLines={1} style={{ color: color.onNavy, fontSize: 38, fontFamily: display.bold, letterSpacing: -1, fontVariant: ['tabular-nums'] }}>{money(r.total_sales)}</Text>
              <View style={{ flexDirection: 'row', gap: 12, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#ffffff22' }}>
                {[[t('Bills'), String(r.invoice_count), undefined], [t('Average bill'), money(averageBill(r)), undefined], ...(profit.data ? [[t('Estimated profit'), money(profit.data.totals.estimated_net), profit.data.totals.estimated_net < 0 ? '#ffb4ad' : undefined]] : [])].map(([label, value, tone]) => (
                  <View key={label} style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: color.onNavySoft, fontSize: 12 }}>{label}</Text>
                    <Text adjustsFontSizeToFit numberOfLines={1} style={{ color: tone ?? color.onNavy, fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
                  </View>))}
              </View>
            </View>
            {profit.data ? <Soft style={{ paddingHorizontal: 16 }}>{profitNote(profit.data.totals)}</Soft> : null}
            {r.outstanding > 0 ? <View style={{ marginTop: 12 }}><Group><Line left="Still owed to you" right={money(r.outstanding)} icon="wallet-outline" /></Group></View> : null}
            {insights(r, money).length ? (
              <View style={[s.card, { marginHorizontal: 16, marginTop: 12, gap: 6 }]}>
                <Text accessibilityRole="header" style={{ fontWeight: '700', color: color.ink }}>What happened</Text>
                {insights(r, money).map((x) => <Text key={x} style={{ color: color.ink, lineHeight: 21 }}>{x}</Text>)}
              </View>
            ) : r.invoice_count === 0 ? <Empty>No sales in this period yet. Make a bill and it shows up here.</Empty> : null}

            <SectionTitle>Best sellers</SectionTitle>
            {r.top_products.length ? <Group>{r.top_products.slice(0, 5).map((p) => <Line key={p.product_id} left={p.name} right={money(p.revenue)} sub={`${qty(p.quantity)} sold`} />)}</Group> : <Empty>No sales in this period.</Empty>}

            <View style={{ padding: 16, gap: 8 }}><Button title={detail ? 'Hide detailed reports' : 'View detailed reports'} kind="quiet" onPress={() => setDetail((v) => !v)} /></View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 16 }}>
              {[...(allowed(business, 'expenses') ? [['Expenses', '/expenses']] : []), ['More reports', '/biz-reports'], ['Ask Flow AI about this', '/flow-ai']].map(([label, go]) => (
                <Pressable key={go} accessibilityRole="button" onPress={() => router.push(go as never)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 }}>
                  <Text style={{ color: color.brand, fontWeight: '600' }}>{t(label)}</Text>
                </Pressable>
              ))}
            </View>
            {detail ? <>
            {best || busiest ? <Group>
              {best ? <Line left="Best day" right={money(best.total)} sub={`${best.date} · ${best.invoice_count} bills`} /> : null}
              {busiest ? <Line left="Busiest hour" right={money(busiest.total)} sub={`${hourLabel(busiest.hour)} · ${busiest.invoice_count} bills`} /> : null}
            </Group> : null}

            <SectionTitle>How it was paid</SectionTitle>
            {r.by_payment_method.length ? <Group>{r.by_payment_method.map((m) => <Line key={m.method} left={m.method} right={money(m.amount)} sub={r.total_sales > 0 ? `${Math.round((m.amount / r.total_sales) * 100)}% of sales` : undefined} />)}</Group> : <Empty>No payments in this period.</Empty>}

            {r.by_channel.length > 1 ? (
              <>
                <SectionTitle>Where the sales came from</SectionTitle>
                <Group>{r.by_channel.map((c) => <Line key={`${c.channel}${c.platform}`} left={c.platform ?? CHANNEL[c.channel] ?? c.channel} right={money(c.total)} sub={`${c.invoice_count} bills`} />)}</Group>
              </>
            ) : null}


            {r.by_category.length > 1 ? (
              <>
                <SectionTitle>By category</SectionTitle>
                <Group>{r.by_category.map((c) => <Line key={c.category} left={c.category || 'Other'} right={money(c.revenue)} sub={`${qty(c.quantity)} sold`} />)}</Group>
              </>
            ) : null}

            <SectionTitle>Day by day</SectionTitle>
            {r.by_day.length > 1 ? <TrendBars days={r.by_day} money={money} heights={barHeights(r.by_day.map((d) => d.total))} /> : null}
            <View style={{ height: 12 }} /><Group>{[...r.by_day].reverse().map((d) => <Line key={d.date} left={d.date} right={money(d.total)} sub={`${d.invoice_count} bills`} />)}</Group>
            </> : null}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
