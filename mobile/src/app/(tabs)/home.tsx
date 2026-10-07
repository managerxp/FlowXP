import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../../lib/session.ts';
import { useLoad } from '../../lib/useLoad.ts';
import type { Dashboard } from '../../lib/types.ts';
import { rupees, toPaise } from '../../lib/money.ts';
import { barHeights } from '../../lib/ranges.ts';
import { SyncBadge } from '../../lib/SyncBadge.tsx';
import { Page } from '../../lib/responsive.tsx';
import { GettingStarted, useLearning } from '../../lib/learn.tsx';
import { shouldOfferTour } from '../../lib/onboarding.ts';
import { KITCHEN_TYPES } from '../../lib/cart.ts';
import { t } from '../../lib/i18n.ts';
import { useEffect } from 'react';
import { Button, Empty, Failed, Line, Loading, SavedNote, SectionTitle, Soft, Stat, Title, color, s } from '../../lib/ui.tsx';

const hour = () => { const h = new Date().getHours(); return t(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'); };
const money = (rupeesValue: number) => rupees(toPaise(rupeesValue));

/* A small bar chart of the last days' sales: the tallest bar is the best day. */
const Bars = ({ days }: { days: { date: string; total: number }[] }) => {
  const heights = barHeights(days.map((d) => d.total));
  return (
    <View style={[s.card, { marginHorizontal: 16 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 4 }}>
        {days.map((d, i) => (
          <View key={d.date} accessibilityLabel={`${d.date}: ${money(d.total)}`} style={{ flex: 1, height: `${heights[i] * 100}%`, backgroundColor: i === days.length - 1 ? color.brand : '#9db8ff', borderRadius: 4 }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Soft>{days[0]?.date.slice(5)}</Soft><Soft>{t('Today')}</Soft>
      </View>
    </View>
  );
};

export default function Home() {
  const session = useSession();
  const business = currentBusiness(session);
  const outlet = business?.outlets.find((o) => o.branch_id === session.branchId);
  const { data, savedAt, error, busy, refresh } = useLoad<Dashboard>(`dash:${session.businessId}:${session.branchId}`, () => api.get<Dashboard>('/dashboard'));
  const learning = useLearning();
  const food = KITCHEN_TYPES.includes(business?.business_type ?? '');
  // the first time, offer the one-minute tour by itself (it can be skipped, and is never shown again once seen or skipped)
  useEffect(() => { if (learning.ready && shouldOfferTour(learning.kept) && session.businessId != null) router.push('/welcome'); }, [learning.ready]);   // eslint-disable-line react-hooks/exhaustive-deps
  const m = data?.metrics ?? null;
  const change = m && m.yesterday_sales > 0 ? Math.round(((m.today_sales - m.yesterday_sales) / m.yesterday_sales) * 100) : null;

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Page max={900}>
        <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { void refresh(); }} />} contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={{ padding: 16, gap: 4 }}>
            <Soft>{hour()}, {session.user?.name?.split(' ')[0]}</Soft>
            <Title>{business?.name}</Title>
            <Soft>{outlet?.name}</Soft>
            <SyncBadge />
          </View>
          <SavedNote at={savedAt} />
          {error && !data ? <Failed message={error} onRetry={() => { void refresh(); }} /> : null}

          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
            <Button title="New bill" onPress={() => router.push('/sell')} style={{ flex: 1 }} />
            <Button title="Scan" kind="quiet" onPress={() => router.push('/scan')} />
          </View>

          <GettingStarted food={food} />
          {m ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
              <Stat label="Today's sales" value={money(m.today_sales)} note={change === null ? undefined : `${change >= 0 ? '+' : ''}${change}% vs yesterday`} tone={change !== null && change < 0 ? color.danger : undefined} />
              <Stat label="Bills today" value={String(m.today_invoice_count)} note={`Yesterday ${money(m.yesterday_sales)}`} />
              <Stat label="Still to be paid" value={money(m.outstanding)} tone={m.outstanding > 0 ? color.warn : undefined} />
              <Stat label="Low on stock" value={String(m.low_stock_count)} tone={m.low_stock_count > 0 ? color.danger : undefined} note={m.low_stock_count ? 'See Products' : undefined} />
            </View>
          ) : data ? <Empty>Today's figures are shown to people allowed to see reports.</Empty> : null}

          {data?.sales ? (
            <>
              <SectionTitle>{t('Last {n} days', { n: data.sales.trend.length })}</SectionTitle>
              <Bars days={data.sales.trend} />
              <SectionTitle>Best sellers this week</SectionTitle>
              {data.sales.top_products.length ? data.sales.top_products.map((p) => <Line key={p.product_id} left={p.name} sub={`${p.quantity} sold`} right={money(p.revenue)} />) : <Empty>No sales yet this week.</Empty>}
              <SectionTitle>Latest bills</SectionTitle>
              {data.sales.recent_invoices.length ? data.sales.recent_invoices.map((i) => (
                <Line key={i.invoice_id} left={i.invoice_number} sub={`${i.customer_name ?? 'Walk-in'} · ${new Date(i.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`} right={money(i.total)} onPress={() => router.push({ pathname: '/receipt', params: { id: String(i.invoice_id) } })} />
              )) : <Empty>No bills yet.</Empty>}
            </>
          ) : null}
          {!data && busy ? <Loading what="Loading today's figures" /> : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
