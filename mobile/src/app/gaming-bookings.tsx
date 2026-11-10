import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { BOOKING_TEXT, addDays, dateISO, type Booking } from '../lib/gamingDesk.ts';
import { timeOf } from '../lib/gymMembers.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, Empty, ErrorText, Failed, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

/* Bookings for a day: who has a station and when. When they arrive, one tap starts the timer on the booked station. */
export default function GamingBookings() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const [offset, setOffset] = useState('0');
  const day = dateISO(addDays(new Date(), Number(offset)));
  const list = useLoad<Booking[]>(`gaming-bookings:${scope}:${day}`, () => api.get<Booking[]>(`/gaming/bookings?date=${day}`));
  useFocusEffect(useCallback(() => { void list.refresh(); }, [day])); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState('');

  const act = async (b: Booking, path: 'seat' | 'cancel' | 'no-show') => {
    setBusy(b.booking_id); setError('');
    try { await api.post(`/gaming/bookings/${b.booking_id}/${path}`, {}, path === 'seat' ? { idempotencyKey: newKey() } : undefined); await list.refresh(); if (path === 'seat') router.push('/gaming'); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(0); }
  };
  const cancel = (b: Booking) => Alert.alert(t('Cancel this booking?'), `${b.name ?? ''} · ${b.station_name} · ${timeOf(b.starts_at)}`, [{ text: t('No'), style: 'cancel' }, { text: t('Yes, cancel it'), style: 'destructive', onPress: () => { void act(b, 'cancel'); } }]);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Bookings</Title><Soft>Who has a station, and when</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          <Chips items={[{ id: '0', label: 'Today' }, { id: '1', label: 'Tomorrow' }, { id: '2', label: 'Day after' }]} value={offset} onChange={setOffset} />
          <Button title="New booking" onPress={() => router.push({ pathname: '/gaming-booking-new', params: { offset } })} />
          <ErrorText>{error}</ErrorText>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {list.busy && !list.data ? <Loading /> : null}
          {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
          {list.data && list.data.length === 0 ? <Empty>No bookings on this day.</Empty> : null}
          {(list.data ?? []).map((b) => (
            <View key={b.booking_id} style={[s.card, { marginHorizontal: 16, marginTop: 10, gap: 4 }]}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: color.ink }}>{`${timeOf(b.starts_at)} – ${timeOf(b.ends_at)} · ${b.station_name}`}</Text>
              <Text style={{ color: color.ink }}>{`${b.name ?? ''}${b.phone ? ` · ${b.phone}` : ''} · ${t('{n} players', { n: b.players })}`}</Text>
              <Text style={{ color: b.status === 'BOOKED' ? color.brand : b.status === 'SEATED' ? color.ok : color.soft, fontWeight: '600' }}>{t(BOOKING_TEXT[b.status])}</Text>
              {b.note ? <Soft>{b.note}</Soft> : null}
              {b.status === 'BOOKED' ? (
                <View style={{ gap: 8, paddingTop: 6 }}>
                  <Button title="They are here: start the timer" onPress={() => { void act(b, 'seat'); }} busy={busy === b.booking_id} />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button title="Did not come" kind="quiet" onPress={() => { void act(b, 'no-show'); }} disabled={busy !== 0} style={{ flex: 1 }} />
                    <Button title="Cancel" kind="quiet" onPress={() => cancel(b)} disabled={busy !== 0} style={{ flex: 1 }} />
                  </View>
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
