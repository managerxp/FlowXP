import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { rowsOf, timeOf, todayISO, type DayVisit } from '../lib/gymMembers.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Empty, Failed, Line, Loading, SectionTitle, Soft, Title, s } from '../lib/ui.tsx';

/* Who came today: still inside first, then those who have left. */
export default function GymAttendance() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const today = todayISO();
  const v = useLoad<DayVisit[]>(`gym-visits:${scope}:${today}`, () => api.get<DayVisit[] | { rows: DayVisit[] }>(`/gym/attendance?from=${today}&to=${today}&limit=200`).then(rowsOf));
  const inside = (v.data ?? []).filter((x) => !x.check_out_at);
  const gone = (v.data ?? []).filter((x) => x.check_out_at);
  const open = (x: DayVisit) => router.push({ pathname: '/gym-member/[id]', params: { id: String(x.member_id) } });
  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Who came today</Title><Soft>{t('{n} visits so far', { n: v.data?.length ?? 0 })}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {v.busy && !v.data ? <Loading /> : null}
          {v.error && !v.data ? <Failed message={v.error} onRetry={() => { void v.refresh(); }} /> : null}
          {v.data && v.data.length === 0 ? <Empty>Nobody has come yet today.</Empty> : null}
          {inside.length ? <><SectionTitle>In the gym now</SectionTitle>{inside.map((x) => <Line key={x.attendance_id} left={x.member_name} sub={x.member_code} right={t('in {time}', { time: timeOf(x.check_in_at) })} onPress={() => open(x)} />)}</> : null}
          {gone.length ? <><SectionTitle>Already left</SectionTitle>{gone.map((x) => <Line key={x.attendance_id} left={x.member_name} sub={x.member_code} right={`${timeOf(x.check_in_at)} – ${timeOf(x.check_out_at as string)}`} onPress={() => open(x)} />)}</> : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
