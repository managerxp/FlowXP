import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import type { TableRow } from '../lib/orders.ts';
import { RESERVATION_LABEL, clock, clockToday, freeTables, guestProblem, inMinutes, type Reservation, type WaitEntry } from '../lib/floor.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SavedNote, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

type Tab = 'book' | 'wait';

/* The host's desk: today's bookings (seat them when they arrive) and the walk-in waiting list. */
export default function Reservations() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const bookings = useLoad<Reservation[]>(`reservations:${scope}`, () => api.get<Reservation[]>('/reservations'));
  const waiting = useLoad<WaitEntry[]>(`waitlist:${scope}`, () => api.get<WaitEntry[]>('/waitlist'));
  const floor = useLoad<TableRow[]>(`floor:${scope}`, () => api.get<TableRow[]>('/tables'));
  const [tab, setTab] = useState<Tab>('book');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [party, setParty] = useState('2');
  const [when, setWhen] = useState('');
  const [tableId, setTableId] = useState('0');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState('');
  const [key, setKey] = useState(newKey());   // one booking form, one key: a double tap books once

  const reload = () => { void bookings.refresh(); void waiting.refresh(); void floor.refresh(); };
  const act = async (what: string, work: () => Promise<void>) => {
    setBusy(what); setProblem('');
    try { await work(); reload(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work'); }
    finally { setBusy(''); }
  };
  const done = () => { setAdding(false); setName(''); setPhone(''); setParty('2'); setWhen(''); setTableId('0'); setKey(newKey()); };

  const save = () => {
    const bad = guestProblem(name, party, phone);
    if (bad) return setProblem(bad);
    const body = { guest_name: name.trim(), party_size: Number(party), ...(phone.trim() ? { phone: phone.trim() } : {}) };
    if (tab === 'wait') return void act('save', async () => { await api.call('/waitlist', { method: 'POST', body, idempotencyKey: key }); done(); });
    const at = clockToday(when);
    if (!at) return setProblem('Type the time like 19:30. Today only, and not already past.');
    void act('save', async () => { await api.call('/reservations', { method: 'POST', body: { ...body, reserved_at: at, ...(tableId !== '0' ? { table_id: Number(tableId) } : {}) }, idempotencyKey: key }); done(); });
  };

  const post = async (path: string, body: object = {}) => { await api.call(path, { method: 'POST', body }); };
  const seatWalkIn = (w: WaitEntry) => {
    const free = freeTables(floor.data ?? []);
    if (!free.length) return setProblem('No free table right now.');
    Alert.alert(`Seat ${w.guest_name}`, 'Choose a table', [...free.slice(0, 6).map((t) => ({ text: t.name, onPress: () => { void act(`w${w.entry_id}`, () => post(`/waitlist/${w.entry_id}/seat`, { table_id: t.table_id })); } })), { text: 'Cancel', style: 'cancel' as const }]);
  };
  const sure = (title: string, text: string, go: () => void) => Alert.alert(title, text, [{ text: 'No', style: 'cancel' }, { text: 'Yes', style: 'destructive', onPress: go }]);

  const list = (bookings.data ?? []);
  const live = list.filter((r) => r.status === 'BOOKED' || r.status === 'SEATED');
  const past = list.filter((r) => !live.includes(r));
  const tables = (floor.data ?? []).filter((t) => t.status !== 'CLOSED');

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Bookings and waiting</Title><Soft>{tab === 'book' ? 'Today' : 'Walk-in guests, in order'}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <Chips<Tab> items={[{ id: 'book', label: 'Bookings' }, { id: 'wait', label: 'Waiting list' }]} value={tab} onChange={(x) => { setTab(x); setProblem(''); setAdding(false); }} />
        <SavedNote at={tab === 'book' ? bookings.savedAt : waiting.savedAt} />
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><ErrorText>{problem}</ErrorText></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          {!adding ? <View style={{ padding: 16 }}><Button title={tab === 'book' ? 'Add a booking' : 'Add to waiting list'} onPress={() => { setAdding(true); setProblem(''); }} /></View> : (
            <View style={{ padding: 16, gap: 10 }}>
              <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Guest name" accessibilityLabel="Guest name" autoFocus />
              <TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Mobile number (optional)" accessibilityLabel="Mobile number" />
              <TextInput style={s.input} value={party} onChangeText={setParty} keyboardType="number-pad" placeholder="How many people" accessibilityLabel="How many people" />
              {tab === 'book' ? (
                <>
                  <TextInput style={s.input} value={when} onChangeText={setWhen} placeholder="Time, like 19:30" accessibilityLabel="Time" keyboardType="numbers-and-punctuation" />
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {[30, 60, 120].map((m) => <Button key={m} title={m === 30 ? 'In 30 min' : m === 60 ? 'In 1 hour' : 'In 2 hours'} kind="quiet" onPress={() => setWhen(clock(inMinutes(m)))} />)}
                  </View>
                  <Soft>Table (optional)</Soft>
                  <Chips items={[{ id: '0', label: 'Decide later' }, ...tables.map((t) => ({ id: String(t.table_id), label: t.name }))]} value={tableId} onChange={setTableId} />
                </>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Save" onPress={save} busy={busy === 'save'} style={{ flex: 1 }} />
                <Button title="Cancel" kind="quiet" onPress={done} />
              </View>
            </View>
          )}

          {(bookings.busy && !bookings.data) || (waiting.busy && !waiting.data) ? <Loading /> : null}
          {bookings.error && !bookings.data && tab === 'book' ? <Failed message={bookings.error} onRetry={reload} /> : null}

          {tab === 'book' ? (
            <>
              {bookings.data && live.length === 0 ? <Empty>No bookings today. Tap Add a booking when a guest calls.</Empty> : null}
              {live.map((r) => (
                <View key={r.reservation_id} style={{ padding: 16, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card, gap: 8 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>{clock(r.reserved_at)} · {r.guest_name} · {r.party_size} {r.party_size === 1 ? 'person' : 'people'}</Text>
                  <Soft>{r.table_name ?? 'Table not chosen'}{r.phone ? ` · ${r.phone}` : ''} · {RESERVATION_LABEL[r.status]}</Soft>
                  {r.status === 'BOOKED' ? (
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <Button title="They arrived" busy={busy === `r${r.reservation_id}`} onPress={() => { void act(`r${r.reservation_id}`, () => post(`/reservations/${r.reservation_id}/seat`)); }} />
                      <Button title="Did not come" kind="quiet" onPress={() => sure('Mark as did not come?', `${r.guest_name} will be taken off today's bookings.`, () => { void act(`r${r.reservation_id}`, () => post(`/reservations/${r.reservation_id}/status`, { status: 'NO_SHOW' })); })} />
                      <Button title="Cancel booking" kind="quiet" onPress={() => sure('Cancel this booking?', `${r.guest_name} at ${clock(r.reserved_at)}.`, () => { void act(`r${r.reservation_id}`, () => post(`/reservations/${r.reservation_id}/status`, { status: 'CANCELLED' })); })} />
                    </View>
                  ) : null}
                </View>
              ))}
              {past.length ? <SectionTitle>Done today</SectionTitle> : null}
              {past.map((r) => <Line key={r.reservation_id} left={`${clock(r.reserved_at)} · ${r.guest_name}`} sub={`${r.party_size} · ${RESERVATION_LABEL[r.status]}`} />)}
            </>
          ) : (
            <>
              {waiting.data && waiting.data.length === 0 ? <Empty>Nobody is waiting. Add a walk-in guest when the tables are full.</Empty> : null}
              {(waiting.data ?? []).map((w, i) => (
                <View key={w.entry_id} style={{ padding: 16, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card, gap: 8 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>{i + 1}. {w.guest_name} · {w.party_size} {w.party_size === 1 ? 'person' : 'people'}</Text>
                  <Soft>Waiting {w.waited_min} min{w.quoted_wait_min != null ? ` (told ${w.quoted_wait_min})` : ''}{w.phone ? ` · ${w.phone}` : ''}{w.status === 'NOTIFIED' ? ' · told their table is ready' : ''}</Soft>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <Button title="Seat" busy={busy === `w${w.entry_id}`} onPress={() => seatWalkIn(w)} />
                    {w.status === 'WAITING' ? <Button title="Table is ready" kind="quiet" onPress={() => { void act(`n${w.entry_id}`, () => post(`/waitlist/${w.entry_id}/notify`)); }} /> : null}
                    <Button title="They left" kind="quiet" onPress={() => sure('Mark as left?', `${w.guest_name} comes off the waiting list.`, () => { void act(`l${w.entry_id}`, () => post(`/waitlist/${w.entry_id}/leave`)); })} />
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
