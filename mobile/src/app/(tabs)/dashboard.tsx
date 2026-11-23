import { useCallback, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../../lib/session.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { rupees } from '../../lib/money.ts';
import { dmy, n, parseDmy, scaleBars, waNumber, type GymHome } from '../../lib/gymApp.ts';
import { Page } from '../../lib/responsive.tsx';
import { t } from '../../lib/i18n.ts';
import { Chips, Empty, Failed, Line, Group, Loading, SectionTitle, Soft, Stat, Title, color, s } from '../../lib/ui.tsx';

type Period = 'month' | 'last' | 'three' | 'custom';
const PERIODS = [{ id: 'month' as Period, label: 'This Month' }, { id: 'last' as Period, label: 'Last Month' }, { id: 'three' as Period, label: 'Last 3 Months' }, { id: 'custom' as Period, label: 'Custom' }];
type Collection = { from: string; to: string; collected_paise: number; owed_paise: number; expense_paise: number; collected_by: Record<string, number>; owed_by: Record<string, number> };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The first and last day of a period, counted from today on this phone. */
const rangeOf = (p: Exclude<Period, 'custom'>, now = new Date()): [string, string] => {
  const y = now.getFullYear(); const m = now.getMonth();
  if (p === 'month') return [iso(new Date(y, m, 1)), iso(now)];
  if (p === 'last') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
  return [iso(new Date(y, m - 2, 1)), iso(now)];
};
type Tab = 'membership' | 'payments' | 'attendance';
const TABS = [{ id: 'membership' as Tab, label: 'Membership' }, { id: 'payments' as Tab, label: 'Payments' }, { id: 'attendance' as Tab, label: 'Attendance' }];
const Row = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 }}>{children}</View>;
const open = (id: number) => router.push({ pathname: '/gym-member/[id]', params: { id: String(id) } });

/* The gym's dashboard, in three parts as the owner thinks of it: who is coming and going (membership), the money, and the attendance. */
export default function Dashboard() {
  const session = useSession();
  const [tab, setTab] = useState<Tab>('membership');
  const d = useLoad<GymHome>(`gym-home:${session.businessId}:${session.branchId}`, () => api.get<GymHome>('/gym/dashboard'));
  useFocusEffect(useCallback(() => { void d.refresh(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  const [period, setPeriod] = useState<Period>('month');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const range: [string, string] | null = period === 'custom' ? (parseDmy(cFrom) && parseDmy(cTo) && parseDmy(cFrom) <= parseDmy(cTo) ? [parseDmy(cFrom), parseDmy(cTo)] : null) : rangeOf(period);
  const col = useLoad<Collection>(`gym-collection:${session.businessId}:${session.branchId}:${range?.join('..')}`, () => api.get<Collection>(`/gym/reports/collection?from=${range![0]}&to=${range![1]}`), tab === 'payments' && range !== null);
  const x = d.data;
  const r = x?.renewals;
  const m = x?.money;
  const bars = scaleBars((x?.last_7_days ?? []).map((v) => v.visits));

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16 }}><Title>Dashboard</Title><Soft>{dmy(x?.today)}</Soft></View>
        <Chips items={TABS} value={tab} onChange={setTab} />
        <ScrollView contentContainerStyle={{ paddingBottom: 60, gap: 8 }} refreshControl={<RefreshControl refreshing={d.busy && !!d.data} onRefresh={() => { void d.refresh(); }} />}>
          {d.busy && !x ? <Loading /> : null}
          {d.error && !x ? <Failed message={d.error} onRetry={() => { void d.refresh(); }} /> : null}

          {x && tab === 'membership' ? <>
            <SectionTitle>Today</SectionTitle>
            <Row>
              <Stat label="Check-ins today" value={String(x.visits.today)} note={t('{n} in the gym now', { n: x.visits.open_now })} />
              <Stat label="Memberships ending today" value={String(r?.today ?? 0)} tone={r?.today ? color.danger : undefined} />
              <Stat label="Birthdays today" value={String(x.birthdays?.length ?? 0)} />
              <Stat label="Joined this month" value={String(x.joined_this_month)} />
            </Row>
            <SectionTitle>Memberships ending soon</SectionTitle>
            <Row>
              <Stat label="In 1 to 3 days" value={String(r?.d3 ?? 0)} tone={r?.d3 ? color.warn : undefined} />
              <Stat label="In 4 to 7 days" value={String(r?.d4_7 ?? 0)} />
              <Stat label="In 8 to 15 days" value={String(r?.d8_15 ?? 0)} />
            </Row>
            <SectionTitle>Members</SectionTitle>
            <Row>
              <Stat label="Active" value={String(n(x.members.ACTIVE))} tone={color.ok} />
              <Stat label="Ends soon" value={String(n(x.members.EXPIRING))} tone={color.warn} />
              <Stat label="Ended" value={String(n(x.members.EXPIRED))} />
              <Stat label="Frozen" value={String(n(x.members.FROZEN))} />
            </Row>
            {x.birthdays?.length ? <><SectionTitle>Birthdays today</SectionTitle><Group>{x.birthdays.map((b) => <Line key={b.member_id} left={b.name} sub={b.member_code} right={b.phone ? t('Wish') : ''} onPress={b.phone ? () => { void Linking.openURL(`https://wa.me/${waNumber(b.phone as string)}?text=${encodeURIComponent(`Happy birthday ${b.name}!`)}`); } : () => open(b.member_id)} />)}</Group></> : null}
            {r?.list.length ? <><SectionTitle>Renewals to chase</SectionTitle><Group>{r.list.slice(0, 10).map((c) => <Line key={c.member_id} left={c.name} sub={`${c.plan_name} · ${dmy(c.ends_on)}`} right={c.days_left === 0 ? t('Today') : t('{n} days', { n: c.days_left })} onPress={() => open(c.member_id)} />)}</Group></> : null}
          </> : null}

          {tab === 'payments' ? <>
            {m ? <>
              <SectionTitle>Today</SectionTitle>
              <Row><Stat label="Collected today" value={rupees(n(m.received_today_paise))} tone={color.ok} /><Stat label="Dues pending (all time)" value={rupees(n(m.owed_paise))} note={t('{n} bills', { n: m.owed_bills })} tone={m.owed_paise ? color.danger : undefined} /></Row>
            </> : null}
            <SectionTitle>Period</SectionTitle>
            <Chips items={PERIODS} value={period} onChange={setPeriod} />
            {period === 'custom' ? (
              <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16 }}>
                <TextInput style={[s.input, { flex: 1 }]} value={cFrom} onChangeText={setCFrom} placeholder="DD/MM/YYYY" maxLength={10} keyboardType="numbers-and-punctuation" accessibilityLabel={t('From')} />
                <TextInput style={[s.input, { flex: 1 }]} value={cTo} onChangeText={setCTo} placeholder="DD/MM/YYYY" maxLength={10} keyboardType="numbers-and-punctuation" accessibilityLabel={t('To')} />
              </View>
            ) : null}
            {range === null ? <Empty>Type both dates, like 01/11/2026.</Empty> : null}
            {range ? <Soft style={{ paddingHorizontal: 16 }}>{`${dmy(range[0])} – ${dmy(range[1])}`}</Soft> : null}
            {col.busy && !col.data && range ? <Loading /> : null}
            {col.error && !col.data ? <Failed message={col.error} onRetry={() => { void col.refresh(); }} /> : null}
            {col.data && range ? <>
              <SectionTitle>Collected</SectionTitle>
              <Row>
                <Stat label="Total collected" value={rupees(n(col.data.collected_paise))} tone={color.ok} />
                <Stat label="Memberships" value={rupees(n(col.data.collected_by.membership_paise))} />
                <Stat label="Personal training" value={rupees(n(col.data.collected_by.training_paise))} />
                <Stat label="Shop and supplements" value={rupees(n(col.data.collected_by.shop_paise))} />
              </Row>
              <SectionTitle>Still to collect</SectionTitle>
              <Row>
                <Stat label="Membership due" value={rupees(n(col.data.owed_by.membership_paise))} tone={col.data.owed_by.membership_paise ? color.danger : undefined} />
                <Stat label="Personal training due" value={rupees(n(col.data.owed_by.training_paise))} tone={col.data.owed_by.training_paise ? color.danger : undefined} />
                <Stat label="Shop due" value={rupees(n(col.data.owed_by.shop_paise))} />
              </Row>
              <SectionTitle>Spent</SectionTitle>
              <Row><Stat label="Expenses" value={rupees(n(col.data.expense_paise))} /><Stat label="Collected less expenses" value={rupees(n(col.data.collected_paise) - n(col.data.expense_paise))} tone={n(col.data.collected_paise) - n(col.data.expense_paise) < 0 ? color.danger : color.ok} /></Row>
            </> : null}
            <Group><Line left="See who owes money" icon="alert-circle-outline" onPress={() => router.push('/gym-members')} /></Group>
          </> : null}

          {x && tab === 'attendance' ? <>
            <SectionTitle>Last 7 days</SectionTitle>
            <View style={[s.card, { marginHorizontal: 16, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 150, gap: 6 }]}>
              {x.last_7_days.map((v, i) => (
                <View key={v.date} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4, height: '100%' }}>
                  <Text style={{ fontSize: 11, color: color.soft }}>{v.visits}</Text>
                  <View style={{ width: '70%', height: Math.max(4, bars[i]! * 90), borderRadius: 6, backgroundColor: color.action }} />
                  <Text style={{ fontSize: 11, color: color.soft }}>{v.date.slice(8)}</Text>
                </View>
              ))}
            </View>
            <Row>
              <Stat label="Check-ins today" value={String(x.visits.today)} />
              <Stat label="Different members" value={String(x.visits.today_unique)} />
              <Stat label="In the gym now" value={String(x.visits.open_now)} />
            </Row>
            <Group>
              <Line left="Attendance calendar" sub="Each day's count, and add a missed visit" icon="calendar-outline" onPress={() => router.push('/gym-calendar')} />
              <Line left="Who came today" icon="time-outline" onPress={() => router.push('/gym-attendance')} />
              <Line left="Front desk: scan a pass" icon="qr-code-outline" onPress={() => router.push('/gym')} />
            </Group>
          </> : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
