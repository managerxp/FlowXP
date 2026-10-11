import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { ATTENDANCE_LABEL, monthRange, type Attendance, type CommissionSummary, type StaffDay } from '../lib/salon.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Loading, SavedNote, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

type Tab = 'attendance' | 'commission';
const STATES: Attendance[] = ['PRESENT', 'HALF_DAY', 'LEAVE', 'ABSENT'];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* The team: who is in today, and what each person has earned this month. Approving and paying commission is for the owner or manager. */
export default function SalonTeam() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const [tab, setTab] = useState<Tab>('attendance');
  const day = today();
  const range = monthRange();
  const att = useLoad<{ date: string; staff: StaffDay[] }>(`salon-attendance:${scope}:${day}`, () => api.get(`/salon/attendance?date=${day}`));
  const com = useLoad<CommissionSummary>(`salon-commission:${scope}:${range.from}`, () => api.get<CommissionSummary>(`/salon/commissions/summary?from=${range.from}&to=${range.to}`), tab === 'commission');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState('');

  const mark = async (staffId: number, status: Attendance) => {
    setBusy(`a${staffId}`); setProblem('');
    try { await api.call('/salon/attendance', { method: 'PUT', body: { staff_id: staffId, work_date: day, status } }); await att.refresh(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(''); }
  };

  const approve = async (staffId: number) => {
    setBusy(`c${staffId}`); setProblem('');
    try { await api.call('/salon/commissions/approve', { method: 'POST', body: { staff_id: staffId, from: range.from, to: range.to } }); await com.refresh(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not approve'); }
    finally { setBusy(''); }
  };
  const pay = (staffId: number, name: string, amount: number) => Alert.alert(`Pay ${name}?`, `${rupees(toPaise(amount))} commission, paid in cash. It is recorded as paid and cannot be undone here.`, [
    { text: 'No', style: 'cancel' },
    { text: 'Pay', onPress: () => { void (async () => {
      setBusy(`c${staffId}`); setProblem('');
      try { await api.call('/salon/commissions/pay', { method: 'POST', idempotencyKey: newKey(), body: { staff_id: staffId, from: range.from, to: range.to, method: 'CASH' } }); await com.refresh(); }
      catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not pay'); }
      finally { setBusy(''); }
    })(); } }
  ]);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Team</Title><Soft>{tab === 'attendance' ? 'Who is in today' : `Commission, ${range.from} to ${range.to}`}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <Chips<Tab> items={[{ id: 'attendance', label: 'Today' }, { id: 'commission', label: 'Commission' }]} value={tab} onChange={(x) => { setTab(x); setProblem(''); }} />
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><ErrorText>{problem}</ErrorText></View>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          {tab === 'attendance' ? (
            <>
              <SavedNote at={att.savedAt} />
              {att.error && !att.data ? <Failed message={att.error} onRetry={() => { void att.refresh(); }} /> : null}
              {att.busy && !att.data ? <Loading /> : null}
              {att.data && att.data.staff.length === 0 ? <Empty>No team members at this outlet. Add them on the FlowXP website under Team.</Empty> : null}
              {(att.data?.staff ?? []).map((m) => (
                <View key={m.staff_id} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>{m.name}{m.staff_role ? ` · ${m.staff_role.toLowerCase()}` : ''}</Text>
                  <Chips<string> items={STATES.map((st) => ({ id: st, label: ATTENDANCE_LABEL[st] }))} value={m.status ?? ''} onChange={(st) => { void mark(m.staff_id, st as Attendance); }} />
                  {busy === `a${m.staff_id}` ? <Soft>Saving…</Soft> : !m.status ? <Soft>Not marked yet</Soft> : null}
                </View>
              ))}
            </>
          ) : (
            <>
              <SavedNote at={com.savedAt} />
              {com.error && !com.data ? <Failed message={com.error} onRetry={() => { void com.refresh(); }} /> : null}
              {com.busy && !com.data ? <Loading /> : null}
              {com.data ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
                  <Stat label="To approve" value={rupees(toPaise(com.data.totals.pending))} tone={com.data.totals.pending ? color.warn : undefined} />
                  <Stat label="To pay" value={rupees(toPaise(com.data.totals.approved))} tone={com.data.totals.approved ? color.brand : undefined} />
                  <Stat label="Paid" value={rupees(toPaise(com.data.totals.paid))} tone={color.ok} />
                </View>
              ) : null}
              {(com.data?.staff ?? []).map((m) => (
                <View key={m.staff_id} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>{m.name}</Text>
                    <Text style={{ fontWeight: '700', color: color.ink }}>{rupees(toPaise(m.total))}</Text>
                  </View>
                  <Soft>{`${m.lines} services and sales · ${rupees(toPaise(m.revenue))} billed`}</Soft>
                  <Soft>{`To approve ${rupees(toPaise(m.pending))} · to pay ${rupees(toPaise(m.approved))} · paid ${rupees(toPaise(m.paid))}`}</Soft>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {m.pending > 0 ? <Button title="Approve" kind="quiet" busy={busy === `c${m.staff_id}`} onPress={() => { void approve(m.staff_id); }} /> : null}
                    {m.approved > 0 ? <Button title="Pay in cash" busy={busy === `c${m.staff_id}`} onPress={() => pay(m.staff_id, m.name, m.approved)} /> : null}
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
