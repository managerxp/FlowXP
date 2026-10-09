import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { ranges } from '../lib/ranges.ts';
import { cellText, rowLines, type ReportResult, type SalonDash } from '../lib/salon.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, Failed, Line, Loading, SavedNote, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

const money = (n: number | null) => (n == null ? '-' : rupees(toPaise(n)));

/* The salon's day at a glance, and its reports (sales, clients, team, stock, money) for a day or a few weeks. */
export default function SalonReports() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const [report, setReport] = useState<{ key: string; title: string } | null>(null);
  const [rangeId, setRangeId] = useState('30d');
  const range = ranges().find((r) => r.id === rangeId)!;
  const dash = useLoad<SalonDash>(`salon-dash:${scope}`, () => api.get<SalonDash>('/salon/dashboard'), !report);
  const catalog = useLoad<Record<string, { key: string; title: string; advanced: boolean }[]>>(`salon-reports:${scope}`, () => api.get('/salon/reports'), !report);
  const run = useLoad<ReportResult>(`salon-report:${scope}:${report?.key}:${range.from}:${range.to}`, () => api.get<ReportResult>(`/salon/reports/${report!.key}?from=${range.from}&to=${range.to}`), Boolean(report));
  const o = dash.data?.overview;

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{report ? report.title : 'Salon reports'}</Title><Soft>{report ? `${range.from} to ${range.to}` : 'Today, and every report'}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => (report ? setReport(null) : goBack())} />
        </View>

        {!report ? (
          <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
            <SavedNote at={dash.savedAt} />
            {dash.error && !dash.data ? <Failed message={dash.error} onRetry={() => { void dash.refresh(); }} /> : null}
            {dash.busy && !dash.data ? <Loading /> : null}
            {o ? (
              <>
                <SectionTitle>Today</SectionTitle>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
                  {o.sales_today != null ? <Stat label="Sales" value={money(o.sales_today)} note={`${o.invoices_today} bills`} /> : null}
                  <Stat label="Appointments" value={String(o.appointments_today)} note={`${o.appointments_completed} done · ${o.appointments_upcoming} to come`} />
                  <Stat label="Clients" value={String(o.new_customers + o.returning_customers)} note={`${o.new_customers} new · ${o.returning_customers} returning`} />
                  <Stat label="Team in" value={`${o.active_staff} of ${o.staff_total}`} />
                  {o.outstanding ? <Stat label="Still owed" value={money(o.outstanding)} note={`${o.outstanding_bills} bills`} tone={color.warn} /> : null}
                  {o.low_stock ? <Stat label="Low stock" value={String(o.low_stock)} tone={color.warn} /> : null}
                </View>
                {dash.data?.revenue ? (
                  <>
                    <SectionTitle>This month</SectionTitle>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
                      <Stat label="Services" value={money(dash.data.revenue.month_by_type.services)} />
                      <Stat label="Products" value={money(dash.data.revenue.month_by_type.products)} />
                      <Stat label="Packages and memberships" value={money(dash.data.revenue.month_by_type.packages + dash.data.revenue.month_by_type.memberships)} />
                    </View>
                  </>
                ) : null}
              </>
            ) : null}
            {Object.entries(catalog.data ?? {}).map(([group, list]) => (
              <View key={group}>
                <SectionTitle>{group}</SectionTitle>
                {list.map((r) => <Line key={r.key} left={r.title} onPress={() => setReport({ key: r.key, title: r.title })} />)}
              </View>
            ))}
          </ScrollView>
        ) : (
          <>
            <Chips items={ranges().map((r) => ({ id: r.id, label: r.label }))} value={rangeId as never} onChange={(id) => setRangeId(id)} />
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
              <SavedNote at={run.savedAt} />
              {run.error && !run.data ? <Failed message={run.error} onRetry={() => { void run.refresh(); }} /> : null}
              {run.busy && !run.data ? <Loading /> : null}
              {run.data?.note ? <Soft style={{ padding: 16 }}>{run.data.note}</Soft> : null}
              {run.data && run.data.rows.length === 0 ? <Empty>Nothing in this time.</Empty> : null}
              {run.data && run.data.totals && run.data.rows.length ? (
                <View style={{ padding: 16, gap: 2 }}>
                  <Text style={{ fontWeight: '700', color: color.ink }}>Total</Text>
                  {run.data.columns.filter((c) => run.data!.totals![c.key] != null).map((c) => <Soft key={c.key}>{`${c.label}: ${cellText(run.data!.totals![c.key], c.type)}`}</Soft>)}
                </View>
              ) : null}
              {(run.data?.rows ?? []).map((r, i) => {
                const x = rowLines(r, run.data!.columns);
                return (
                  <View key={i} style={{ padding: 16, gap: 2, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>{x.title}</Text>
                    {x.lines.map((l) => <Soft key={l}>{l}</Soft>)}
                  </View>
                );
              })}
            </ScrollView>
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
