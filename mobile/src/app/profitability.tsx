import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import {
  COMMISSION_KEYS, FEE_KEYS, FEE_LABEL, CHANNEL_LABEL, ITEM_SORTS, PARTS, PROFIT_RANGES, assumptionsBody, assumptionsForm, assumptionsProblem, canInsights, channelSub, deltaGood, deltaText, expensesSub, itemSub, pctText, rangeQuery, share, sortItems,
  type Assumptions, type AssumptionsForm, type Profit
} from '../lib/insights.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));
const tone = (v: number | null | undefined, upIsGood = true) => { const g = deltaGood(v, upIsGood); return g == null ? undefined : g ? color.ok : color.danger; };

const Settings = ({ onDone }: { onDone: () => void }) => {
  const [f, setF] = useState<AssumptionsForm | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<Assumptions>('/profitability/settings').then((a) => setF(assumptionsForm(a))).catch((e: Error) => setError(e.message || t('Could not load.'))); }, []);
  if (!f) return error ? <Failed message={error} /> : <Loading />;
  const rate = (group: 'fees' | 'commissions', key: string, label: string) => (
    <View key={key} style={{ flex: 1, minWidth: 90, gap: 4 }}>
      <Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>
      <TextInput style={s.input} value={(f[group] as Record<string, string>)[key]} onChangeText={(v) => setF((x) => (x ? { ...x, [group]: { ...x[group], [key]: v.replace(/[^\d.]/g, '') } } : x))} keyboardType="decimal-pad" placeholder="0" accessibilityLabel={t(label)} />
    </View>
  );
  const save = async () => {
    const bad = assumptionsProblem(f);
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError('');
    try { await api.call('/profitability/settings', { method: 'PUT', body: assumptionsBody(f) }); onDone(); } catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); } finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Soft>{t('FlowXP cannot know what your card machine or delivery platform charges. Enter your real rates; anything left at 0 is not deducted.')}</Soft>
      <Text style={{ fontWeight: '700', color: color.ink }}>{t('Payment fees (% of amount collected)')}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>{FEE_KEYS.map((k) => rate('fees', k, FEE_LABEL[k]))}</View>
      <Text style={{ fontWeight: '700', color: color.ink }}>{t('Delivery platform commission (% of food value)')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{COMMISSION_KEYS.map((k) => rate('commissions', k, CHANNEL_LABEL[k]))}</View>
      <View style={{ gap: 4 }}>
        <Text style={{ color: color.soft, fontSize: 13 }}>{t('Packaging per takeaway / delivery order (₹)')}</Text>
        <TextInput style={s.input} value={f.packaging} onChangeText={(v) => setF((x) => (x ? { ...x, packaging: v.replace(/[^\d.]/g, '') } : x))} keyboardType="decimal-pad" placeholder="0" accessibilityLabel={t('Packaging per takeaway / delivery order (₹)')} />
        <Soft>{t('Box, bag, cutlery.')}</Soft>
      </View>
      <ErrorText>{error}</ErrorText>
      <Button title="Save assumptions" onPress={() => { void save(); }} busy={busy} />
      <Button title="Cancel" kind="quiet" onPress={onDone} />
    </ScrollView>
  );
};

/* Profitability (owner and anyone with reports): what sales leave after food cost, fees, commission and packaging, then rent and wastage. An estimate. */
export default function Profitability() {
  const me = currentBusiness(useSession());
  const ok = canInsights((p) => allowed(me, p), 'reports');
  const [days, setDays] = useState('30');
  const [data, setData] = useState<Profit | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<(typeof ITEM_SORTS)[number]['id']>('contribution');
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => { setData(null); setError(''); api.get<Profit>(`/profitability?${rangeQuery(Number(days))}`).then(setData).catch((e: Error) => setError(e.message || t('Could not load.'))); }, [days]);
  useEffect(() => { if (ok) load(); }, [load, ok]);
  const tt = data?.totals; const c = data?.change_pct;

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Profitability</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>You do not have access to reports.</Empty> : editing ? <Settings onDone={() => { setEditing(false); load(); }} /> : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <Soft style={{ paddingHorizontal: 16 }}>{t('What your sales actually leave, after the costs that come with them.')}</Soft>
            <Chips items={PROFIT_RANGES.map((n) => ({ id: String(n), label: t('Last {n} days', { n }) }))} value={days} onChange={setDays} />
            <View style={{ padding: 16, gap: 8 }}><Soft>{`${t('Estimate')}: ${t('Built from recorded sales and your cost assumptions, not an accounting figure.')}`}</Soft><Button title="Cost assumptions" kind="quiet" onPress={() => setEditing(true)} /></View>
            {error ? <Failed message={error} onRetry={load} /> : !data || !tt || !c ? <Loading what="Calculating…" /> : (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
                  <Stat label="Net revenue" value={money(tt.net_revenue)} note={deltaText(c.net_revenue_pct)} tone={tone(c.net_revenue_pct)} />
                  <Stat label="Food cost" value={pctText(tt.food_cost_pct)} note={deltaText(c.food_cost_pct_points, ' pts')} tone={tone(c.food_cost_pct_points, false)} />
                  <Stat label="Gross margin" value={pctText(tt.gross_margin_pct)} note={t('after food cost')} />
                  <Stat label="Contribution" value={money(tt.contribution)} note={`${pctText(tt.contribution_margin_pct)} · ${deltaText(c.contribution_pct)}`} tone={tone(c.contribution_pct)} />
                  <Stat label="Estimated net" value={money(tt.estimated_net)} note={`${t('after expenses')} · ${deltaText(c.estimated_net_pct)}`} tone={tone(c.estimated_net_pct)} />
                </View>
                <SectionTitle>Where each rupee of revenue goes</SectionTitle>
                {PARTS.map((p) => <Line key={p.key} left={p.label} right={money(tt[p.key])} sub={`${share(tt[p.key], tt.net_revenue)}% ${t('of revenue')}`} />)}
                <Line left="Operating expenses" right={money(data.period_costs.expenses_total)} sub={expensesSub(data.period_costs)} />
                <Line left="Wastage" right={money(data.period_costs.wastage)} sub={t('valued at current cost')} />
                <SectionTitle>By channel</SectionTitle>
                {data.channels.length === 0 ? <Empty>No sales in this period.</Empty> : data.channels.map((ch) => <Line key={ch.channel} left={t(CHANNEL_LABEL[ch.channel] ?? ch.channel)} right={money(ch.net_revenue)} sub={channelSub(ch)} />)}
                <SectionTitle>By menu item</SectionTitle>
                <Chips items={ITEM_SORTS.map((o) => ({ id: o.id, label: o.label }))} value={sort} onChange={setSort} />
                {data.items.length === 0 ? <Empty>No items sold in this period.</Empty> : sortItems(data.items, sort).slice(0, 40).map((i) => <Line key={i.product_id} left={i.name} right={money(i.contribution)} sub={itemSub(i)} />)}
                <Soft style={{ padding: 16 }}>{t('Net revenue is what was billed before tax, minus discounts and refunds. Cancelled invoices are left out. Food cost is the ingredient cost recorded on each bill when it was made. Fees, commission and packaging use your assumptions: unset means zero. Contribution is what each sale leaves toward rent, salaries and other fixed costs.')}</Soft>
              </>
            )}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
