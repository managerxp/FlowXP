import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { formatDate } from '../lib/display.ts';
import { Page } from '../lib/responsive.tsx';
import { BOOKS, checkLine, financialYear, hasBooks, money, overdueOf, todayISO, type Ageing, type BookInvoice, type BooksMe, type InvoiceList, type Pnl, type Reconcile } from '../lib/flowbook.ts';
import { Button, Empty, Failed, Line, Loading, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

type Books = { name: string; owed: Ageing | null; payable: Ageing | null; pnl: Pnl | null; check: Reconcile | null; recent: BookInvoice[] };

/* Each figure loads on its own, so one this person may not see (their role) does not blank the page. */
const settle = <T,>(p: Promise<T>): Promise<T | null> => p.then((v) => v, () => null);

/* FlowBook on the phone: the books at a glance. Invoices, payments and GST returns are made on the website. */
export default function FlowBookScreen() {
  const me = currentBusiness(useSession());
  const open = hasBooks(me);
  const [data, setData] = useState<Books | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    void (async () => {
      try {
        const org = (await api.get<BooksMe>(`${BOOKS}/me`)).organizations[0];
        if (!org) { setError(t('FlowBook is not switched on for this business.')); return; }
        const base = `${BOOKS}/orgs/${org.id}`; const today = todayISO(); const fy = financialYear(today);
        const [owed, payable, pnl, check, recent] = await Promise.all([
          settle(api.get<Ageing>(`${base}/reports/ageing?type=receivables&asOf=${today}`)), settle(api.get<Ageing>(`${base}/reports/ageing?type=payables&asOf=${today}`)),
          settle(api.get<Pnl>(`${base}/reports/profit-and-loss?from=${fy.from}&to=${fy.to}`)), settle(api.get<Reconcile>(`${base}/reports/reconcile`)), settle(api.get<InvoiceList>(`${base}/invoices?limit=6`))
        ]);
        setData({ name: org.name, owed, payable, pnl, check, recent: recent?.documents ?? [] });
      } catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); }
    })();
  }, []);
  useEffect(() => { setData(null); if (open) load(); }, [load, open]);
  const fy = financialYear(todayISO());
  const overdue = data?.owed ? overdueOf(data.owed) : 0;
  const problems = data ? checkLine(data.check) : '';

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>FlowBook</Title><Soft>Your accounts at a glance. Make invoices and file GST on the website.</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {!open ? <Empty>FlowBook is not switched on for this business.</Empty> : error ? <Failed message={error} onRetry={load} /> : !data ? <Loading /> : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <Soft style={{ paddingHorizontal: 16 }}>{`${data.name} · ${fy.label}`}</Soft>
            <View style={{ padding: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <Stat label="Customers owe you" value={data.owed ? money(data.owed.total) : '–'} />
              <Stat label="of which overdue" value={data.owed ? money(overdue) : '–'} tone={overdue ? color.danger : undefined} />
              <Stat label="You owe vendors" value={data.payable ? money(data.payable.total) : '–'} />
              <Stat label="Profit this year" value={data.pnl ? money(data.pnl.netProfit) : '–'} tone={data.pnl && Number(data.pnl.netProfit) < 0 ? color.danger : color.ok} />
            </View>
            {data.check ? (problems
              ? <Text accessibilityRole="alert" style={{ paddingHorizontal: 16, color: color.danger }}>{`${t('Your books need a look:')} ${problems}`}</Text>
              : <Text style={{ paddingHorizontal: 16, color: color.ok }}>{t('Books check: every figure agrees with its documents.')}</Text>) : null}
            <SectionTitle>Latest invoices</SectionTitle>
            {data.recent.length === 0 ? <Empty>No invoices yet. Create your first one on the website.</Empty> : data.recent.map((d) => (
              <Line key={d.id} left={d.party_name || '–'} sub={`${d.number || t('Draft')} · ${formatDate(d.issue_date)}`} right={money(d.total_minor)} />
            ))}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
