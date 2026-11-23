import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../../lib/session.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { rupees } from '../../lib/money.ts';
import { monthLabel, n, scaleBars, type Trends } from '../../lib/gymApp.ts';
import { Page } from '../../lib/responsive.tsx';
import { Chips, Empty, Failed, Loading, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

type Span = '3' | '6' | '12';
type View_ = 'graph' | 'table';
const SPANS = [{ id: '3' as Span, label: 'Quarter' }, { id: '6' as Span, label: 'Six months' }, { id: '12' as Span, label: 'Yearly' }];
const VIEWS = [{ id: 'graph' as View_, label: 'Graph' }, { id: 'table' as View_, label: 'Table' }];

const Bars = ({ title, labels, values, show }: { title: string; labels: string[]; values: number[]; show: (v: number) => string }) => {
  const h = scaleBars(values);
  return (
    <View style={[s.card, { marginHorizontal: 16, gap: 8 }]}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: color.ink }}>{title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 4 }}>
        {values.map((v, i) => (
          <View key={labels[i]} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 3 }}>
            <Text numberOfLines={1} style={{ fontSize: 10, color: color.soft }}>{v ? show(v) : ''}</Text>
            <View style={{ width: '70%', height: Math.max(3, h[i]! * 90), borderRadius: 5, backgroundColor: color.action }} />
            <Text style={{ fontSize: 10, color: color.soft }}>{labels[i]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

/* Reports: the money collected and the members who joined, month by month, as a graph or a table. */
export default function GymReports() {
  const session = useSession();
  const [span, setSpan] = useState<Span>('6');
  const [view, setView] = useState<View_>('graph');
  const tr = useLoad<Trends>(`gym-trends:${session.businessId}:${session.branchId}:${span}`, () => api.get<Trends>(`/gym/reports/trends?months=${span}`));
  const rows = tr.data?.months ?? [];
  const labels = rows.map((r) => monthLabel(r.month));
  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16 }}><Title>Reports</Title><Soft>How the gym is growing</Soft></View>
        <Chips items={SPANS} value={span} onChange={setSpan} />
        <Chips items={VIEWS} value={view} onChange={setView} />
        <ScrollView contentContainerStyle={{ paddingBottom: 60, gap: 12 }} refreshControl={<RefreshControl refreshing={tr.busy && !!tr.data} onRefresh={() => { void tr.refresh(); }} />}>
          {tr.busy && !tr.data ? <Loading /> : null}
          {tr.error && !tr.data ? <Failed message={tr.error} onRetry={() => { void tr.refresh(); }} /> : null}
          {tr.data && rows.length === 0 ? <Empty>Nothing to show yet.</Empty> : null}
          {rows.length && view === 'graph' ? <>
            <Bars title="Money collected" labels={labels} values={rows.map((r) => n(r.collected_paise))} show={(v) => rupees(v).replace(/\.\d+$/, '')} />
            <Bars title="New members" labels={labels} values={rows.map((r) => n(r.new_members))} show={String} />
            <Bars title="Memberships sold" labels={labels} values={rows.map((r) => n(r.memberships_started))} show={String} />
          </> : null}
          {rows.length && view === 'table' ? <>
            <SectionTitle>Month by month</SectionTitle>
            <View style={[s.card, { marginHorizontal: 16, gap: 10 }]}>
              <View style={{ flexDirection: 'row' }}>{['Month', 'Collected', 'Joined', 'Sold'].map((h, i) => <Text key={h} style={{ flex: i === 1 ? 2 : 1, fontWeight: '700', color: color.soft, fontSize: 12, textAlign: i ? 'right' : 'left' }}>{h}</Text>)}</View>
              {[...rows].reverse().map((r) => (
                <View key={r.month} style={{ flexDirection: 'row' }}>
                  <Text style={{ flex: 1, color: color.ink }}>{monthLabel(r.month)}</Text>
                  <Text style={{ flex: 2, textAlign: 'right', color: color.ink, fontVariant: ['tabular-nums'] }}>{rupees(n(r.collected_paise))}</Text>
                  <Text style={{ flex: 1, textAlign: 'right', color: color.ink }}>{r.new_members}</Text>
                  <Text style={{ flex: 1, textAlign: 'right', color: color.ink }}>{r.memberships_started}</Text>
                </View>
              ))}
            </View>
          </> : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
