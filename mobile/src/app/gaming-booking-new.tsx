import { useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { DURATIONS, addDays, bookingBody, bookingProblem, slotsFor, type StationLite } from '../lib/gamingDesk.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, ErrorText, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* A new booking: pick the station, the day and start time, how long, and who it is for. The server refuses a clash and says who has the slot. */
export default function GamingBookingNew() {
  const { offset } = useLocalSearchParams<{ offset?: string }>();
  const session = useSession();
  const stations = useLoad<StationLite[]>(`gaming-stations:${session.businessId}:${session.branchId}`, () => api.get<StationLite[]>('/gaming/stations'));
  const [stationId, setStationId] = useState<number | null>(null);
  const [dayOff, setDayOff] = useState(offset ?? '0');
  const [startsAt, setStartsAt] = useState('');
  const [mins, setMins] = useState('60');
  const [players, setPlayers] = useState('1');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const slots = useMemo(() => slotsFor(addDays(new Date(), Number(dayOff))), [dayOff]);
  const list = (stations.data ?? []).filter((x) => x.status !== 'ARCHIVED' && x.status !== 'OUT_OF_SERVICE');

  const save = async () => {
    const bad = bookingProblem(stationId, startsAt, name);
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError('');
    try { await api.post('/gaming/bookings', bookingBody(stationId as number, startsAt, Number(mins), Math.max(1, Number(players) || 1), name, phone, note)); router.back(); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };
  const field = (label: string, v: string, on: (x: string) => void, o: { keyboard?: 'default' | 'phone-pad' | 'number-pad'; max?: number } = {}) => (
    <View style={{ gap: 4 }}>
      <Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>
      <TextInput style={s.input} value={v} onChangeText={on} keyboardType={o.keyboard ?? 'default'} maxLength={o.max} autoCorrect={false} accessibilityLabel={t(label)} />
    </View>
  );
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>New booking</Title><Button title="Cancel" kind="quiet" onPress={() => goBack()} /></View>
          <SectionTitle>Station</SectionTitle>
          {stations.busy && !stations.data ? <Loading /> : null}
          {list.map((x) => <Line key={x.station_id} left={x.name} sub={t('Up to {n} players', { n: x.max_players })} selected={x.station_id === stationId} onPress={() => setStationId(x.station_id)} />)}
          <SectionTitle>Day and start time</SectionTitle>
          <Chips items={[{ id: '0', label: 'Today' }, { id: '1', label: 'Tomorrow' }, { id: '2', label: 'Day after' }]} value={dayOff} onChange={(v) => { setDayOff(v); setStartsAt(''); }} />
          {slots.length === 0 ? <Soft>No start times left today. Choose another day.</Soft> : <Chips items={slots} value={startsAt} onChange={setStartsAt} />}
          <SectionTitle>How long</SectionTitle>
          <Chips items={DURATIONS} value={mins} onChange={setMins} />
          {field('Players', players, (v) => setPlayers(v.replace(/\D/g, '')), { keyboard: 'number-pad', max: 2 })}
          {field('Booked for (name)', name, setName, { max: 60 })}
          {field('Mobile number (optional)', phone, setPhone, { keyboard: 'phone-pad', max: 16 })}
          {field('Note (optional)', note, setNote, { max: 200 })}
          <ErrorText>{error}</ErrorText>
          <Button title="Save booking" onPress={() => { void save(); }} busy={busy} />
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
