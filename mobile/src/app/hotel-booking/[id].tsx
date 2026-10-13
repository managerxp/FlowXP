import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../../lib/api.ts';
import { api, useSession } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { rupees } from '../../lib/money.ts';
import { PAY_LABEL, PAY_METHODS, STAY_LABEL, checkInBody, checkInProblem, checkOutBody, checkOutProblem, paymentBody, paymentProblem, type BookingDetail, type Folio, type HotelDash, type PayMethod } from '../../lib/hotel.ts';
import { DEPARTMENTS, canCancel, canNoShow, chargeBody, chargeProblem, freeRoomsPath, movableRooms, moveBody, reasonBody, reasonProblem, type FreeRoom } from '../../lib/hotelDesk.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, Chips, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

const paise = (n: number | string) => rupees(Number(n));
type Mode = '' | 'pay' | 'out' | 'charge' | 'cancel' | 'move' | 'void';

/* One stay: the guest, the rooms, the bill so far, and what the desk does with it: choose room numbers and check in, take a payment or an advance, add a charge,
   move to another room, cancel, mark a no-show, check out. The server works out every figure. */
export default function HotelBooking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const booking = useLoad<BookingDetail>(`hotel-booking:${id}`, () => api.get<BookingDetail>(`/hotel/bookings/${id}`));
  const folio = useLoad<Folio>(`hotel-folio:${id}`, () => api.get<Folio>(`/hotel/bookings/${id}/folio`));
  const dash = useLoad<HotelDash>(`hotel-dash:${scope}`, () => api.get<HotelDash>('/hotel/dashboard'));
  const b = booking.data;
  const t = folio.data?.totals;
  const today = dash.data?.business_date ?? '';
  const [mode, setMode] = useState<Mode>('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod | ''>('');
  const [reference, setReference] = useState('');
  const [kind, setKind] = useState<'PAYMENT' | 'ADVANCE'>('PAYMENT');
  const [text, setText] = useState('');       // charge description, or a reason
  const [dept, setDept] = useState('FNB');
  const [qtyText, setQtyText] = useState('1');
  const [gst, setGst] = useState('');
  const [rr, setRr] = useState(0);            // the room line being moved
  const [target, setTarget] = useState(0);    // the room it moves to
  const [voiding, setVoiding] = useState(0);
  const [due, setDue] = useState<number | null>(null);   // what the server says is owed at check-out (room charges are added as the bill is closed)
  const [picked, setPicked] = useState<Record<number, number>>({});   // room numbers chosen at check-in, by room line
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState('');
  const [key, setKey] = useState(newKey());   // one form, one key: a double tap records once

  const reload = () => { void booking.refresh(); void folio.refresh(); };
  const reset = () => { setDue(null); setMode(''); setAmount(''); setMethod(''); setReference(''); setText(''); setQtyText('1'); setGst(''); setRr(0); setTarget(0); setVoiding(0); setProblem(''); setKey(newKey()); };
  const run = async (what: string, work: () => Promise<void>, after?: () => void) => {
    setBusy(what); setProblem('');
    try { await work(); after?.(); reload(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work'); }
    finally { setBusy(''); }
  };

  const bad = b ? checkInProblem(b, picked) : '';
  const checkIn = () => {
    if (bad) return setProblem(bad);
    const go = (allowDirty: boolean) => run('in', async () => {
      try { await api.call(`/hotel/bookings/${id}/check-in`, { method: 'POST', body: checkInBody(picked, allowDirty) }); setPicked({}); }
      catch (e) {
        // a room that has not been cleaned yet: the desk may still give it, after being told
        if (e instanceof ApiError && e.code === 'ROOM_DIRTY') { Alert.alert('The room is not clean yet', `${e.message}
Check in anyway?`, [{ text: 'Wait', style: 'cancel' }, { text: 'Check in anyway', onPress: () => { void go(true); } }]); return; }
        throw e;
      }
    });
    Alert.alert(`Check in ${b?.guest_name}`, 'The rooms are given to the guest.', [{ text: 'Not now', style: 'cancel' }, { text: 'Check in', onPress: () => { void go(false); } }]);
  };
  const pay = () => {
    const p = paymentProblem(amount, method);
    if (p) return setProblem(p);
    void run('pay', async () => { await api.call(`/hotel/bookings/${id}/payments`, { method: 'POST', body: paymentBody(amount, method as PayMethod, reference, kind), idempotencyKey: key }); }, reset);
  };
  const balance = due ?? t?.balance_paise ?? b?.balance_paise ?? 0;
  const checkOut = () => {
    const p = checkOutProblem(balance, method);
    if (p) return setProblem(p);
    void run('out', async () => {
      try { await api.call(`/hotel/bookings/${id}/check-out`, { method: 'POST', body: checkOutBody(balance, method, reference), idempotencyKey: key }); }
      catch (e) {
        // the final bill has more on it than the folio showed: say how much, and ask how it is paid
        const owed = e instanceof ApiError && e.code === 'BALANCE_DUE' ? Number((e.data as { balance_paise?: number } | undefined)?.balance_paise) : NaN;
        if (Number.isFinite(owed)) { setDue(owed); setKey(newKey()); throw new ApiError(`${paise(owed)} is still to be paid. Choose how, then check out again.`, 409); }
        throw e;
      }
    }, reset);
  };
  const addCharge = () => {
    const p = chargeProblem(text, amount, qtyText, gst);
    if (p) return setProblem(p);
    void run('charge', async () => { await api.call(`/hotel/bookings/${id}/charges`, { method: 'POST', body: chargeBody(dept, text, amount, qtyText, gst), idempotencyKey: key }); }, reset);
  };
  const voidCharge = () => {
    const p = reasonProblem(text);
    if (p) return setProblem(p);
    void run('void', async () => { await api.call(`/hotel/charges/${voiding}/void`, { method: 'POST', body: reasonBody(text) }); }, reset);
  };
  const cancel = () => {
    const p = reasonProblem(text);
    if (p) return setProblem(p);
    void run('cancel', async () => { await api.call(`/hotel/bookings/${id}/cancel`, { method: 'POST', body: reasonBody(text) }); }, reset);
  };
  const noShow = () => Alert.alert('Mark as no-show?', 'The guest did not arrive. The rooms are released.', [{ text: 'No', style: 'cancel' }, { text: 'Mark no-show', style: 'destructive', onPress: () => { void run('noshow', async () => { await api.call(`/hotel/bookings/${id}/no-show`, { method: 'POST', body: {} }); }); } }]);
  const move = () => {
    if (!rr || !target) return setProblem('Choose the room to move, and where to.');
    void run('move', async () => { await api.call(`/hotel/bookings/${id}/move-room`, { method: 'POST', body: moveBody(rr, target, text) }); }, reset);
  };

  const methodChips = <Chips<PayMethod | 'x'> items={PAY_METHODS.map((m) => ({ id: m, label: PAY_LABEL[m] }))} value={method || 'x'} onChange={(m) => setMethod(m === 'x' ? '' : m)} />;
  const live = b ? b.rooms.filter((r) => r.status !== 'CANCELLED') : [];
  const movable = b ? movableRooms(b) : [];
  const moving = movable.find((r) => r.rr_id === rr);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{b ? b.guest_name : 'Stay'}</Title><Soft>{b ? `${b.res_no} · ${STAY_LABEL[b.status]}${b.is_vip ? ' · VIP' : ''}` : ' '}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {booking.error && !b ? <Failed message={booking.error} onRetry={reload} /> : null}
          {booking.busy && !b ? <Loading /> : null}
          {b ? (
            <>
              <View style={{ paddingHorizontal: 16, gap: 2 }}>
                <Text style={{ color: color.ink, fontSize: 16 }}>{b.arrival} to {b.departure}</Text>
                {b.guest_phone ? <Soft>{b.guest_phone}</Soft> : null}
                {b.rate_plan ? <Soft>{`Rate plan: ${b.rate_plan}`}</Soft> : null}
                {b.notes ? <Soft>{b.notes}</Soft> : null}
              </View>
              <SectionTitle>Rooms</SectionTitle>
              {live.map((r) => (
                <View key={r.rr_id}>
                  <Line left={r.room_no ? `Room ${r.room_no}` : `${r.room_type}, no room number yet`} sub={`${r.room_type} · ${r.adults} adult${r.adults === 1 ? '' : 's'}${r.children ? `, ${r.children} child${r.children === 1 ? '' : 'ren'}` : ''}`} right={r.room_id ? r.status.replace('_', ' ').toLowerCase() : picked[r.rr_id] ? 'chosen' : 'choose below'} />
                  {b.status === 'CONFIRMED' && !r.room_id ? <RoomPicker line={r} arrival={b.arrival} departure={b.departure} value={picked[r.rr_id] ?? 0} onPick={(roomId) => setPicked((p) => ({ ...p, [r.rr_id]: roomId }))} taken={Object.entries(picked).filter(([k]) => Number(k) !== r.rr_id).map(([, v]) => v)} /> : null}
                </View>
              ))}
              <SectionTitle>Bill so far</SectionTitle>
              {folio.error && !folio.data ? <Failed message={folio.error} onRetry={() => { void folio.refresh(); }} /> : null}
              {folio.data ? (
                <>
                  {folio.data.charges.filter((c) => !c.voided_at).map((c) => <Line key={c.charge_id} left={c.description} sub={`${c.department.toLowerCase().replace('_', ' ')}${c.room_no ? ` · room ${c.room_no}` : ''}${b.status === 'CHECKED_IN' ? ' · tap to void' : ''}`} right={paise(Number(c.amount_paise) + Number(c.tax_paise))} onPress={b.status === 'CHECKED_IN' ? () => { reset(); setVoiding(c.charge_id); setMode('void'); } : undefined} />)}
                  {folio.data.payments.map((p) => <Line key={`p${p.fp_id}`} left={`${p.kind === 'REFUND' ? 'Refund' : p.kind === 'ADVANCE' ? 'Advance' : 'Payment'} · ${PAY_LABEL[p.method] ?? p.method}`} sub={String(p.pay_date).slice(0, 10)} right={`${p.kind === 'REFUND' ? '-' : ''}${paise(p.amount_paise)}`} />)}
                  {t ? (
                    <View style={{ padding: 16, gap: 2 }}>
                      <Text style={{ color: color.ink }}>{`Charges ${paise(t.charges_paise)} · paid ${paise(t.paid_paise)}`}</Text>
                      <Text style={{ fontSize: 20, fontWeight: '700', color: t.balance_paise > 0 ? color.warn : color.ink }}>{t.balance_paise > 0 ? `${paise(t.balance_paise)} to collect` : t.balance_paise < 0 ? `${paise(-t.balance_paise)} to refund` : 'Nothing owing'}</Text>
                    </View>
                  ) : null}
                </>
              ) : null}

              <View style={{ paddingHorizontal: 16, gap: 10 }}>
                <ErrorText>{problem}</ErrorText>
                {b.status === 'CONFIRMED' ? <Button title="Check in" onPress={checkIn} busy={busy === 'in'} disabled={Boolean(bad)} /> : null}
                {b.status === 'CONFIRMED' && bad ? <Soft>{bad}</Soft> : null}
                {b.status === 'CHECKED_IN' || b.status === 'CONFIRMED' ? <Button title={b.status === 'CONFIRMED' ? 'Take an advance' : 'Take a payment'} kind="quiet" onPress={() => { reset(); setKind(b.status === 'CONFIRMED' ? 'ADVANCE' : 'PAYMENT'); setMode('pay'); }} /> : null}
                {b.status === 'CHECKED_IN' ? <Button title="Add a charge" kind="quiet" onPress={() => { reset(); setMode('charge'); }} /> : null}
                {movable.length ? <Button title="Move to another room" kind="quiet" onPress={() => { reset(); if (movable.length === 1) setRr(movable[0].rr_id); setMode('move'); }} /> : null}
                {b.status === 'CHECKED_IN' ? <Button title="Check out" kind="quiet" onPress={() => { reset(); setMode('out'); }} /> : null}
                {today && canNoShow(b, today) ? <Button title="Mark as no-show" kind="quiet" onPress={noShow} busy={busy === 'noshow'} /> : null}
                {canCancel(b) ? <Button title="Cancel the booking" kind="danger" onPress={() => { reset(); setMode('cancel'); }} /> : null}

                {mode === 'pay' ? (
                  <View style={{ gap: 10 }}>
                    <TextInput style={s.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Amount in rupees" accessibilityLabel="Amount" />
                    {methodChips}
                    <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="Reference (optional)" accessibilityLabel="Reference" />
                    <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Record" onPress={pay} busy={busy === 'pay'} style={{ flex: 1 }} /><Button title="Cancel" kind="quiet" onPress={reset} /></View>
                  </View>
                ) : null}
                {mode === 'charge' ? (
                  <View style={{ gap: 10 }}>
                    <Chips<string> items={DEPARTMENTS.map(([k, l]) => ({ id: k, label: l }))} value={dept} onChange={setDept} />
                    <TextInput style={s.input} value={text} onChangeText={setText} placeholder="What is it for? (Laundry, minibar, taxi)" accessibilityLabel="What the charge is for" />
                    <TextInput style={s.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Price in rupees, each" accessibilityLabel="Price" />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TextInput style={[s.input, { flex: 1 }]} value={qtyText} onChangeText={setQtyText} keyboardType="decimal-pad" placeholder="Quantity" accessibilityLabel="Quantity" />
                      <TextInput style={[s.input, { flex: 1 }]} value={gst} onChangeText={setGst} keyboardType="decimal-pad" placeholder="GST % (0 if none)" accessibilityLabel="GST percent" />
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Add to the bill" onPress={addCharge} busy={busy === 'charge'} style={{ flex: 1 }} /><Button title="Cancel" kind="quiet" onPress={reset} /></View>
                  </View>
                ) : null}
                {mode === 'void' ? (
                  <View style={{ gap: 10 }}>
                    <Soft>Take this charge off the bill. It stays in the record with your reason.</Soft>
                    <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Why?" accessibilityLabel="Reason" />
                    <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Void the charge" kind="danger" onPress={voidCharge} busy={busy === 'void'} style={{ flex: 1 }} /><Button title="Cancel" kind="quiet" onPress={reset} /></View>
                  </View>
                ) : null}
                {mode === 'cancel' ? (
                  <View style={{ gap: 10 }}>
                    <Soft>Any advance paid stays on the bill to be refunded.</Soft>
                    <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Why is it cancelled?" accessibilityLabel="Reason" />
                    <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Cancel the booking" kind="danger" onPress={cancel} busy={busy === 'cancel'} style={{ flex: 1 }} /><Button title="Keep it" kind="quiet" onPress={reset} /></View>
                  </View>
                ) : null}
                {mode === 'move' ? (
                  <View style={{ gap: 10 }}>
                    {movable.length > 1 ? <Chips<string> items={movable.map((r) => ({ id: String(r.rr_id), label: `Room ${r.room_no}` }))} value={String(rr)} onChange={(v) => { setRr(Number(v)); setTarget(0); }} /> : null}
                    {moving ? <RoomPicker line={moving} arrival={moving.status === 'IN_HOUSE' && today ? today : b.arrival} departure={b.departure} excludeRr={moving.rr_id} value={target} onPick={setTarget} taken={[]} label={`Move room ${moving.room_no} to`} /> : null}
                    <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Why? (optional)" accessibilityLabel="Reason for moving" />
                    <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Move guest" onPress={move} busy={busy === 'move'} style={{ flex: 1 }} /><Button title="Cancel" kind="quiet" onPress={reset} /></View>
                  </View>
                ) : null}
                {mode === 'out' ? (
                  <View style={{ gap: 10 }}>
                    <Soft>{balance > 0 ? `Collect ${paise(balance)} now and make the GST invoice.` : balance < 0 ? `Refund ${paise(-balance)}, then make the GST invoice.` : 'Nothing is owing. The GST invoice is made.'}</Soft>
                    {balance !== 0 ? methodChips : null}
                    {balance > 0 ? <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="Reference (optional)" accessibilityLabel="Reference" /> : null}
                    <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Check out" onPress={checkOut} busy={busy === 'out'} style={{ flex: 1 }} /><Button title="Cancel" kind="quiet" onPress={reset} /></View>
                  </View>
                ) : null}
              </View>
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}

/* The rooms of the same type that are free for these dates, to choose one. */
function RoomPicker({ line, arrival, departure, excludeRr, value, onPick, taken, label }: { line: { rr_id: number; room_type: string }; arrival: string; departure: string; excludeRr?: number; value: number; onPick: (roomId: number) => void; taken: number[]; label?: string }) {
  const typeId = useLoad<{ room_type_id: number }[]>('hotel-room-types-lookup', () => api.get<{ room_type_id: number; name: string }[]>('/hotel/room-types'));
  const id = (typeId.data as { room_type_id: number; name: string }[] | null)?.find((t) => t.name === line.room_type)?.room_type_id;
  const free = useLoad<FreeRoom[]>(`hotel-free-line:${line.rr_id}:${arrival}:${departure}`, () => api.get<FreeRoom[]>(freeRoomsPath(id as number, arrival, departure, excludeRr)), Boolean(id));
  const rooms = (free.data ?? []).filter((r) => !taken.includes(r.room_id));
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 6 }}>
      <Soft>{label ?? `Choose a ${line.room_type} room`}</Soft>
      {free.error ? <Text style={{ color: color.warn }}>{free.error}</Text> : null}
      {free.data && rooms.length === 0 ? <Text style={{ color: color.warn }}>No room of this type is free for these dates.</Text> : null}
      <Chips<string> items={rooms.slice(0, 20).map((r) => ({ id: String(r.room_id), label: `${r.room_no}${r.hk_status === 'DIRTY' ? ' (dirty)' : ''}` }))} value={String(value || '')} onChange={(v) => onPick(Number(v))} />
    </View>
  );
}
