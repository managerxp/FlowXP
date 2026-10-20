import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { rupees } from '../lib/money.ts';
import { HK_LABEL, OCCUPANCY_LABEL, STAY_LABEL, hkChoices, rackFilter, rackSort, stayLine, type HotelDash, type RackFilter, type RackRoom, type StayRow } from '../lib/hotel.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SavedNote, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

type Tab = 'today' | 'house' | 'rooms';

const open = (id: number) => router.push({ pathname: '/hotel-booking/[id]', params: { id: String(id) } });
const owes = (b: StayRow) => (b.balance_paise > 0 ? `${rupees(b.balance_paise)} due` : STAY_LABEL[b.status]);

/* The front desk on a phone: who arrives and leaves today, who is in the house, and the rooms with their housekeeping state. A stay opens to its bill, check-in, payment and check-out. */
export default function Hotel() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const dash = useLoad<HotelDash>(`hotel-dash:${scope}`, () => api.get<HotelDash>('/hotel/dashboard'));
  const date = dash.data?.business_date;
  const arrivals = useLoad<StayRow[]>(`hotel-arr:${scope}:${date}`, async () => (await api.get<{ rows: StayRow[] }>(`/hotel/reports/arrivals?date=${date}`)).rows, Boolean(date));
  const departures = useLoad<StayRow[]>(`hotel-dep:${scope}:${date}`, async () => (await api.get<{ rows: StayRow[] }>(`/hotel/reports/departures?date=${date}`)).rows, Boolean(date));
  const inHouse = useLoad<StayRow[]>(`hotel-house:${scope}`, async () => (await api.get<{ rows: StayRow[] }>('/hotel/reports/in-house')).rows);
  const rack = useLoad<{ business_date: string; rooms: RackRoom[] }>(`hotel-rack:${scope}`, () => api.get('/hotel/rack'));
  const [tab, setTab] = useState<Tab>('today');
  const [filter, setFilter] = useState<RackFilter>('all');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(0);
  const d = dash.data;
  const reload = () => { void dash.refresh(); void arrivals.refresh(); void departures.refresh(); void inHouse.refresh(); void rack.refresh(); };

  const setStatus = async (r: RackRoom, status: string) => {
    setBusy(r.room_id); setProblem('');
    try { await api.call(`/hotel/rooms/${r.room_id}/status`, { method: 'POST', body: { status } }); void rack.refresh(); void dash.refresh(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work'); }
    finally { setBusy(0); }
  };
  const chooseStatus = (r: RackRoom) => Alert.alert(`Room ${r.room_no}`, `Now: ${HK_LABEL[r.hk_status]}. Move it to:`, [...hkChoices(r.hk_status).map((h) => ({ text: HK_LABEL[h], onPress: () => { void setStatus(r, h); } })), { text: 'Cancel', style: 'cancel' as const }]);

  const stays = (list: StayRow[] | null, empty: string) => (
    list && list.length ? list.map((b) => <Line key={b.booking_id} left={`${b.guest_name}${b.is_vip ? '  (VIP)' : ''}`} sub={`${b.res_no} · ${stayLine(b)}`} right={owes(b)} onPress={() => open(b.booking_id)} />) : list ? <Empty>{empty}</Empty> : <Loading />
  );
  const rooms = rackFilter(rackSort(rack.data?.rooms ?? []), filter);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Front desk</Title><Soft>{d ? `Hotel date ${d.business_date}` : 'Today at the hotel'}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
          <Button title="New booking" onPress={() => router.push('/hotel-new')} style={{ flex: 1 }} />
          <Button title="Walk-in" kind="quiet" onPress={() => router.push({ pathname: '/hotel-new', params: { walk: '1' } })} style={{ flex: 1 }} />
        </View>
        <Chips<Tab> items={[{ id: 'today', label: 'Today' }, { id: 'house', label: 'In the house' }, { id: 'rooms', label: 'Rooms' }]} value={tab} onChange={(t) => { setTab(t); setProblem(''); }} />
        <SavedNote at={dash.savedAt} />
        <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          {dash.error && !d ? <Failed message={dash.error} onRetry={reload} /> : null}
          {dash.busy && !d ? <Loading /> : null}
          {tab === 'today' && d ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
                <Stat label="Occupancy" value={`${d.occupancy_pct}%`} note={`${d.rooms_in_house} of ${d.total_rooms - d.out_of_order} rooms`} tone={color.brand} />
                <Stat label="Guests in the house" value={String(d.guests_in_house)} note={`${d.rooms_in_house} rooms`} />
                <Stat label="Arriving" value={String(d.arrivals_due)} note={d.arrivals_late ? `${d.arrivals_late} late, not yet arrived` : 'booked for today'} />
                <Stat label="Leaving" value={String(d.departures_due)} note={`${d.dirty} rooms dirty`} />
              </View>
              <SectionTitle>Arriving today</SectionTitle>
              {stays(arrivals.data, 'Nobody is booked to arrive today.')}
              <SectionTitle>Leaving today</SectionTitle>
              {stays(departures.data, 'Nobody is due to leave today.')}
            </>
          ) : null}
          {tab === 'house' ? (
            <>
              <SectionTitle>{`In the house${inHouse.data ? ` (${inHouse.data.length})` : ''}`}</SectionTitle>
              {stays(inHouse.data, 'Nobody is checked in.')}
            </>
          ) : null}
          {tab === 'rooms' ? (
            <>
              <Chips<RackFilter> items={[{ id: 'all', label: 'All' }, { id: 'dirty', label: 'Dirty' }, { id: 'vacant', label: 'Free to sell' }, { id: 'occupied', label: 'Occupied' }]} value={filter} onChange={setFilter} />
              {rack.error && !rack.data ? <Failed message={rack.error} onRetry={() => { void rack.refresh(); }} /> : null}
              {rack.busy && !rack.data ? <Loading /> : null}
              {rack.data && !rooms.length ? <Empty>No rooms match.</Empty> : null}
              {rooms.map((r) => (
                <Line key={r.room_id} left={`Room ${r.room_no} · ${r.room_type}`}
                  sub={`${OCCUPANCY_LABEL[r.occupancy]}${r.stay_guest ? `: ${r.stay_guest}` : r.next_guest ? `, next ${r.next_guest}` : ''}${r.blocked ? ' · blocked' : ''}`}
                  right={busy === r.room_id ? '…' : HK_LABEL[r.hk_status]} onPress={() => (r.stay_booking_id && r.occupancy !== 'VACANT' ? chooseOrOpen(r, chooseStatus) : chooseStatus(r))} />
              ))}
              <Text style={{ color: color.soft, fontSize: 13, padding: 16 }}>Tap a room to change its housekeeping state. A room with a guest asks first: open the stay or change the state.</Text>
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}

/* A room with a guest in it: open their stay, or change the housekeeping state. */
function chooseOrOpen(r: RackRoom, chooseStatus: (r: RackRoom) => void) {
  Alert.alert(`Room ${r.room_no}`, r.stay_guest ?? '', [
    { text: 'Open the stay', onPress: () => open(r.stay_booking_id as number) },
    { text: 'Change housekeeping', onPress: () => chooseStatus(r) },
    { text: 'Cancel', style: 'cancel' }
  ]);
}
