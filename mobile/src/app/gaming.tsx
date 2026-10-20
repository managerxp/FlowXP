import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { ALARMS, KIND_LABEL, STATE_LABEL, clock, countBy, duration, liveCharge, liveElapsed, liveRemaining, offersFor, startBody, startProblem, stations, stopBody, stopProblem, timeWarning, type Board, type Bundle, type How, type Station } from '../lib/gaming.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, ErrorText, Failed, Loading, SavedNote, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

const EDGE: Record<string, string> = { get RUNNING() { return color.brand; }, get PAUSED() { return color.warn; }, get TO_BILL() { return color.danger; }, get RESERVED() { return color.warn; }, get OUT_OF_SERVICE() { return color.line; }, get AVAILABLE() { return color.line; } };
const timeText = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

/* The lounge board: every station with its timer, who is playing, what it has cost and the food and drink on its tab. Start, pause, stop, count frames, and take the payment.
   The server keeps the time; the clocks tick here between refreshes (every 15 seconds and after each action). */
export default function Gaming() {
  const session = useSession();
  const desk = allowed(currentBusiness(session), 'gaming_desk');
  const scope = `${session.businessId}:${session.branchId}`;
  const board = useLoad<Board>(`gaming-board:${scope}`, () => api.get<Board>('/gaming/board'));
  const bundles = useLoad<Bundle[]>(`gaming-bundles:${scope}`, () => api.get<Bundle[]>('/gaming/bundles?kind=SESSION'));
  const fetchedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => { fetchedAt.current = Date.now(); setNow(Date.now()); }, [board.data]);
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    if (!focused) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const load = setInterval(() => { void board.refresh(); }, 15000);
    return () => { clearInterval(tick); clearInterval(load); };
  }, [focused]);   // eslint-disable-line react-hooks/exhaustive-deps
  const since = Math.max(0, (now - fetchedAt.current) / 1000);

  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(0);
  const [starting, setStarting] = useState(0);
  const [players, setPlayers] = useState(1);
  const [how, setHow] = useState<How>('OPEN');
  const [bundleId, setBundleId] = useState(0);
  const [alarm, setAlarm] = useState('');
  const [voiding, setVoiding] = useState(0);
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(newKey());   // one start, one key: a double tap starts one session

  const all = stations(board.data);
  const act = async (st: Station, work: () => Promise<unknown>, after?: () => void) => {
    setBusy(st.station_id); setProblem('');
    try { await work(); after?.(); void board.refresh(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work'); void board.refresh(); }
    finally { setBusy(0); }
  };
  const post = (st: Station, path: string, body: object = {}) => api.call(`/gaming/sessions/${st.session?.session_id}/${path}`, { method: 'POST', body });

  const open = (st: Station) => { setStarting(st.station_id); setPlayers(1); setHow('OPEN'); setBundleId(0); setAlarm(''); setKey(newKey()); setProblem(''); setVoiding(0); };
  const start = (st: Station, override = false) => {
    const f = { players, how, bundleId: bundleId || null, alarm };
    const bad = startProblem(st, f);
    if (bad) return setProblem(bad);
    void act(st, async () => {
      try { await api.post('/gaming/sessions', startBody(st, f, override), { idempotencyKey: override ? newKey() : key }); }
      catch (e) {
        // the station is booked for someone soon: a person may still start it, after being told
        if (e instanceof ApiError && e.code === 'BOOKED') { Alert.alert('Booked soon', `${e.message}\nStart it anyway?`, [{ text: 'No', style: 'cancel' }, { text: 'Start anyway', style: 'destructive', onPress: () => start(st, true) }]); return; }
        throw e;
      }
    }, () => setStarting(0));
  };
  const stop = (st: Station) => Alert.alert(`Stop ${st.name}?`, 'The time goes onto the station\'s bill with any food and drink. You take payment next.', [{ text: 'Not yet', style: 'cancel' }, { text: 'Stop and bill', onPress: () => { void act(st, () => api.post(`/gaming/sessions/${st.session?.session_id}/stop`, stopBody(false, ''), { idempotencyKey: newKey() })); } }]);
  const cancel = (st: Station) => {
    const bad = stopProblem(true, reason);
    if (bad) return setProblem(bad);
    void act(st, () => api.post(`/gaming/sessions/${st.session?.session_id}/stop`, stopBody(true, reason), { idempotencyKey: newKey() }), () => { setVoiding(0); setReason(''); });
  };
  const toOrder = (id: number | null) => { if (id) router.push({ pathname: '/order/[id]', params: { id: String(id) } }); };

  const tile = (st: Station) => {
    const x = st.session;
    const live = st.state === 'RUNNING' || st.state === 'PAUSED';
    const remaining = x && live ? liveRemaining(x, since) : null;
    const warn = timeWarning(remaining, st.alert_minutes ?? 5);
    const food = st.tab && st.tab.fnb_lines > 0 ? st.tab : null;
    const offers = offersFor(bundles.data ?? [], st.kind);
    return (
      <View key={st.station_id} accessibilityLabel={`${st.name}, ${STATE_LABEL[st.state]}`} style={[s.card, { marginHorizontal: 16, marginBottom: 10, gap: 6, borderWidth: 2, borderColor: warn === 'over' ? color.danger : warn === 'soon' ? color.warn : EDGE[st.state] }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flex: 1 }}><Text style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>{st.name}</Text><Soft>{st.label || KIND_LABEL[st.kind] || st.kind}</Soft></View>
          <Text style={{ fontWeight: '700', color: warn === 'over' ? color.danger : warn === 'soon' ? color.warn : st.state === 'AVAILABLE' ? color.ok : color.ink }}>{warn === 'over' ? 'Time up' : warn === 'soon' ? 'Ending soon' : STATE_LABEL[st.state]}</Text>
        </View>

        {live && x ? (
          <>
            {remaining != null ? (
              <Text style={{ fontSize: 34, fontWeight: '700', color: warn === 'over' ? color.danger : color.ink }} accessibilityLabel={warn === 'over' ? 'Over time' : 'Time left'}>{clock(remaining)}</Text>
            ) : (
              <Text style={{ fontSize: 34, fontWeight: '700', color: color.ink }} accessibilityLabel="Time played">{clock(liveElapsed(x, since))}</Text>
            )}
            <Soft>{remaining != null ? `${warn === 'over' ? 'over the booked time' : 'left'} · played ${duration(liveElapsed(x, since))}` : `played${x.status === 'PAUSED' ? ' (paused)' : ''}`}</Soft>
            <Text style={{ color: color.ink }}>{x.bills_time ? `${x.players} player${x.players === 1 ? '' : 's'} · ${rupees(toPaise(x.hour_rate ?? 0))}/hr · ` : ''}<Text style={{ fontWeight: '700' }}>{rupees(toPaise(liveCharge(x, since)))}</Text> so far</Text>
            {x.customer_name || x.player_name || x.game_name ? <Soft>{[x.customer_name || x.player_name, x.game_name].filter(Boolean).join(' · ')}</Soft> : null}
            {x.unit_price > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: color.ink }}>{`${x.unit_label ? x.unit_label[0].toUpperCase() + x.unit_label.slice(1) : 'Frame'}s: `}<Text style={{ fontWeight: '700' }}>{x.units}</Text></Text>
                {desk ? <Button title="+1" kind="quiet" onPress={() => { void act(st, () => post(st, 'units', { delta: 1 })); }} disabled={busy === st.station_id} /> : null}
                {desk && x.units > 0 ? <Button title="-1" kind="quiet" onPress={() => { void act(st, () => post(st, 'units', { delta: -1 })); }} disabled={busy === st.station_id} /> : null}
              </View>
            ) : null}
          </>
        ) : null}

        {st.state === 'TO_BILL' && x ? (
          <>
            <Soft>{`Played ${duration(x.elapsed_seconds)}${x.ended_at ? `, stopped ${timeText(x.ended_at)}` : ''}`}</Soft>
            <Text style={{ fontSize: 26, fontWeight: '700', color: color.ink }}>{rupees((st.tab?.total_paise ?? 0) / 100)}</Text>
            <Soft>{`to collect, with GST${food ? ` · includes ${rupees(food.fnb_paise / 100)} food and drink` : ''}`}</Soft>
          </>
        ) : null}
        {st.state === 'AVAILABLE' ? <Soft>{`${st.max_players} player${st.max_players === 1 ? '' : 's'} at most`}</Soft> : null}
        {st.state === 'RESERVED' && st.next_booking ? <Text style={{ color: color.warn }}>{`Booked at ${timeText(st.next_booking.starts_at)}${st.next_booking.guest_name ? ` for ${st.next_booking.guest_name}` : ''}`}</Text> : null}
        {st.state === 'OUT_OF_SERVICE' ? <Soft>{st.status_note || 'Not in use'}</Soft> : null}
        {food && live ? <Text style={{ color: color.ink }}>{`${rupees(food.fnb_paise / 100)} food and drink · ${food.fnb_items} item${food.fnb_items === 1 ? '' : 's'}`}{food.not_sent ? <Text style={{ color: color.warn }}>{` · ${food.not_sent} not sent`}</Text> : null}{food.ready ? <Text style={{ color: color.ok, fontWeight: '700' }}>{` · ${food.ready} ready`}</Text> : null}</Text> : null}

        {starting === st.station_id ? (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: color.ink }}>Players</Text>
              <Button title="-" kind="quiet" onPress={() => setPlayers((p) => Math.max(1, p - 1))} disabled={players <= 1} />
              <Text style={{ minWidth: 24, textAlign: 'center', fontSize: 18, fontWeight: '700', color: color.ink }}>{players}</Text>
              <Button title="+" kind="quiet" onPress={() => setPlayers((p) => Math.min(st.max_players, p + 1))} disabled={players >= st.max_players} />
            </View>
            <Chips<How> items={[{ id: 'OPEN', label: 'Pay for time used' }, ...(offers.length ? [{ id: 'FIXED' as How, label: 'An offer' }] : [])]} value={how} onChange={setHow} />
            {how === 'FIXED' ? <Chips<string> items={offers.map((b) => ({ id: String(b.bundle_id), label: b.name }))} value={String(bundleId || '')} onChange={(v) => setBundleId(Number(v))} /> : null}
            {how === 'OPEN' ? <><Soft>Alarm when time is nearly up</Soft><Chips<string> items={ALARMS.map((a) => ({ id: a.id || 'none', label: a.label }))} value={alarm || 'none'} onChange={(v) => setAlarm(v === 'none' ? '' : v)} /></> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Start the timer" onPress={() => start(st)} busy={busy === st.station_id} style={{ flex: 1 }} /><Button title="Cancel" kind="quiet" onPress={() => setStarting(0)} /></View>
          </View>
        ) : null}
        {voiding === st.station_id ? (
          <View style={{ gap: 8 }}>
            <Soft>Started by mistake: nothing is charged and nothing goes on the bill. It is kept on record with your reason.</Soft>
            <TextInput style={s.input} value={reason} onChangeText={setReason} placeholder="Why?" accessibilityLabel="Reason for cancelling" />
            <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Cancel the session" kind="danger" onPress={() => cancel(st)} busy={busy === st.station_id} style={{ flex: 1 }} /><Button title="Keep it" kind="quiet" onPress={() => { setVoiding(0); setReason(''); }} /></View>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
          {desk && st.state === 'AVAILABLE' && starting !== st.station_id ? <Button title="Start" onPress={() => open(st)} /> : null}
          {desk && live && voiding !== st.station_id ? (
            <>
              {st.state === 'RUNNING' ? <Button title="Pause" kind="quiet" onPress={() => { void act(st, () => post(st, 'pause')); }} disabled={busy === st.station_id} /> : <Button title="Resume" onPress={() => { void act(st, () => post(st, 'resume')); }} disabled={busy === st.station_id} />}
              <Button title="Stop" kind="quiet" onPress={() => stop(st)} disabled={busy === st.station_id} />
              <Button title="Started by mistake" kind="quiet" onPress={() => { setVoiding(st.station_id); setReason(''); setProblem(''); }} />
            </>
          ) : null}
          {st.state === 'TO_BILL' ? <Button title="Take payment" onPress={() => toOrder(st.order_id)} /> : null}
          {desk && st.state === 'TO_BILL' ? <Button title="Undo stop" kind="quiet" onPress={() => { void act(st, () => post(st, 'reopen')); }} disabled={busy === st.station_id} /> : null}
          {st.order_id && st.state !== 'TO_BILL' && (live || st.state === 'AVAILABLE') ? <Button title={live ? 'Food and drink' : 'Open tab'} kind="quiet" onPress={() => toOrder(st.order_id)} /> : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Lounge board</Title><Soft>Every station and its timer</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <SavedNote at={board.savedAt} />
        <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {board.error && !board.data ? <Failed message={board.error} onRetry={() => { void board.refresh(); }} /> : null}
          {board.busy && !board.data ? <Loading /> : null}
          {board.data ? (
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
              <Stat label="Playing" value={String(countBy(all, 'RUNNING') + countBy(all, 'PAUSED'))} tone={color.brand} />
              <Stat label="Free" value={String(countBy(all, 'AVAILABLE'))} tone={color.ok} />
              <Stat label="To bill" value={String(countBy(all, 'TO_BILL'))} tone={countBy(all, 'TO_BILL') ? color.danger : undefined} />
            </View>
          ) : null}
          {(board.data?.zones ?? []).map((z, i) => (
            <View key={`${z.name}${i}`}>
              {(board.data?.zones.length ?? 0) > 1 ? <SectionTitle>{z.name || 'Main'}</SectionTitle> : null}
              {z.stations.map((st) => tile({ ...st, alert_minutes: board.data?.alert_minutes }))}
            </View>
          ))}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
