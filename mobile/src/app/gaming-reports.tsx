import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { inr, windowFor, type Takings } from '../lib/gamingDesk.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, Failed, Line, Loading, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

type Row = { name?: string; station_name?: string; game_name?: string; total?: number; sessions?: number };

/* The lounge's takings: gaming time against food and drink, hours played, and which stations earn most. */
export default function GamingReports() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const [w, setW] = useState<'today' | 'week' | 'month'>('today');
  const { from, to } = windowFor(w);
  const sum = useLoad<Takings>(`gaming-sum:${scope}:${w}`, () => api.get<Takings>(`/gaming/reports/summary?from=${from}&to=${to}`));
  const st = useLoad<Row[]>(`gaming-st:${scope}:${w}`, () => api.get<Row[] | { rows: Row[] }>(`/gaming/reports/stations?from=${from}&to=${to}`).then((r) => (Array.isArray(r) ? r : r.rows ?? [])));
  const d = sum.data;
  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Lounge takings</Title><Soft>What the lounge earned</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={{ paddingHorizontal: 16 }}><Chips items={[{ id: 'today', label: 'Today' }, { id: 'week', label: 'Last 7 days' }, { id: 'month', label: 'Last 30 days' }]} value={w} onChange={setW} /></View>
          {sum.busy && !d ? <Loading /> : null}
          {sum.error && !d ? <Failed message={sum.error} onRetry={() => { void sum.refresh(); }} /> : null}
          {d ? (
            <>
              <View style={{ flexDirection: 'row', gap: 8, padding: 16 }}>
                <Stat label="Total" value={inr(d.total)} tone={color.brand} />
                <Stat label="Gaming time" value={inr(d.gaming)} />
                <Stat label="Food and drink" value={inr(d.fnb)} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
                <Stat label="Sessions" value={String(d.sessions)} note={t('{n} players', { n: d.players })} />
                <Stat label="Hours played" value={String(d.hours_played)} note={t('{n} min average', { n: d.average_session_minutes })} />
                <Stat label="Bills" value={String(d.bills)} note={`${t('Average')} ${inr(d.average_bill)}`} />
              </View>
            </>
          ) : null}
          {(st.data ?? []).length ? <SectionTitle>By station</SectionTitle> : null}
          {(st.data ?? []).map((r, i) => <Line key={i} left={r.name ?? r.station_name ?? ''} sub={r.sessions != null ? t('{n} sessions', { n: r.sessions }) : undefined} right={inr(r.total ?? 0)} />)}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
