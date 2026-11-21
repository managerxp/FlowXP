import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '../../lib/icons.tsx';
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
import { allowed } from '../../lib/access.ts';
import GarageHome from '../../lib/GarageHome.tsx';
import { useEffect } from 'react';
import { Empty, Failed, Loading, SavedNote, SectionTitle, Soft, color, s } from '../../lib/ui.tsx';
import { display, radius, shadow } from '../../lib/theme.ts';

const hour = () => { const h = new Date().getHours(); return t(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'); };
const money = (rupeesValue: number) => rupees(toPaise(rupeesValue));
const initials = (name?: string | null) => (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'F';
const STATUS: Record<string, { label: string; tone: () => string }> = { PAID: { label: 'Paid', tone: () => color.ok }, PARTIAL: { label: 'Part paid', tone: () => color.warn }, UNPAID: { label: 'Unpaid', tone: () => color.danger } };

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/* A round avatar made of initials (the business, or the person). */
const Avatar = ({ text, size = 44, dark = false }: { text: string; size?: number; dark?: boolean }) => (
  <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: dark ? color.navy : color.wash }}>
    <Text style={{ color: dark ? color.onNavy : color.ink, fontWeight: '700', fontSize: size * 0.36 }}>{text}</Text>
  </View>
);

/* A round icon button in the header (the bell). */
const IconButton = ({ icon, label, go }: { icon: IconName; label: string; go: () => void }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={t(label)} onPress={go} hitSlop={4}
    style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? color.press : color.card, borderWidth: 1, borderColor: color.line })}>
    <Ionicons name={icon} size={21} color={color.ink} />
  </Pressable>
);

/* The one figure that matters most: today's sales, large, on deep navy, with how it compares and the bills behind it. */
const Hero = ({ sales, change, bills, yesterday, go }: { sales: number; change: number | null; bills: number; yesterday: number; go: () => void }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={`${t("Today's sales")}: ${money(sales)}${change === null ? '' : `, ${change >= 0 ? '+' : ''}${change}% ${t('vs yesterday')}`}`} onPress={go}
    style={({ pressed }) => ({ marginHorizontal: 16, padding: 20, gap: 18, borderRadius: radius.card + 4, borderCurve: 'continuous', backgroundColor: color.navy, boxShadow: shadow.card, opacity: pressed ? 0.94 : 1 })}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: color.onNavySoft, fontSize: 14, fontWeight: '500' }}>{t("Today's sales")}</Text>
      {change === null ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: '#ffffff1f' }}>
          <Ionicons name={change >= 0 ? 'trending-up' : 'trending-down'} size={14} color={change >= 0 ? '#8fe0b5' : '#ffb4ad'} />
          <Text style={{ color: change >= 0 ? '#8fe0b5' : '#ffb4ad', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{change >= 0 ? '+' : ''}{change}%</Text>
        </View>
      )}
    </View>
    <Text selectable adjustsFontSizeToFit numberOfLines={1} style={{ color: color.onNavy, fontSize: 40, fontFamily: display.bold, letterSpacing: -1, fontVariant: ['tabular-nums'] }}>{money(sales)}</Text>
    <View style={{ flexDirection: 'row', gap: 12, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#ffffff22' }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: color.onNavySoft, fontSize: 12 }}>{t('Bills today')}</Text>
        <Text style={{ color: color.onNavy, fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{bills}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: color.onNavySoft, fontSize: 12 }}>{t('Yesterday')}</Text>
        <Text style={{ color: color.onNavy, fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{money(yesterday)}</Text>
      </View>
    </View>
  </Pressable>
);

/* A quick action: a rounded square with an icon and one word under it. The main one is solid dark. */
const Quick = ({ icon, label, go, main = false }: { icon: IconName; label: string; go: () => void; main?: boolean }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={t(label)} onPress={go} style={({ pressed }) => ({ width: 78, alignItems: 'center', gap: 8, opacity: pressed ? 0.7 : 1 })}>
    <View style={{ width: 60, height: 60, borderRadius: 20, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: main ? color.action : color.card, borderWidth: main ? 0 : 1, borderColor: color.line, boxShadow: main ? undefined : shadow.card }}>
      <Ionicons name={icon} size={26} color={main ? color.onAction : color.ink} />
    </View>
    <Text numberOfLines={2} style={{ color: color.ink, fontSize: 12, fontWeight: '500', textAlign: 'center', lineHeight: 15 }}>{t(label)}</Text>
  </Pressable>
);

/* A smaller figure you can tap: it opens the page behind it. */
const Tile = ({ label, value, note, tone, icon, go }: { label: string; value: string; note?: string; tone?: string; icon: IconName; go?: () => void }) => (
  <Pressable accessibilityRole={go ? 'button' : 'text'} accessibilityLabel={`${t(label)}: ${value}${note ? `, ${t(note)}` : ''}`} onPress={go} disabled={!go}
    style={({ pressed }) => [s.card, { flex: 1, gap: 10 }, pressed && { backgroundColor: color.wash }]}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: color.soft, fontSize: 13, fontWeight: '500' }}>{t(label)}</Text>
      <Ionicons name={icon} size={18} color={tone ?? color.soft} />
    </View>
    <Text style={{ color: tone ?? color.ink, fontSize: 24, fontFamily: display.bold, letterSpacing: -0.4, fontVariant: ['tabular-nums'] }}>{value}</Text>
    {note ? <Text style={{ color: color.soft, fontSize: 12 }}>{t(note)}</Text> : null}
  </Pressable>
);

/* The last days' sales as bars: the tallest bar is the best day, today is the accent colour. */
const Bars = ({ days }: { days: { date: string; total: number }[] }) => {
  const heights = barHeights(days.map((d) => d.total));
  return (
    <View style={[s.card, { marginHorizontal: 16, gap: 10 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 6 }}>
        {days.map((d, i) => (
          <View key={d.date} accessibilityLabel={`${d.date}: ${money(d.total)}`} style={{ flex: 1, height: `${Math.max(heights[i] * 100, 3)}%`, backgroundColor: i === days.length - 1 ? color.brand : color.tintLine, borderRadius: 8, borderCurve: 'continuous' }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Soft>{days[0]?.date.slice(5)}</Soft><Soft>{t('Today')}</Soft>
      </View>
    </View>
  );
};

/* Rows grouped in one rounded card, with hairlines between them instead of a box around each. */
const Group = ({ children }: { children: React.ReactNode }) => (
  <View style={{ marginHorizontal: 16, borderRadius: radius.card, borderCurve: 'continuous', borderWidth: 1, borderColor: color.line, backgroundColor: color.card, overflow: 'hidden', boxShadow: shadow.card }}>{children}</View>
);
const Row = ({ title, sub, right, rightSub, tone, first, go }: { title: string; sub?: string; right?: string; rightSub?: string; tone?: string; first?: boolean; go?: () => void }) => (
  <Pressable accessibilityRole={go ? 'button' : 'text'} disabled={!go} onPress={go} android_ripple={go ? { color: color.press } : undefined}
    style={({ pressed }) => ({ minHeight: 60, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: first ? 0 : 1, borderTopColor: color.line, backgroundColor: pressed ? color.wash : color.card })}>
    <View style={{ flex: 1, gap: 2 }}>
      <Text numberOfLines={1} style={{ color: color.ink, fontSize: 15, fontWeight: '600' }}>{title}</Text>
      {sub ? <Text numberOfLines={1} style={{ color: color.soft, fontSize: 13 }}>{sub}</Text> : null}
    </View>
    <View style={{ alignItems: 'flex-end', gap: 2 }}>
      {right ? <Text style={{ color: color.ink, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{right}</Text> : null}
      {rightSub ? <Text style={{ color: tone ?? color.soft, fontSize: 12, fontWeight: '600' }}>{rightSub}</Text> : null}
    </View>
  </Pressable>
);

/* A mechanic garage has its own home: the vehicles in the garage and the day's money. Every other business keeps the sales home. */
export default function Home() {
  const business = currentBusiness(useSession());
  return business?.business_type === 'MECHANIC' ? <GarageHome /> : <ShopHome />;
}

function ShopHome() {
  const session = useSession();
  const business = currentBusiness(session);
  const outlet = business?.outlets.find((o) => o.branch_id === session.branchId);
  const { data, savedAt, error, busy, refresh } = useLoad<Dashboard>(`dash:${session.businessId}:${session.branchId}`, () => api.get<Dashboard>('/dashboard'));
  const learning = useLearning();
  const food = KITCHEN_TYPES.includes(business?.business_type ?? '');
  const pharmacy = business?.business_type === 'PHARMACY';
  const several = session.businesses.flatMap((b) => b.outlets).length > 1;
  const canBill = allowed(business, 'billing', 'sales_orders', 'fulfilment', 'field_sales', 'collections', 'appointments', 'dispensing', 'vehicles');
  // the few things this person does most, only the ones they are allowed to do
  const quick: { icon: IconName; label: string; go: () => void; main?: boolean }[] = [
    ...(canBill ? [{ icon: 'add' as IconName, label: 'New bill', go: () => router.push('/sell'), main: true }] : []),
    ...(canBill && !food ? [{ icon: 'scan-outline' as IconName, label: 'Scan', go: () => router.push('/scan') }] : []),
    ...(canBill ? [{ icon: 'receipt-outline' as IconName, label: 'Bills', go: () => router.navigate('/sales') }] : []),
    ...(food && canBill ? [{ icon: 'grid-outline' as IconName, label: business?.business_type === 'CLOUD_KITCHEN' ? 'Take an order' : 'Open a table', go: () => router.navigate('/tables') }] : []),
    ...(food && allowed(business, 'billing', 'kitchen') ? [{ icon: 'restaurant-outline' as IconName, label: 'Kitchen screen', go: () => router.push('/kitchen') }] : []),
    ...(allowed(business, 'customers', 'billing') ? [{ icon: 'people-outline' as IconName, label: 'Customers', go: () => router.push('/customers') }] : []),
    ...(allowed(business, 'reports') ? [{ icon: 'stats-chart-outline' as IconName, label: 'Reports', go: () => router.push('/reports') }] : [])
  ];
  // the first time, offer the one-minute tour by itself (it can be skipped, and is never shown again once seen or skipped)
  useEffect(() => { if (learning.ready && shouldOfferTour(learning.kept) && session.businessId != null) router.push('/welcome'); }, [learning.ready]);   // eslint-disable-line react-hooks/exhaustive-deps
  const m = data?.metrics ?? null;
  const change = m && m.yesterday_sales > 0 ? Math.round(((m.today_sales - m.yesterday_sales) / m.yesterday_sales) * 100) : null;

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Page max={900}>
        <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { void refresh(); }} />} contentContainerStyle={{ paddingBottom: 32, gap: 4 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar text={initials(business?.name)} dark />
            <View style={{ flex: 1, gap: 1 }}>
              <Text numberOfLines={1} style={{ color: color.soft, fontSize: 13 }}>{hour()}, {session.user?.name?.split(' ')[0]}</Text>
              <Text accessibilityRole="header" numberOfLines={1} style={{ color: color.ink, fontSize: 20, fontFamily: display.bold, letterSpacing: -0.3 }}>{business?.name}</Text>
              {several ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`${t('Switch outlet')}: ${outlet?.name}`} onPress={() => router.push('/choose')} style={{ minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' }}>
                  <Text style={{ color: color.brand, fontSize: 13, fontWeight: '600' }}>{outlet?.name}</Text><Ionicons name="chevron-down" size={15} color={color.brand} />
                </Pressable>
              ) : outlet?.name ? <Text numberOfLines={1} style={{ color: color.soft, fontSize: 13 }}>{outlet.name}</Text> : null}
            </View>
            <IconButton icon="notifications-outline" label="Notifications" go={() => router.push('/notifications')} />
            <Pressable accessibilityRole="button" accessibilityLabel={t('Settings')} onPress={() => router.push('/settings')} hitSlop={4}><Avatar text={initials(session.user?.name)} size={44} /></Pressable>
          </View>
          <View style={{ paddingHorizontal: 16 }}><SyncBadge /></View>
          <SavedNote at={savedAt} />
          {error && !data ? <Failed message={error} onRetry={() => { void refresh(); }} /> : null}

          {m ? <Hero sales={m.today_sales} change={change} bills={m.today_invoice_count} yesterday={m.yesterday_sales} go={() => router.navigate('/sales')} /> : null}

          {quick.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16, paddingVertical: 20 }} style={{ flexGrow: 0 }}>
              {quick.map((q) => <Quick key={q.label} {...q} />)}
            </ScrollView>
          ) : null}

          <GettingStarted food={food} />
          {m ? (
            <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16 }}>
              <Tile icon="hourglass-outline" label="Still to be paid" value={money(m.outstanding)} tone={m.outstanding > 0 ? color.warn : undefined} go={() => router.push('/customers')} />
              <Tile icon="alert-circle-outline" label="Low on stock" value={String(m.low_stock_count)} tone={m.low_stock_count > 0 ? color.danger : undefined} note={m.low_stock_count ? 'See what to order' : undefined} go={() => router.push('/stock')} />
            </View>
          ) : data ? <Empty>Today's figures are shown to people allowed to see reports.</Empty> : null}

          {data?.sales ? (
            <>
              <SectionTitle>{t('Last {n} days', { n: data.sales.trend.length })}</SectionTitle>
              <Bars days={data.sales.trend} />
              <SectionTitle>Latest bills</SectionTitle>
              {data.sales.recent_invoices.length ? (
                <Group>
                  {data.sales.recent_invoices.map((i, k) => {
                    const st = STATUS[i.payment_status];
                    return <Row key={i.invoice_id} first={k === 0} title={i.invoice_number} sub={`${i.customer_name ?? t('Walk-in')} · ${new Date(i.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`} right={money(i.total)} rightSub={st ? t(st.label) : i.payment_status} tone={st?.tone()} go={() => router.push({ pathname: '/receipt', params: { id: String(i.invoice_id) } })} />;
                  })}
                </Group>
              ) : <Empty>No bills yet.</Empty>}
              <SectionTitle>Best sellers this week</SectionTitle>
              {data.sales.top_products.length ? (
                <Group>
                  {data.sales.top_products.map((p, k) => <Row key={p.product_id} first={k === 0} title={p.name} sub={`${p.quantity} sold`} right={money(p.revenue)} />)}
                </Group>
              ) : <Empty>No sales yet this week.</Empty>}
            </>
          ) : null}
          {!data && busy ? <Loading what="Loading today's figures" /> : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
