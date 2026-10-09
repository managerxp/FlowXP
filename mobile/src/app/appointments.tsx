import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { APPOINTMENT_LABEL, NEXT, canBill, canCancel, canNoShow, type Appointment } from '../lib/salon.ts';
import { clock } from '../lib/floor.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Loading, SavedNote, Soft, Title, color, s } from '../lib/ui.tsx';

type Day = 'today' | 'tomorrow';
const dayText = (d: Day) => { const x = new Date(); if (d === 'tomorrow') x.setDate(x.getDate() + 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const TONE: Record<Appointment['status'], string> = { BOOKED: color.warn, CONFIRMED: color.brand, CHECKED_IN: color.ok, IN_SERVICE: color.ok, COMPLETED: color.soft, CANCELLED: color.danger, NO_SHOW: color.danger };

/* The front desk: who is booked, who has arrived, who is in the chair. Bill a visit straight from here. Booking new appointments is on the FlowXP website for now. */
export default function Appointments() {
  const session = useSession();
  const [day, setDay] = useState<Day>('today');
  const list = useLoad<Appointment[]>(`appointments:${session.businessId}:${session.branchId}:${day}`, () => api.get<Appointment[]>(`/salon/appointments?date=${dayText(day)}`));
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(0);

  const move = async (a: Appointment, status: string, reason?: string) => {
    setBusy(a.appointment_id); setProblem('');
    try { await api.call(`/salon/appointments/${a.appointment_id}/status`, { method: 'POST', body: { status, ...(reason ? { reason } : {}) } }); await list.refresh(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work'); }
    finally { setBusy(0); }
  };
  const sure = (title: string, text: string, go: () => void) => Alert.alert(title, text, [{ text: 'No', style: 'cancel' }, { text: 'Yes', style: 'destructive', onPress: go }]);
  const rows = list.data ?? [];

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Appointments</Title><Soft>Who is booked, and who has arrived</Soft></View>
          <Button title="New" onPress={() => router.push('/appointment-new')} />
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <Chips<Day> items={[{ id: 'today', label: 'Today' }, { id: 'tomorrow', label: 'Tomorrow' }]} value={day} onChange={setDay} />
        <SavedNote at={list.savedAt} />
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><ErrorText>{problem}</ErrorText></View>
        {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
        {list.busy && !list.data ? <Loading /> : null}
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          {list.data && rows.length === 0 ? <Empty>No appointments for this day. Tap New to book one, or go to Sell for a walk-in.</Empty> : null}
          {rows.map((a) => {
            const next = NEXT[a.status];
            return (
              <View key={a.appointment_id} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>{clock(a.start_at)} · {a.customer_name ?? 'Walk-in'}</Text>
                <Text style={{ color: TONE[a.status], fontWeight: '600' }}>{APPOINTMENT_LABEL[a.status]}</Text>
                <Soft>{a.services.map((x) => `${x.name} (${x.staff_name})`).join(', ')} · {rupees(toPaise(a.total))}</Soft>
                {a.notes ? <Soft>{a.notes}</Soft> : null}
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {next ? <Button title={next.label} kind="quiet" busy={busy === a.appointment_id} onPress={() => { void move(a, next.to); }} /> : null}
                  {canBill(a) ? <Button title="Bill this visit" onPress={() => router.navigate({ pathname: '/sell', params: { appointment: String(a.appointment_id) } })} /> : null}
                  {canNoShow(a) ? <Button title="Did not come" kind="quiet" onPress={() => sure('Mark as did not come?', `${a.customer_name ?? 'The client'} will be marked as a no-show.`, () => { void move(a, 'NO_SHOW'); })} /> : null}
                  {['BOOKED', 'CONFIRMED'].includes(a.status) ? <Button title="Move" kind="quiet" onPress={() => router.push({ pathname: '/appointment-new', params: { move: String(a.appointment_id) } })} /> : null}
                  {canCancel(a) ? <Button title="Cancel" kind="quiet" onPress={() => sure('Cancel this appointment?', `${a.customer_name ?? 'The client'} at ${clock(a.start_at)}.`, () => { void move(a, 'CANCELLED', 'Cancelled at the front desk'); })} /> : null}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
