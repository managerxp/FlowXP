import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import {
  STOCK_STATUS, accuracyText, canInsights, dayLine, draftNote, emptyEvent, eventBody, eventLine, eventProblem, hourLabel, rangeText, shortDate, stockSub,
  type EventForm, type Forecast, type StockForecast
} from '../lib/insights.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));

/* ── demand ──────────────────────────────────────────────────────────────── */
const Demand = () => {
  const [focus, setFocus] = useState<string | null>(null);
  const [data, setData] = useState<Forecast | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<EventForm>(emptyEvent());
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback((date: string | null) => {
    api.get<Forecast>(`/forecast?horizon=7${date ? `&focus=${date}` : ''}`).then((d) => { setData(d); if (!date) setFocus(d.focus.date); setError(''); }).catch((e: Error) => setError(e.message || t('Could not load.')));
  }, []);
  useEffect(() => { load(null); }, [load]);
  if (error && !data) return <Failed message={error} onRetry={() => load(null)} />;
  if (!data) return <Loading what="Working out the week ahead…" />;
  const peak = Math.max(...data.focus.hourly.map((h) => h.orders), 1);
  const focusDay = data.daily.find((d) => d.date === data.focus.date);

  const add = async () => {
    const bad = eventProblem(form);
    if (bad) { setProblem(t(bad)); return; }
    setProblem(''); setNote('');
    try { await api.call('/forecast/events', { method: 'POST', body: eventBody(form) }); setForm(emptyEvent()); setNote(t('Event added, forecasts updated')); load(focus); } catch (e) { setProblem(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
  };
  const remove = async (id: number) => { try { await api.call(`/forecast/events/${id}`, { method: 'DELETE' }); load(focus); } catch (e) { setProblem(e instanceof Error ? e.message : ''); } };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Soft style={{ padding: 16 }}>{`${t('Prediction')}: ${accuracyText(data.accuracy)}`}</Soft>
      {data.daily.every((d) => d.insufficient_data) ? <Soft style={{ padding: 16 }}>{t('Forecasting needs at least three weeks of history for the same weekday. You have {n} trading days so far. Check back as history builds.', { n: data.history_days })}</Soft> : (
        <>
          {data.daily.map((d) => <Line key={d.date} left={`${d.weekday.slice(0, 3)} ${shortDate(d.date)}`} right={d.orders ? String(Math.round(d.orders.predicted)) : ''} sub={dayLine(d)} selected={d.date === data.focus.date} onPress={() => { setFocus(d.date); load(d.date); }} />)}
          <SectionTitle>{`${focusDay?.weekday ?? ''} ${shortDate(data.focus.date)} · ${t('hour by hour')}`}</SectionTitle>
          {data.focus.hourly.length === 0 ? <Soft style={{ paddingHorizontal: 16 }}>{t('No hourly pattern yet.')}</Soft> : (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 4, paddingHorizontal: 16 }} accessibilityLabel={t('hour by hour')}>
              {data.focus.hourly.map((h) => (
                <View key={h.hour} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
                  <Text style={{ fontSize: 10, color: color.soft }}>{h.orders >= 1 ? Math.round(h.orders) : ''}</Text>
                  <View style={{ width: '100%', height: `${(h.orders / peak) * 70}%`, backgroundColor: color.brand, opacity: h.orders >= peak * 0.8 ? 1 : 0.4, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
                  <Text style={{ fontSize: 10, color: color.soft }}>{hourLabel(h.hour)}</Text>
                </View>
              ))}
            </View>
          )}
          <SectionTitle>{`${t('Expected portions')} · ${shortDate(data.focus.date)}`}</SectionTitle>
          {data.focus.items.length === 0 ? <Soft style={{ paddingHorizontal: 16 }}>{t('No item history yet.')}</Soft> : data.focus.items.slice(0, 40).map((i) => <Line key={i.product_id} left={i.name} right={String(Math.round(i.portions.predicted))} sub={`${i.category ?? ''}${i.category ? ' · ' : ''}${rangeText(i.portions)} ${t('portions')} · ${t(i.confidence)}`} />)}
          <SectionTitle>By category</SectionTitle>
          {data.focus.categories.map((c) => <Line key={c.category} left={c.category} right={String(Math.round(c.portions.predicted))} sub={rangeText(c.portions)} />)}
        </>
      )}
      <SectionTitle>Things you know that history does not</SectionTitle>
      <Soft style={{ paddingHorizontal: 16 }}>{t("A festival, a match night, a promotion, a planned closure. Tell FlowXP and it adjusts that day's forecast.")}</Soft>
      {data.upcoming_events.map((e) => <Line key={e.event_id} left={eventLine(e)} right={t('Remove')} onPress={() => { void remove(e.event_id); }} />)}
      <View style={{ padding: 16, gap: 8 }}>
        <TextInput style={s.input} value={form.date} onChangeText={(v) => setForm((f) => ({ ...f, date: v }))} placeholder="2026-10-31" maxLength={10} accessibilityLabel={t('Date')} />
        <TextInput style={s.input} value={form.label} onChangeText={(v) => setForm((f) => ({ ...f, label: v }))} placeholder={t('e.g. Diwali weekend')} maxLength={60} accessibilityLabel={t('What is happening')} />
        <TextInput style={s.input} value={form.uplift_pct} onChangeText={(v) => setForm((f) => ({ ...f, uplift_pct: v.replace(/[^\d.-]/g, '') }))} keyboardType="numbers-and-punctuation" accessibilityLabel={t('Expected change %')} />
        <Soft>{t('Expected change %')}</Soft>
        <ErrorText>{problem}</ErrorText>
        {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{note}</Text> : null}
        <Button title="Add" kind="quiet" onPress={() => { void add(); }} />
      </View>
      <Soft style={{ paddingHorizontal: 16 }}>{`${t('How this is made')}: ${data.method}`}</Soft>
    </ScrollView>
  );
};

/* ── stock and purchasing ────────────────────────────────────────────────── */
const StockPart = () => {
  const [data, setData] = useState<StockForecast | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { api.get<StockForecast>('/forecast/inventory').then(setData).catch((e: Error) => setError(e.message || t('Could not load.'))); }, []);
  if (error && !data) return <Failed message={error} />;
  if (!data) return <Loading what="Projecting stock…" />;
  const sm = data.summary;
  const draftAll = async () => {
    setBusy(true); setNote(''); setError('');
    try { const r = await api.post<{ orders: unknown[]; already_on_order: unknown[] }>('/purchases/orders/from-forecast', {}); setNote(draftNote(r)); if (r.orders.length) router.push('/purchasing'); } catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); } finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
        <Stat label="Order now" value={String(sm.order_now)} note={t('will run short before a delivery can arrive')} tone={sm.order_now ? color.danger : undefined} /><Stat label="Order soon" value={String(sm.order_soon)} note={t('within the next couple of days')} tone={sm.order_soon ? color.warn : undefined} />
        <Stat label="Suggested purchases" value={money(sm.estimated_cost)} note={t('at your latest prices')} /><Stat label="Missed by a fixed minimum" value={String(sm.flagged_only_by_prediction)} note={t('items a simple low-stock alert would not have caught')} />
      </View>
      {data.by_supplier.length > 0 ? (
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          <Button title={busy ? 'Creating…' : 'Create draft orders for all'} onPress={() => { void draftAll(); }} busy={busy} />
          {note ? <Soft>{note}</Soft> : null}
          <Soft>{t('Nothing is ordered until you send it.')}</Soft>
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {data.by_supplier.map((g) => <Line key={g.supplier_id ?? 'none'} left={g.supplier_name} right={money(g.total)} sub={g.items.map((i) => `${i.name} ${i.quantity} ${i.unit}`).join(' · ')} />)}
      <SectionTitle>Every tracked item</SectionTitle>
      {data.items.length === 0 ? <Empty>Not enough usage history yet: forecasts start once an item has a week of use.</Empty> : data.items.slice(0, 60).map((i) => <Line key={i.product_id} left={i.name} right={t(STOCK_STATUS[i.status])} sub={stockSub(i)} />)}
      <Soft style={{ padding: 16 }}>{`${t('How this is made')}: ${data.method}`}</Soft>
    </ScrollView>
  );
};

/* Forecast (owner and anyone with reports): the week's demand, hour by hour, and what to buy for it. Every figure is a prediction and says so. */
export default function ForecastScreen() {
  const me = currentBusiness(useSession());
  const ok = canInsights((p) => allowed(me, p), 'reports');
  const [tab, setTab] = useState<'demand' | 'stock'>('demand');
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View style={{ flex: 1 }}><Title>Forecast</Title><Soft>What to expect, and what to have in the kitchen for it.</Soft></View><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>You do not have access to reports.</Empty> : (
          <>
            <Chips items={[{ id: 'demand', label: 'Demand' }, { id: 'stock', label: 'Stock & purchasing' }]} value={tab} onChange={setTab} />
            {tab === 'demand' ? <Demand /> : <StockPart />}
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
