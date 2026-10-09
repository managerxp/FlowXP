import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { kvGet, kvSet } from '../lib/local.ts';
import { cachedLoad } from '../lib/cache.ts';
import { useLoad } from '../lib/useLoad.ts';
import { useSyncState } from '../lib/sync.ts';
import { OUTCOME_LABEL, routeShops, visitedHere, type FieldToday, type Outcome } from '../lib/field.ts';
import { applyOrder, dueText, followUps, move, orderKey, parseOrder, planDays, suggest, type PastVisit } from '../lib/route.ts';
import { keepForRoute } from '../lib/schemeHints.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, Failed, Line, Loading, SavedNote, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));
const store = { get: kvGet, set: kvSet };
const routePath = (date: string, today: string) => `/distributor/field/today${date === today ? '' : `?date=${date}`}`;

/* A field rep's day: the shops in visiting order, who has been visited, what the rep has sold and collected, and the month's target. Today or any of the next six days can be planned: put the
   shops in the order that suits, or let FlowXP suggest one (who owes most overdue first, then who has not ordered for longest). Shops told to be visited again show as follow-ups.
   Works with no signal: the route is the last one saved, and what the rep does is sent later. */
export default function Field() {
  const session = useSession();
  const sync = useSyncState();
  const days = useMemo(() => planDays(), []);
  const today = days[0].id;
  const [date, setDate] = useState(today);
  const [planning, setPlanning] = useState(false);
  const [order, setOrder] = useState<number[] | null>(null);
  const route = useLoad<FieldToday>(`field-today:${session.businessId}:${date}`, () => api.get<FieldToday>(routePath(date, today)));
  const visits = useLoad<PastVisit[]>(`field-visits:${session.businessId}:${today}`, async () => {
    const from = new Date(Date.now() - 30 * 86400000); const f = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    const rows = await api.get<{ customer_id: number; customer: string; visit_date: string; outcome: Outcome; next_visit_date: string | null }[]>(`/distributor/visits?from=${f}&limit=200`);
    return rows.map((v) => ({ customer_id: v.customer_id, customer: v.customer, visit_date: String(v.visit_date).slice(0, 10), outcome: v.outcome, next_visit_date: v.next_visit_date ? String(v.next_visit_date).slice(0, 10) : null }));
  });
  const [here, setHere] = useState<Map<number, Outcome>>(new Map());
  const stops = routeShops(route.data);
  const ordered = applyOrder(stops, order);
  const sm = route.data?.summary;

  useEffect(() => { void kvGet(orderKey(session.businessId, date)).then((raw) => setOrder(parseOrder(raw))); }, [session.businessId, date]);
  useEffect(() => { void visitedHere(store, date, stops.map((x) => x.customer_id)).then(setHere); }, [route.data, sync.changesPending, date]);   // eslint-disable-line react-hooks/exhaustive-deps

  // with a signal: keep the offers of each shop on the route (so they can be read in the shop with no signal), and tomorrow's route (so it can be planned with none)
  useEffect(() => {
    if (!route.data || route.savedAt || stops.length === 0) return;
    void keepForRoute({ get: (p) => api.get(p) }, store, session.businessId, stops.slice(0, 40).map((x) => x.customer_id), date);
  }, [route.data, route.savedAt]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (date !== today || !route.data || route.savedAt) return;
    const next = days[1].id;
    void cachedLoad(`field-today:${session.businessId}:${next}`, () => api.get<FieldToday>(routePath(next, today)), store).catch(() => {});
  }, [route.data, route.savedAt]);   // eslint-disable-line react-hooks/exhaustive-deps

  const save = (ids: number[] | null) => { setOrder(ids); void kvSet(orderKey(session.businessId, date), JSON.stringify(ids)); };
  const ids = ordered.map((x) => x.customer_id);
  const followed = followUps(visits.data ?? [], date, new Set(stops.map((x) => x.customer_id)));
  const custom = order !== null || planning;

  const statusOf = (c: { customer_id: number; visit_outcome: Outcome | null; visited: boolean }) => { const o = here.get(c.customer_id) ?? c.visit_outcome; return { done: Boolean(o) || c.visited, label: o ? OUTCOME_LABEL[o] : c.visited ? 'Visited' : null }; };
  const openShop = (customerId: number, beatId?: number) => router.push({ pathname: '/field-shop/[id]', params: { id: String(customerId), ...(beatId ? { beat: String(beatId) } : {}) } });

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>My route</Title><Soft>{route.data ? `${route.data.salesperson.name} · ${date}` : 'The shops to visit, in order'}</Soft></View>
          {stops.length > 1 ? <Button title={planning ? 'Done' : 'Plan the day'} kind={planning ? 'primary' : 'quiet'} onPress={() => setPlanning((v) => !v)} /> : null}
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <Chips items={days.map((d) => ({ id: d.id, label: d.label }))} value={date} onChange={(d) => { setDate(d); setPlanning(false); }} />
        {sync.changesPending > 0 ? <Text accessibilityLiveRegion="polite" style={{ color: color.warn, fontWeight: '600', paddingHorizontal: 16, paddingTop: 8 }}>{`${sync.changesPending} thing${sync.changesPending === 1 ? '' : 's'} done on this phone will be sent when you are online.`}</Text> : null}
        <SavedNote at={route.savedAt} />
        <ScrollView refreshControl={<RefreshControl refreshing={route.busy} onRefresh={() => { void route.refresh(); void visits.refresh(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
          {route.error && !route.data ? <Failed message={date === today ? route.error : 'No internet, and this day has not been saved on this phone yet. Open it once with the internet on.'} onRetry={() => { void route.refresh(); }} /> : null}
          {route.busy && !route.data ? <Loading what="Loading your route" /> : null}
          {sm ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
              <Stat label="Visited" value={`${Math.max(sm.visited, here.size)} of ${sm.planned}`} />
              {date === today ? <Stat label="Orders today" value={String(sm.orders)} note={money(sm.order_value)} /> : null}
              {date === today ? <Stat label="Collected today" value={money(sm.collected)} tone={color.ok} /> : null}
              {sm.month_target ? <Stat label="Month target" value={`${Math.round(sm.month_target.achievement_pct)}%`} note={`${money(sm.month_target.remaining)} to go`} /> : null}
            </View>
          ) : null}

          {planning ? (
            <View style={{ padding: 16, gap: 8 }}>
              <Soft>Move a shop up or down, or let FlowXP suggest an order: shops not yet visited first, then those who owe the most overdue money, then those who have not ordered for longest.</Soft>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Suggest an order" onPress={() => save(suggest(stops, new Set(here.keys())).map((x) => x.customer_id))} style={{ flex: 1 }} />
                <Button title="Beat order" kind="quiet" onPress={() => save(null)} />
              </View>
            </View>
          ) : null}

          {route.data && stops.length === 0 ? <Empty>{date === today ? 'No shops on your beat today. Beats are planned on the FlowXP website.' : 'No shops planned for this day. Beats are planned on the FlowXP website.'}</Empty> : null}

          {custom ? (
            <View>
              <SectionTitle>{order ? 'Visiting order' : 'Shops'}</SectionTitle>
              {ordered.map((c, i) => {
                const st = statusOf(c);
                return (
                  <View key={c.customer_id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: color.card, borderTopWidth: 1, borderColor: color.line }}>
                    <View style={{ flex: 1 }}>
                      <Line left={`${i + 1}. ${c.name}`} sub={[c.beat, st.label, c.outstanding > 0 ? `owes ${money(c.outstanding)}` : null, c.overdue > 0 ? `${money(c.overdue)} overdue` : null].filter(Boolean).join(' · ')} right={st.done ? 'Done' : undefined} onPress={() => openShop(c.customer_id, c.beat_id)} />
                    </View>
                    {planning ? (
                      <View style={{ flexDirection: 'row', paddingRight: 8 }}>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Move ${c.name} up`} disabled={i === 0} onPress={() => save(move(ids, c.customer_id, -1))} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: i === 0 ? 0.3 : 1 }}><Ionicons name="chevron-up" size={24} color={color.brand} /></Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Move ${c.name} down`} disabled={i === ordered.length - 1} onPress={() => save(move(ids, c.customer_id, 1))} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: i === ordered.length - 1 ? 0.3 : 1 }}><Ionicons name="chevron-down" size={24} color={color.brand} /></Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (route.data?.beats ?? []).map((b) => (
            <View key={b.beat_id}>
              <SectionTitle>{b.name}</SectionTitle>
              {b.customers.map((c) => {
                const st = statusOf(c);
                return <Line key={c.customer_id} left={`${c.seq}. ${c.name}`} sub={[st.label, c.outstanding > 0 ? `owes ${money(c.outstanding)}` : null, c.overdue > 0 ? `${money(c.overdue)} overdue` : null, c.last_order ? `last order ${String(c.last_order).slice(0, 10)}` : 'no order yet'].filter(Boolean).join(' · ')} right={st.done ? 'Done' : undefined} onPress={() => openShop(c.customer_id, b.beat_id)} />;
              })}
            </View>
          ))}

          {followed.length > 0 ? (
            <View>
              <SectionTitle>Follow up</SectionTitle>
              <Soft style={{ paddingHorizontal: 16, paddingBottom: 4 }}>Shops you said you would visit again, not on this day's beat.</Soft>
              {followed.map((f) => <Line key={f.customer_id} icon="time-outline" left={f.customer} sub={`${OUTCOME_LABEL[f.outcome]} on ${f.visit_date} · ${dueText(f.next_visit_date as string, date)}`} onPress={() => openShop(f.customer_id)} />)}
            </View>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
