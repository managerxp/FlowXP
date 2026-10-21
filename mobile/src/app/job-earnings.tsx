import { useState } from 'react';
import { Text } from 'react-native';
import { currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { Card, Panel, SetupShell, useList } from '../lib/formKit.tsx';
import { canJobCards } from '../lib/jobCards.ts';
import { dayLine, earningStats, mechanicLine, monthStart, workshopOn, type Earnings } from '../lib/workshopExtras.ts';
import { rupees } from '../lib/money.ts';
import { Chips, Failed, Line, Loading, SectionTitle, Soft, color } from '../lib/ui.tsx';

const localDay = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* What the workshop earned on the bills made from job cards: labour and parts, by day and by mechanic. These bills are ordinary bills, so they are in the shop's sales too. */
export default function JobEarningsScreen() {
  const me = currentBusiness(useSession());
  const [span, setSpan] = useState<'today' | 'month'>('month');
  const today = localDay();
  const r = useList<Earnings>(`/autoparts/jobcards/report?from=${span === 'today' ? today : monthStart(today)}&to=${today}`);
  const d = r.data;
  const body = !d ? (r.error ? <Failed message={r.error} onRetry={r.reload} /> : <Loading />) : (
    <Panel>
      <Soft>{t('Labour and parts on the bills made from job cards. These bills are also in your sales.')}</Soft>
      <Chips items={[{ id: 'today', label: t('Today') }, { id: 'month', label: t('This month') }]} value={span} onChange={setSpan} />
      <Card>{earningStats(d).map(([k, v]) => <Text key={k} style={{ color: color.ink }}>{`${k}: ${v}`}</Text>)}</Card>
      {d.days.length === 0 ? <Soft>{t('No job card was billed in these dates.')}</Soft> : <SectionTitle>Day by day</SectionTitle>}
      {d.days.map((x) => <Line key={x.day} left={x.day} right={rupees(x.total_paise)} sub={dayLine(x)} />)}
      {d.mechanics.length ? <SectionTitle>By mechanic</SectionTitle> : null}
      {d.mechanics.map((m) => <Line key={m.name} left={m.name === 'Not assigned' ? t('Not assigned') : m.name} sub={mechanicLine(m)} />)}
    </Panel>
  );
  return (
    <SetupShell title="What we earned" sub="Labour and parts earned, by day and mechanic" ok={canJobCards((p) => allowed(me, p)) && workshopOn(me)} denied="You do not have access to job cards.">
      {body}
    </SetupShell>
  );
}
