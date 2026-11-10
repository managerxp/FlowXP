import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { cell, groupReports, periodFor, reportPath, type ReportDef, type ReportOut } from '../lib/shopExtras.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, Empty, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

type Period = 'today' | 'month' | 'last30';

/* The wholesale reports: pick one from the list, choose the period, read it. Each row is a card; the first column is its title. */
export default function WholesaleReports() {
  const session = useSession();
  const k = `${session.businessId}:${session.branchId}`;
  const cat = useLoad<ReportDef[]>(`wr-cat:${k}`, () => api.get<ReportDef[]>('/wholesale/reports'));
  const [def, setDef] = useState<ReportDef | null>(null);
  const [period, setPeriod] = useState<Period>('month');
  const p = periodFor(period);
  const rep = useLoad<ReportOut>(`wr:${k}:${def?.key}:${p.from}:${p.to}`, () => api.get<ReportOut>(reportPath(def as ReportDef, p)), Boolean(def));
  const r = rep.data;

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{def ? def.label : 'Wholesale reports'}</Title><Soft>{def ? def.description : 'Sales, buying, stock and money'}</Soft></View>
          <Button title={def ? 'All reports' : 'Back'} kind="quiet" onPress={() => (def ? setDef(null) : goBack())} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {!def ? (
            <>
              {cat.busy && !cat.data ? <Loading /> : null}
              {cat.error && !cat.data ? <Failed message={cat.error} onRetry={() => { void cat.refresh(); }} /> : null}
              {groupReports(cat.data ?? []).map((g) => (
                <View key={g.name}>
                  <SectionTitle>{g.name}</SectionTitle>
                  {g.items.map((d) => <Line key={d.key} left={d.label} sub={d.description} onPress={() => setDef(d)} />)}
                </View>
              ))}
            </>
          ) : (
            <>
              {def.period ? <View style={{ paddingHorizontal: 16 }}><Chips items={[{ id: 'today', label: 'Today' }, { id: 'month', label: 'This month' }, { id: 'last30', label: 'Last 30 days' }]} value={period} onChange={(v) => setPeriod(v as Period)} /></View> : null}
              {rep.busy && !r ? <Loading /> : null}
              {rep.error && !r ? <Failed message={rep.error} onRetry={() => { void rep.refresh(); }} /> : null}
              {r && r.rows.length === 0 ? <Empty>There is nothing to show for this.</Empty> : null}
              {r?.rows.map((row, i) => (
                <View key={i} style={[s.card, { marginHorizontal: 16, marginTop: 10, gap: 2 }]}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: color.ink }}>{cell(r.columns[0].type, row[r.columns[0].key])}</Text>
                  {r.columns.slice(1).map((c) => (cell(c.type, row[c.key]) ? <View key={c.key} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text style={{ color: color.soft, flex: 1 }}>{c.label}</Text><Text style={{ color: color.ink, fontWeight: '600' }}>{cell(c.type, row[c.key])}</Text></View> : null))}
                </View>
              ))}
              {r?.totals ? (
                <View style={[s.card, { marginHorizontal: 16, marginTop: 10, gap: 2, borderWidth: 2, borderColor: color.brand }]}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: color.ink }}>{t('Total')}</Text>
                  {r.columns.slice(1).map((c) => (r.totals && cell(c.type, r.totals[c.key]) ? <View key={c.key} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text style={{ color: color.soft, flex: 1 }}>{c.label}</Text><Text style={{ color: color.ink, fontWeight: '700' }}>{cell(c.type, r.totals[c.key])}</Text></View> : null))}
                </View>
              ) : null}
              {r?.note ? <Soft style={{ padding: 16 }}>{r.note}</Soft> : null}
            </>
          )}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
