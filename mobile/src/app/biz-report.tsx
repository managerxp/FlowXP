import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { ranges } from '../lib/ranges.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { defOf, statementView, type View as ReportView } from '../lib/bizReports.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import AskReports from '../lib/AskReports.tsx';
import { aboutReport } from '../lib/askReports.ts';
import { Button, Chips, Empty, Failed, Line, Loading, SavedNote, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

const money = (r: number) => rupees(toPaise(r));

/* One business report (lib/bizReports.ts) for a period, or a party's statement: a few figures, then the lists. Read only. */
export default function BizReport() {
  const session = useSession();
  const p = useLocalSearchParams<{ id: string; kind?: string; party?: string; name?: string }>();
  const statement = p.id === 'statement';
  const def = statement ? null : defOf(String(p.id));
  const dated = statement || Boolean(def?.dated);
  const [rangeId, setRangeId] = useState(statement ? '30d' : 'today');
  const range = ranges().find((r) => r.id === rangeId)!;
  const path = statement ? `/reports/party-statement?kind=${p.kind === 'supplier' ? 'supplier' : 'customer'}&id=${p.party}&from=${range.from}&to=${range.to}` : def ? def.path(range) : '';
  const load = useLoad<unknown>(`bizreport:${session.businessId}:${session.branchId}:${path}`, () => api.get<unknown>(path), Boolean(path));
  const view: ReportView | null = load.data ? (statement ? statementView(load.data, money) : def!.build(load.data, money)) : null;
  const title = statement ? (p.name || t('Statement')) : def?.title ?? 'Report';

  return (
    <SafeAreaView style={s.screen}>
      <Page max={900}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Title>{statement ? title : t(title)}</Title>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {!statement && def ? <Soft style={{ paddingHorizontal: 16, paddingBottom: 8 }}>{def.text}</Soft> : null}
        {dated ? <Chips items={ranges().map((x) => ({ id: x.id, label: x.label }))} value={rangeId as never} onChange={(id) => setRangeId(id)} /> : null}
        <SavedNote at={load.savedAt} />
        {!path ? <Empty>This report was not found.</Empty> : null}
        {load.error && !view ? <Failed message={load.error} onRetry={() => { void load.refresh(); }} /> : null}
        {load.busy && !view ? <Loading /> : null}
        {view ? (
          <ScrollView refreshControl={<RefreshControl refreshing={load.busy} onRefresh={() => { void load.refresh(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
            {!statement ? <AskReports suggested={dated ? aboutReport(t('Explain my {report} report from {from} to {to}.'), t(title), range.from, range.to) : aboutReport(t('Explain my {report} report.'), t(title))} /> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
              {view.stats.map((x) => <Stat key={x.label} label={x.label} value={x.value} note={x.note} tone={x.bad ? color.danger : undefined} />)}
            </View>
            {view.note ? <Soft style={{ paddingHorizontal: 16 }}>{t(view.note)}</Soft> : null}
            {view.sections.map((sec, i) => (
              <View key={i}>
                {sec.title ? <SectionTitle>{sec.title}</SectionTitle> : null}
                {sec.rows.length ? sec.rows.map((r, j) => (
                  <Line key={j} left={r.left} right={r.right} sub={r.sub}
                    onPress={r.open ? () => router.push({ pathname: '/biz-report', params: { id: r.open!.id, ...r.open!.params } }) : undefined} />
                )) : sec.empty ? <Empty>{sec.empty}</Empty> : null}
              </View>
            ))}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
