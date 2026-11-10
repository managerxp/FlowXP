import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { BOOKING_TEXT, rowsOf, timeOf, todayISO, type Booking, type ClassSession } from '../lib/gymMembers.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Empty, ErrorText, Failed, Line, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

/* Today's classes: who is booked, and mark each person as came or did not come. */
export default function GymClasses() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const today = todayISO();
  const list = useLoad<ClassSession[]>(`gym-classes:${scope}:${today}`, () => api.get<ClassSession[] | { rows: ClassSession[] }>(`/gym/classes?from=${today}&to=${today}`).then(rowsOf));
  const [open, setOpen] = useState<number | null>(null);
  const people = useLoad<Booking[]>(`gym-bookings:${scope}:${open}`, () => api.get<Booking[] | { rows: Booking[] }>(`/gym/classes/${open}/bookings`).then(rowsOf), open !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mark = async (b: Booking, status: 'ATTENDED' | 'NO_SHOW') => {
    setBusy(true); setError('');
    try { await api.post(`/gym/bookings/${b.booking_id}/attendance`, { status }, { idempotencyKey: newKey() }); await people.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };
  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Classes today</Title><Soft>Tap a class to see who booked</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {list.busy && !list.data ? <Loading /> : null}
          {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
          {list.data && list.data.length === 0 ? <Empty>No classes today.</Empty> : null}
          {(list.data ?? []).map((c) => (
            <View key={c.session_id}>
              <Line left={c.class_name} sub={[`${timeOf(c.starts_at)} – ${timeOf(c.ends_at)}`, c.trainer_name, c.room].filter(Boolean).join(' · ')} right={`${c.booked}/${c.capacity}`} selected={open === c.session_id} onPress={() => { setOpen(open === c.session_id ? null : c.session_id); setError(''); }} />
              {open === c.session_id ? (
                <View style={{ paddingHorizontal: 16, paddingBottom: 8, backgroundColor: color.card }}>
                  {people.busy && !people.data ? <Loading /> : null}
                  {people.data && people.data.length === 0 ? <Soft style={{ padding: 12 }}>Nobody has booked yet.</Soft> : null}
                  {(people.data ?? []).filter((b) => b.status !== 'CANCELLED').map((b) => (
                    <View key={b.booking_id} style={{ paddingVertical: 8, gap: 6 }}>
                      <Text style={{ color: color.ink, fontSize: 16 }}>{b.member_name}<Text style={{ color: color.soft }}>{`  ${t(BOOKING_TEXT[b.status])}`}</Text></Text>
                      {b.status === 'BOOKED' || b.status === 'ATTENDED' || b.status === 'NO_SHOW' ? (
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <Button title="Came" kind={b.status === 'ATTENDED' ? 'primary' : 'quiet'} onPress={() => { void mark(b, 'ATTENDED'); }} disabled={busy} style={{ flex: 1 }} />
                          <Button title="Did not come" kind={b.status === 'NO_SHOW' ? 'primary' : 'quiet'} onPress={() => { void mark(b, 'NO_SHOW'); }} disabled={busy} style={{ flex: 1 }} />
                        </View>
                      ) : null}
                    </View>
                  ))}
                  <ErrorText>{error}</ErrorText>
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
