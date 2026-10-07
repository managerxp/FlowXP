import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, Vibration, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, signOut, useSession } from '../lib/session.ts';
import { kvGet, kvSet } from '../lib/local.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { alertFor, cookNow, dueText, itemsIn, minutesSince, RANK, sortTickets, span, statsOf, ticketTitle, urgencyOf, type Column, type KItem, type KitchenData, type KTicket, type Seen, type Urgency } from '../lib/kitchen.ts';
import { qty } from '../lib/money.ts';
import { ApiError } from '../lib/api.ts';
import { useWide } from '../lib/responsive.tsx';
import { Button, Chips, ErrorText, Failed, Loading, SavedNote, Soft, Title, color, s } from '../lib/ui.tsx';
import { Hint, markDone } from '../lib/learn.tsx';
import { router } from 'expo-router';

const POLL_MS = 8000;
const UNDO_MS = 7000;
const TONE: Record<Urgency, { bar: string; text: string; head: string; label: string }> = {
  ok: { bar: color.ok, text: color.ink, head: color.card, label: 'On time' },
  warning: { bar: color.warn, text: color.warn, head: '#fffbeb', label: 'Nearly due' },
  late: { bar: color.danger, text: color.danger, head: '#fef2f2', label: 'Late' }
};
const COLUMNS: { id: Column; label: string }[] = [{ id: 'making', label: 'To make' }, { id: 'ready', label: 'Ready' }, { id: 'served', label: 'Served' }];
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

type Undo = { label: string; ids: number[]; from: 'PREPARING' | 'READY' };

/* The kitchen (or barista) screen: what to make, what is ready to carry out, what was served. Tap a dish when it is done, or the whole ticket.
   It keeps the screen awake, refreshes by itself, and buzzes when a new order or a late dish appears. */
export default function Kitchen() {
  useKeepAwake();
  useEffect(() => { markDone('first_kitchen'); }, []);
  const session = useSession();
  const business = currentBusiness(session);
  const wide = useWide();
  const kitchenOnly = business?.role === 'KITCHEN';
  const scopeKey = `${session.businessId}:${session.branchId}`;
  const data = useLoad<KitchenData>(`kitchen:${scopeKey}`, () => api.get<KitchenData>('/kitchen/tickets'));
  const [station, setStation] = useState('all');
  const [showServed, setShowServed] = useState(false);
  const [col, setCol] = useState<Column>('making');
  const [now, setNow] = useState(Date.now());
  const [problem, setProblem] = useState('');
  const [undo, setUndo] = useState<Undo | null>(null);
  const [alertOn, setAlertOn] = useState(true);
  const [flash, setFlash] = useState('');
  const [gone, setGone] = useState<Set<number>>(new Set());
  const seen = useRef<Seen | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void kvGet('kitchen_alert').then((v) => { if (v === 'off') setAlertOn(false); });
    void kvGet('kitchen_gone').then((v) => { try { setGone(new Set(JSON.parse(v || '[]') as number[])); } catch { /* none kept */ } });
  }, []);

  // the tickets refresh by themselves while this screen is showing, and the ages tick over every 15 seconds
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    if (!focused) return;
    const poll = setInterval(() => { void data.refresh(); }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => { clearInterval(poll); clearInterval(tick); if (undoTimer.current) clearTimeout(undoTimer.current); };
  }, [focused]);   // eslint-disable-line react-hooks/exhaustive-deps

  // a buzz for a new order, a longer one for a dish that has just gone past its time (not for what was already there when this screen opened)
  useEffect(() => {
    if (!data.data || data.savedAt) return;
    const r = alertFor(seen.current, data.data, Date.now());
    seen.current = r.seen;
    if (r.alert && alertOn) { Vibration.vibrate(r.alert === 'new' ? [0, 250, 120, 250] : [0, 700]); setFlash(r.alert === 'new' ? 'New order' : 'A dish is late'); }
    if (r.alert) { const t = setTimeout(() => setFlash(''), 4000); return () => clearTimeout(t); }
  }, [data.data, data.savedAt, alertOn]);

  const sorted = useMemo(() => sortTickets(data.data, station, gone), [data.data, station, gone]);
  const stats = statsOf(sorted, now);
  const rows = useMemo(() => cookNow(sorted.making, now), [sorted.making, now]);
  const counts: Record<Column, number> = { making: sorted.making.length, ready: sorted.ready.length, served: sorted.served.length };

  const advance = async (items: KItem[], status: 'READY' | 'SERVED' | 'PREPARING', label: string) => {
    setProblem('');
    try {
      await api.call('/kitchen/advance', { method: 'POST', body: { item_ids: items.map((i) => i.order_item_id), status } });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndo({ label, ids: items.map((i) => i.order_item_id), from: items[0].status === 'READY' ? 'READY' : 'PREPARING' });
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
      void data.refresh();
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work'); }
  };
  const undoLast = async () => {
    const last = undo; setUndo(null);
    if (!last) return;
    try { await api.call('/kitchen/advance', { method: 'POST', body: { item_ids: last.ids, status: last.from } }); void data.refresh(); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'Could not undo'); }
  };
  const rush = async (t: KTicket) => {
    setProblem('');
    try { await api.call(`/kitchen/orders/${t.order_id}/rush`, { method: 'POST', body: {} }); void data.refresh(); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'Could not rush that'); }
  };
  const dismiss = (item: KItem) => setGone((g) => { const next = new Set(g).add(item.order_item_id); void kvSet('kitchen_gone', JSON.stringify([...next].slice(-200))); return next; });
  const toggleAlert = () => { const next = !alertOn; setAlertOn(next); void kvSet('kitchen_alert', next ? 'on' : 'off'); if (next) Vibration.vibrate(150); };

  /* ── one ticket ─────────────────────────────────────────────────────── */
  const Ticket = ({ t, c }: { t: KTicket; c: Column }) => {
    const items = itemsIn(t, c);
    const live = items.filter((i) => !i.cancelled);
    const making = c === 'making' && live.length > 0;
    const notice = c === 'making' && live.length === 0;
    const worst: Urgency = making ? live.reduce<Urgency>((w, i) => { const u = urgencyOf(minutesSince(i.sent_at, now), i.expected_minutes); return RANK[u] > RANK[w] ? u : w; }, 'ok') : 'ok';
    const rushed = t.priority === 'RUSH' && !notice;
    const tone = TONE[worst];
    const title = ticketTitle(t);
    const waiting = c === 'ready' && live.length ? Math.max(...live.map((i) => minutesSince(i.ready_at || i.sent_at, now))) : 0;
    const away = t.table_name == null;
    return (
      <View accessibilityLabel={`${title}, ${notice ? 'do not make' : making ? tone.label : c}`} style={{ borderRadius: 14, borderWidth: rushed ? 3 : 1, borderColor: rushed || worst === 'late' ? color.danger : color.line, backgroundColor: color.card, overflow: 'hidden', marginBottom: 12 }}>
        <View style={{ padding: 12, backgroundColor: rushed ? '#fef2f2' : making ? tone.head : c === 'ready' ? '#ecfdf5' : '#f1f5f9', gap: 2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: color.ink, flexShrink: 1 }}>{title}</Text>
            {rushed ? <Text style={{ backgroundColor: color.danger, color: '#fff', fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>RUSH</Text> : null}
          </View>
          <Text style={{ color: color.soft }}>{t.table_name ? `${t.order_number} · ` : ''}{clock(t.sent_at)}{t.brand_name ? ` · ${t.brand_name}` : ''}{t.kot_number ? ` · ${t.kot_number}` : ''}</Text>
          {making ? <Text style={{ color: tone.text, fontWeight: '700' }}>{tone.label} · waiting {span(minutesSince(t.sent_at, now))}</Text> : null}
          {c === 'ready' && waiting >= 1 ? <Text style={{ color: waiting >= 5 ? color.warn : color.soft, fontWeight: '700' }}>Waiting to go out {span(waiting)}</Text> : null}
        </View>
        {items.map((i) => {
          const elapsed = minutesSince(i.sent_at, now);
          const u = urgencyOf(elapsed, i.expected_minutes);
          const due = c === 'making' && !i.cancelled ? dueText(elapsed, i.expected_minutes) : null;
          return (
            <View key={i.order_item_id} style={{ paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderColor: color.line, backgroundColor: i.cancelled ? '#fef2f2' : color.card, gap: 6 }}>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Text style={{ fontSize: 24, fontWeight: '800', color: i.cancelled ? color.danger : color.ink, minWidth: 36 }}>{qty(i.quantity)}×</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 18, fontWeight: '600', color: i.cancelled ? color.danger : color.ink, textDecorationLine: i.cancelled ? 'line-through' : 'none' }}>{i.description}</Text>
                  {i.modifiers.length ? <Text style={{ fontSize: 15, color: color.soft }}>{i.modifiers.map((m) => m.name).join(' · ')}</Text> : null}
                  {i.combo?.length ? <Text style={{ fontSize: 14, color: color.soft }}>{i.combo.join(' + ')}</Text> : null}
                  {i.kitchen_notes ? <Text style={{ fontSize: 15, fontWeight: '700', color: color.warn }}>Note: {i.kitchen_notes}</Text> : null}
                  {i.cancelled ? <Text style={{ color: color.danger, fontWeight: '700' }}>Cancelled. Do not make.</Text> : null}
                </View>
                {due ? <Text style={{ fontWeight: u === 'ok' ? '400' : '700', color: TONE[u].text }}>{due}</Text> : null}
              </View>
              {c === 'making' && !i.cancelled ? <Button title={`${qty(i.quantity)} ${i.description} ready`} kind="quiet" onPress={() => { void advance([i], 'READY', `${title}: ${i.description} ready`); }} style={{ minHeight: 52 }} /> : null}
              {i.cancelled ? <Button title="Got it" kind="danger" onPress={() => dismiss(i)} style={{ minHeight: 52 }} /> : null}
            </View>
          );
        })}
        {live.length > 0 && c !== 'served' ? (
          <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderColor: color.line }}>
            {c === 'making' ? (
              <>
                {!rushed ? <Button title="Rush" kind="danger" onPress={() => { void rush(t); }} style={{ minHeight: 56 }} /> : null}
                <Button title={live.length > 1 ? 'All ready' : 'Ready'} onPress={() => { void advance(live, 'READY', `${title} ready`); }} style={{ flex: 1, minHeight: 56 }} />
              </>
            ) : (
              <>
                <Button title="Back" kind="quiet" onPress={() => { void advance(live, 'PREPARING', `${title} back to the kitchen`); }} style={{ minHeight: 56 }} />
                <Button title={away ? 'Handed over' : 'Served'} onPress={() => { void advance(live, 'SERVED', `${title} ${away ? 'handed over' : 'served'}`); }} style={{ flex: 1, minHeight: 56, backgroundColor: color.ok }} />
              </>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const List = ({ c }: { c: Column }) => (
    <View>
      {sorted[c].length === 0 ? <Soft style={{ padding: 24, textAlign: 'center' }}>{c === 'making' ? 'Nothing to make. All clear.' : c === 'ready' ? 'Nothing waiting to go out.' : 'Nothing served in the last two hours.'}</Soft> : null}
      {sorted[c].map((t) => <Ticket key={`${c}-${t.order_id}`} t={t} c={c} />)}
    </View>
  );

  const Cook = rows.length ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 8 }} style={{ flexGrow: 0 }} accessibilityLabel="Cook now">
      {rows.map((r) => (
        <View key={r.key} style={[s.card, { minWidth: 150, padding: 10, borderColor: r.late ? color.danger : color.line }]}>
          <Text style={{ fontSize: 26, fontWeight: '800', color: r.late ? color.danger : color.ink }}>{r.qty}×</Text>
          <Text numberOfLines={2} style={{ fontWeight: '600', color: color.ink }}>{r.name}</Text>
          <Text numberOfLines={1} style={{ color: color.soft, fontSize: 13 }}>{r.extra ? `${r.extra} · ` : ''}{r.tickets} {r.tickets === 1 ? 'ticket' : 'tickets'}{r.late ? ` · ${r.late} late` : ''}</Text>
        </View>
      ))}
    </ScrollView>
  ) : null;

  const stations = (data.data?.stations ?? []).map((st) => ({ id: st.station_id === null ? 'none' : String(st.station_id), label: `${st.name}${st.making ? ` ${st.making}${st.late ? ' · late' : ''}` : ''}` }));

  return (
    <SafeAreaView style={s.screen}>
      <View style={{ paddingHorizontal: 12, paddingTop: 8, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Kitchen</Title><Soft>{business?.name} · tap a dish when it is done</Soft></View>
          <Button title={alertOn ? 'Buzz on' : 'Buzz off'} kind="quiet" onPress={toggleAlert} />
          {kitchenOnly ? <Button title="Sign out" kind="quiet" onPress={() => { void signOut().then(() => router.replace('/login')); }} /> : <Button title="Back" kind="quiet" onPress={() => goBack()} />}
        </View>
        {flash ? <Text accessibilityLiveRegion="assertive" style={{ backgroundColor: color.brand, color: '#fff', fontWeight: '800', fontSize: 18, textAlign: 'center', padding: 10, borderRadius: 10 }}>{flash}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={[s.card, { flex: 1, padding: 10 }]}><Soft>To make</Soft><Text style={{ fontSize: 24, fontWeight: '800', color: color.ink }}>{stats.tickets}</Text><Soft>{stats.dishes ? `${stats.dishes} dishes` : 'All clear'}</Soft></View>
          <View style={[s.card, { flex: 1, padding: 10 }]}><Soft>Late</Soft><Text style={{ fontSize: 24, fontWeight: '800', color: stats.lateTickets ? color.danger : color.ok }}>{stats.lateTickets}</Text><Soft>{stats.lateTickets ? 'past time' : 'Nothing late'}</Soft></View>
          <View style={[s.card, { flex: 1, padding: 10 }]}><Soft>Oldest</Soft><Text style={{ fontSize: 24, fontWeight: '800', color: color.ink }}>{stats.tickets ? span(stats.oldest) : '–'}</Text><Soft>since sent</Soft></View>
          <View style={[s.card, { flex: 1, padding: 10 }]}><Soft>Ready</Soft><Text style={{ fontSize: 24, fontWeight: '800', color: stats.longestWait >= 5 ? color.warn : color.ink }}>{stats.readyTickets}</Text><Soft>{stats.readyTickets ? `longest ${span(stats.longestWait)}` : 'none waiting'}</Soft></View>
        </View>
        {stations.length > 1 ? <Chips items={stations} value={station} onChange={setStation} /> : null}
        {!wide ? <Chips<Column> items={COLUMNS.filter((x) => x.id !== 'served' || showServed).map((x) => ({ id: x.id, label: `${x.label} ${counts[x.id]}` }))} value={col} onChange={setCol} /> : null}
        <SavedNote at={data.savedAt} />
        <Hint id="kitchen" />
        {data.error && !data.data ? <Failed message={data.error} onRetry={() => { void data.refresh(); }} /> : null}
        <ErrorText>{problem}</ErrorText>
      </View>
      {Cook}

      {!data.data && data.busy ? <Loading what="Loading tickets" /> : null}
      {data.data ? (
        wide ? (
          <View style={{ flex: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 12 }}>
            <ScrollView style={{ flex: 3 }}><Text style={colTitle}>To make · {counts.making}</Text><List c="making" /></ScrollView>
            <ScrollView style={{ flex: 2 }}>
              <Text style={colTitle}>Ready to serve · {counts.ready}</Text><List c="ready" />
              {showServed ? <><Text style={colTitle}>Served · {counts.served}</Text><List c="served" /></> : null}
            </ScrollView>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 90 }}><List c={col === 'served' && !showServed ? 'making' : col} /></ScrollView>
        )
      ) : null}

      <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12, gap: 8 }}>
        {undo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: color.ink, padding: 12, borderRadius: 12 }}>
            <Text style={{ color: '#fff', flex: 1 }}>{undo.label}</Text>
            <Pressable accessibilityRole="button" onPress={() => { void undoLast(); }} style={{ minHeight: 44, minWidth: 64, justifyContent: 'center' }}><Text style={{ color: '#93c5fd', fontWeight: '800', fontSize: 16 }}>UNDO</Text></Pressable>
          </View>
        ) : null}
        <Button title={showServed ? 'Hide served' : `Show served${counts.served ? ` (${counts.served})` : ''}`} kind="quiet" onPress={() => { setShowServed((v) => !v); if (showServed && col === 'served') setCol('making'); }} />
      </View>
    </SafeAreaView>
  );
}

const colTitle = { fontSize: 16, fontWeight: '700' as const, color: color.ink, paddingVertical: 8 };
