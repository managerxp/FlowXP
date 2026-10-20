import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { LEAK_CATEGORY, LEAK_RANGES, SEVERITY, canInsights, evidenceCell, findingCounts, rangeQuery, reviewBody, reviewedText, showValue, type Finding, type Leakage } from '../lib/insights.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));

const FindingCard = ({ f, onReview }: { f: Finding; onReview: (f: Finding, status: 'OPEN' | 'REVIEWED' | 'DISMISSED', note?: string) => void }) => {
  const [open, setOpen] = useState(false);
  const [deciding, setDeciding] = useState<'REVIEWED' | 'DISMISSED' | null>(null);
  const [note, setNote] = useState('');
  const decided = f.status !== 'OPEN';
  const sev = f.severity === 'critical' ? color.danger : f.severity === 'warning' ? color.warn : color.soft;
  return (
    <View style={[s.card, { gap: 8, opacity: decided ? 0.7 : 1 }]}>
      <Text style={{ color: sev, fontWeight: '700' }}>{`${t(SEVERITY[f.severity])} · ${t(LEAK_CATEGORY[f.category] ?? f.category)}${decided ? ` · ${t(f.status === 'DISMISSED' ? 'Dismissed' : 'Reviewed')}` : ''}`}</Text>
      <Text style={{ fontSize: 16, fontWeight: '700', color: color.ink }}>{f.title}</Text>
      <Text style={{ color: color.ink, lineHeight: 21 }}>{f.summary}</Text>
      {f.potential > 0 ? <Text style={{ color: color.ink, fontWeight: '700' }}>{`${money(f.potential)} ${t('potential')}`}</Text> : null}
      {f.expected_value !== undefined && f.metric ? <Soft>{`${f.metric.label}: ${showValue(f.current_value ?? 0, f.metric.unit)} · ${t('Your normal')}: ${showValue(f.expected_value, f.metric.unit)} · ${t('Difference')}: +${showValue(f.difference ?? 0, f.metric.unit)}`}</Soft> : null}
      <Soft>{`${t('Suggested next step')}: ${f.recommendation}`}</Soft>
      <Soft>{t('Confidence: {v}', { v: f.confidence })}</Soft>
      {f.review?.note ? <Soft>{`“${f.review.note}” — ${f.review.reviewed_by ?? ''}`}</Soft> : null}
      {f.evidence ? <Button title={open ? 'Hide details' : 'Investigate'} kind="quiet" onPress={() => setOpen((v) => !v)} /> : null}
      {open && f.evidence ? f.evidence.rows.map((row, i) => <Soft key={i}>{row.map((cell, j) => `${f.evidence!.columns[j]}: ${evidenceCell(cell, f.evidence!.columns[j])}`).join(' · ')}</Soft>) : null}
      {!decided && !deciding ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Button title="Mark reviewed" kind="quiet" onPress={() => setDeciding('REVIEWED')} /></View>
          <View style={{ flex: 1 }}><Button title="Dismiss" kind="quiet" onPress={() => setDeciding('DISMISSED')} /></View>
        </View>
      ) : null}
      {decided ? <Button title="Reopen" kind="quiet" onPress={() => onReview(f, 'OPEN')} /> : null}
      {deciding ? (
        <View style={{ gap: 8 }}>
          <TextInput style={s.input} value={note} onChangeText={setNote} placeholder={t('Add a note (optional)')} maxLength={300} accessibilityLabel={t('Add a note (optional)')} />
          <Button title={deciding === 'DISMISSED' ? 'Dismiss for 14 days' : 'Save'} onPress={() => { onReview(f, deciding, note); setDeciding(null); setNote(''); }} />
          <Button title="Cancel" kind="quiet" onPress={() => setDeciding(null)} />
        </View>
      ) : null}
    </View>
  );
};

/* Revenue leakage (owner and admin): patterns that differ from this business's own normal, each with the evidence to check. The wording is "unusual", never a conclusion about a person. */
export default function LeakageScreen() {
  const me = currentBusiness(useSession());
  const ok = canInsights((p) => allowed(me, p), 'settings');
  const [days, setDays] = useState('30');
  const [data, setData] = useState<Leakage | null>(null);
  const [error, setError] = useState('');
  const [problem, setProblem] = useState('');
  const [showDecided, setShowDecided] = useState(false);
  const load = useCallback(() => { setError(''); api.get<Leakage>(`/leakage?${rangeQuery(Number(days))}`).then(setData).catch((e: unknown) => setError(e instanceof ApiError && e.status === 403 ? t('Only the owner and admins can see this page.') : e instanceof Error ? e.message : t('Could not load.'))); }, [days]);
  useEffect(() => { setData(null); if (ok) load(); }, [load, ok]);
  const review = async (f: Finding, status: 'OPEN' | 'REVIEWED' | 'DISMISSED', note?: string) => {
    setProblem('');
    try { await api.call('/leakage/reviews', { method: 'POST', body: reviewBody(f, status, note) }); setProblem(''); load(); } catch (e) { setProblem(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    void reviewedText;
  };
  const open = data?.findings.filter((f) => f.status === 'OPEN') ?? [];
  const decided = data?.findings.filter((f) => f.status !== 'OPEN') ?? [];

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View style={{ flex: 1 }}><Title>Revenue leakage</Title><Soft>Activity that differs from your own normal and may be costing you money.</Soft></View><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>Only the owner and admins can see this page.</Empty> : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <Chips items={LEAK_RANGES.map((n) => ({ id: String(n), label: t('Last {n} days', { n }) }))} value={days} onChange={setDays} />
            {error ? <Failed message={error} onRetry={load} /> : !data ? <Loading what="Checking your records…" /> : (
              <>
                <View style={{ padding: 16, gap: 4 }}>
                  <Soft>{t('Potential leakage detected')}</Soft>
                  <Text style={{ fontSize: 30, fontWeight: '800', color: color.ink }}>{money(data.summary.potential)}</Text>
                  <Soft>{findingCounts(data)}</Soft>
                </View>
                {data.summary.by_category.map((c) => <Line key={c.category} left={t(LEAK_CATEGORY[c.category] ?? c.category)} right={money(c.potential)} />)}
                <Soft style={{ padding: 16 }}>{data.note}</Soft>
                <ErrorText>{problem}</ErrorText>
                {open.length === 0 ? <Empty>{t('Nothing unusual found in the last {n} days. FlowXP compares against your own normal, so this improves as your history grows.', { n: data.period.days })}</Empty> : null}
                <View style={{ padding: 16, gap: 12 }}>{open.map((f) => <FindingCard key={f.fingerprint} f={f} onReview={review} />)}</View>
                {decided.length > 0 ? (
                  <>
                    <SectionTitle>{showDecided ? t('Hide reviewed or dismissed') : t('Show {n} reviewed or dismissed', { n: decided.length })}</SectionTitle>
                    <View style={{ paddingHorizontal: 16 }}><Button title={showDecided ? 'Hide reviewed or dismissed' : 'Reviewed'} kind="quiet" onPress={() => setShowDecided((v) => !v)} /></View>
                    {showDecided ? <View style={{ padding: 16, gap: 12 }}>{decided.map((f) => <FindingCard key={f.fingerprint} f={f} onReview={review} />)}</View> : null}
                  </>
                ) : null}
              </>
            )}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
