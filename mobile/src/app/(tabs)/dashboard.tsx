import { useCallback, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../../lib/session.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { rupees } from '../../lib/money.ts';
import { dmy, n, scaleBars, waNumber, type GymHome } from '../../lib/gymApp.ts';
import { Page } from '../../lib/responsive.tsx';
import { t } from '../../lib/i18n.ts';
import { Chips, Empty, Failed, Line, Group, Loading, SectionTitle, Soft, Stat, Title, color, s } from '../../lib/ui.tsx';

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

          {x && tab === 'payments' ? (m ? <>
            <SectionTitle>Collection</SectionTitle>
            <Row>
              <Stat label="Collected today" value={rupees(n(m.received_today_paise))} tone={color.ok} />
              <Stat label="Collected this month" value={rupees(n(m.received_month_paise))} tone={color.ok} />
              <Stat label="Dues pending" value={rupees(n(m.owed_paise))} note={t('{n} bills', { n: m.owed_bills })} tone={m.owed_paise ? color.danger : undefined} />
            </Row>
            <SectionTitle>Billed this month</SectionTitle>
            <Row>
              <Stat label="Memberships" value={rupees(n(m.billed_month.membership_paise))} />
              <Stat label="Personal training" value={rupees(n(m.billed_month.training_paise))} />
              <Stat label="Shop and supplements" value={rupees(n(m.billed_month.shop_paise))} />
            </Row>
            <Group><Line left="See who owes money" icon="alert-circle-outline" onPress={() => router.push('/gym-members')} /></Group>
          </> : <Empty>You do not have access to the money figures.</Empty>) : null}

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
