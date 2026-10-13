import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { rupees } from '../lib/money.ts';
import { PAY_LABEL, PAY_METHODS, type HotelDash, type PayMethod } from '../lib/hotel.ts';
import { departureFor, freeRoomsPath, quotePath, stayBody, stayProblem, type FreeRoom, type GuestHit, type Quote, type RatePlan, type RoomType, type StayForm } from '../lib/hotelDesk.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* A new booking, or a walk-in who is arriving now. Choose the guest, the dates, the room type and how many rooms; the price comes from the server before anything is saved. */
export default function HotelNew() {
  const { walk } = useLocalSearchParams<{ walk?: string }>();
  const walkIn = walk === '1';
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const dash = useLoad<HotelDash>(`hotel-dash:${scope}`, () => api.get<HotelDash>('/hotel/dashboard'));
  const types = useLoad<RoomType[]>(`hotel-types:${scope}`, () => api.get<RoomType[]>('/hotel/room-types'));
  const plans = useLoad<RatePlan[]>(`hotel-plans:${scope}`, () => api.get<RatePlan[]>('/hotel/rate-plans'));
  const today = dash.data?.business_date ?? '';
  const [f, setF] = useState<StayForm>({ guestId: null, name: '', phone: '', arrival: '', nights: 1, roomTypeId: null, rooms: 1, adults: 2, children: 0, ratePlanId: null, roomId: null, advance: '', method: '', notes: '' });
  const set = <K extends keyof StayForm>(k: K, v: StayForm[K]) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { if (today && !f.arrival) set('arrival', today); }, [today]);   // eslint-disable-line react-hooks/exhaustive-deps

  const [find, setFind] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(find), 300); return () => clearTimeout(t); }, [find]);
  const hits = useLoad<GuestHit[]>(`hotel-guests:${scope}:${q}`, () => api.get<GuestHit[]>(`/hotel/guests?q=${encodeURIComponent(q.trim())}`), q.trim().length >= 2 && !f.guestId);
  const quote = useLoad<Quote>(`hotel-quote:${scope}:${quotePath(f)}`, () => api.get<Quote>(quotePath(f) as string), quotePath(f) !== null);
  const departure = f.arrival ? departureFor(f.arrival, f.nights) : '';
  const free = useLoad<FreeRoom[]>(`hotel-free:${scope}:${f.roomTypeId}:${f.arrival}:${departure}`, () => api.get<FreeRoom[]>(freeRoomsPath(f.roomTypeId as number, f.arrival, departure)), Boolean(f.roomTypeId && f.arrival && f.rooms === 1));

  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey());   // one form, one key: a double tap books once
  const save = async (allowDirty = false) => {
    const bad = stayProblem(f, today, walkIn);
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const made = await api.post<{ booking_id: number }>(walkIn ? '/hotel/walk-ins' : '/hotel/bookings', stayBody(f, walkIn, allowDirty), { idempotencyKey: allowDirty ? newKey() : key });
      setKey(newKey());
      router.replace({ pathname: '/hotel-booking/[id]', params: { id: String(made.booking_id) } });
    } catch (e) {
      // a room that has not been cleaned yet: the desk may still give it, after being told
      if (e instanceof ApiError && e.code === 'ROOM_DIRTY') Alert.alert('The room is not clean yet', `${e.message}
Give it anyway?`, [{ text: 'Wait', style: 'cancel' }, { text: 'Give it anyway', onPress: () => { void save(true); } }]);
      else setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not save the booking');
    }
    finally { setBusy(false); }
  };

  const count = (label: string, value: number, key2: 'nights' | 'rooms' | 'adults' | 'children', min: number, max: number) => (
    <View style={{ flex: 1, minWidth: 140, gap: 4 }}>
      <Soft>{label}</Soft>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Button title="-" kind="quiet" onPress={() => set(key2, Math.max(min, value - 1))} disabled={value <= min} />
        <Text accessibilityLiveRegion="polite" style={{ minWidth: 28, textAlign: 'center', fontSize: 18, fontWeight: '700', color: color.ink }}>{value}</Text>
        <Button title="+" kind="quiet" onPress={() => set(key2, Math.min(max, value + 1))} disabled={value >= max} />
      </View>
    </View>
  );
  const type = (types.data ?? []).find((t) => t.room_type_id === f.roomTypeId);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{walkIn ? 'Walk-in guest' : 'New booking'}</Title><Soft>{walkIn ? 'Arriving now, no booking' : 'A guest who will arrive later'}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {dash.error && !dash.data ? <Failed message={dash.error} onRetry={() => { void dash.refresh(); }} /> : null}
          {dash.busy && !dash.data ? <Loading /> : null}

          <SectionTitle>Guest</SectionTitle>
          {f.guestId ? (
            <View style={[s.card, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
              <Text style={{ color: color.ink, fontWeight: '600' }}>{f.name}{f.phone ? ` · ${f.phone}` : ''}</Text>
              <Button title="Change" kind="quiet" onPress={() => { set('guestId', null); set('name', ''); set('phone', ''); setFind(''); }} />
            </View>
          ) : (
            <>
              <TextInput style={s.input} value={find} onChangeText={(t) => { setFind(t); set('name', t); }} placeholder="Guest name, or search a guest you know" accessibilityLabel="Guest name" />
              {(hits.data ?? []).map((g) => <Line key={g.guest_id} left={`${g.name}${g.is_vip ? '  (VIP)' : ''}`} sub={g.phone ?? 'No phone'} onPress={() => { setF((x) => ({ ...x, guestId: g.guest_id, name: g.name, phone: g.phone ?? '' })); }} />)}
              <TextInput style={s.input} value={f.phone} onChangeText={(t) => set('phone', t)} keyboardType="phone-pad" placeholder="Mobile number (optional)" accessibilityLabel="Mobile number" />
            </>
          )}

          <SectionTitle>Stay</SectionTitle>
          <TextInput style={s.input} value={f.arrival} onChangeText={(t) => set('arrival', t)} placeholder={walkIn ? 'Arriving' : 'Arrival, like 2026-10-20'} accessibilityLabel="Arrival date" editable={!walkIn} autoCapitalize="none" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {count('Nights', f.nights, 'nights', 1, 60)}
            {count('Rooms', f.rooms, 'rooms', 1, 5)}
            {count('Adults', f.adults, 'adults', 1, 20)}
            {count('Children', f.children, 'children', 0, 20)}
          </View>
          {departure ? <Soft>{`Leaves on ${departure}`}</Soft> : null}

          <SectionTitle>Room type</SectionTitle>
          {types.error && !types.data ? <Failed message={types.error} onRetry={() => { void types.refresh(); }} /> : null}
          {types.data ? <Chips<string> items={types.data.map((t) => ({ id: String(t.room_type_id), label: `${t.name} · ${rupees(Math.round(t.base_rate * 100))}` }))} value={String(f.roomTypeId ?? '')} onChange={(id) => setF((x) => ({ ...x, roomTypeId: Number(id), roomId: null }))} /> : null}
          {plans.data && plans.data.length > 1 ? (
            <>
              <Soft>Rate plan</Soft>
              <Chips<string> items={[{ id: '0', label: 'Standard' }, ...plans.data.map((p) => ({ id: String(p.rate_plan_id), label: p.name }))]} value={String(f.ratePlanId ?? 0)} onChange={(id) => set('ratePlanId', Number(id) || null)} />
            </>
          ) : null}
          {f.rooms === 1 && f.roomTypeId && (free.data ?? []).length ? (
            <>
              <Soft>Room number{walkIn ? '' : ' (optional, otherwise it is chosen at check-in)'}</Soft>
              <Chips<string> items={[...(walkIn ? [] : [{ id: '0', label: 'Later' }]), ...(free.data ?? []).slice(0, 12).map((r) => ({ id: String(r.room_id), label: `${r.room_no}${r.hk_status === 'DIRTY' ? ' (dirty)' : ''}` }))]} value={String(f.roomId ?? 0)} onChange={(id) => set('roomId', Number(id) || null)} />
            </>
          ) : null}
          {f.roomTypeId && free.data && free.data.length === 0 ? <Text style={{ color: color.warn }}>{`No ${type?.name ?? 'room'} is free on these dates. The server will say if it can still be booked.`}</Text> : null}

          {quote.data ? (
            <View style={[s.card, { gap: 2 }]}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>{rupees(quote.data.total_paise * f.rooms)} before GST</Text>
              <Soft>{`${quote.data.nights.length} night${quote.data.nights.length === 1 ? '' : 's'} x ${f.rooms} room${f.rooms === 1 ? '' : 's'}, ${quote.data.room_type}. The final bill with GST comes from FlowXP.`}</Soft>
            </View>
          ) : quote.error ? <Text style={{ color: color.warn }}>{quote.error}</Text> : null}

          <SectionTitle>Advance and notes</SectionTitle>
          <TextInput style={s.input} value={f.advance} onChangeText={(t) => set('advance', t)} keyboardType="decimal-pad" placeholder="Advance in rupees (optional)" accessibilityLabel="Advance" />
          {Number(f.advance) > 0 ? <Chips<PayMethod | 'x'> items={PAY_METHODS.map((m) => ({ id: m, label: PAY_LABEL[m] }))} value={f.method || 'x'} onChange={(m) => set('method', m === 'x' ? '' : m)} /> : null}
          <TextInput style={s.input} value={f.notes} onChangeText={(t) => set('notes', t)} placeholder="Notes (optional)" accessibilityLabel="Notes" />

          <ErrorText>{problem}</ErrorText>
          <Button title={walkIn ? 'Check them in' : 'Save the booking'} onPress={() => { void save(); }} busy={busy} />
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
