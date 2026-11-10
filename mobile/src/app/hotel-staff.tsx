import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { ATT_CHOICES, ATT_TEXT, attendanceBody, leaveBody, leaveDays, type Headcount, type Leave, type StaffDay } from '../lib/hotelOps.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' });

/* Today's staff: who is in, mark each person, and answer leave requests. Rosters, payroll and hiring stay on the website. */
export default function HotelStaff() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const head = useLoad<Headcount>(`hotel-head:${scope}`, () => api.get<Headcount>('/hotel/staff/headcount'));
  const day = head.data?.date;
  const att = useLoad<{ date: string; rows: StaffDay[] }>(`hotel-att:${scope}:${day}`, () => api.get<{ date: string; rows: StaffDay[] }>(`/hotel/staff/attendance?date=${day}`), Boolean(day));
  const leaves = useLoad<Leave[]>(`hotel-leaves:${scope}`, () => api.get<Leave[]>('/hotel/staff/leaves?status=PENDING'));
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const h = head.data;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); await Promise.all([head.refresh(), att.refresh(), leaves.refresh()]); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };
  const mark = (p: StaffDay, status: string) => { void run(() => api.call('/hotel/staff/attendance', { method: 'PUT', body: attendanceBody(day as string, p.employee_id, status) })); };
  const decide = (l: Leave, a: 'APPROVE' | 'REJECT') => Alert.alert(a === 'APPROVE' ? t('Approve this leave?') : t('Turn down this leave?'), `${l.employee} · ${shortDay(l.from_date)} – ${shortDay(l.to_date)}`, [{ text: t('No'), style: 'cancel' }, { text: t('Yes'), onPress: () => { void run(() => api.post(`/hotel/staff/leaves/${l.leave_id}/decide`, leaveBody(a))); } }]);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Staff today</Title><Soft>Who is in, and leave requests</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {head.busy && !h ? <Loading /> : null}
          {head.error && !h ? <Failed message={head.error} onRetry={() => { void head.refresh(); }} /> : null}
          {h ? (
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
              <Stat label="In" value={String(h.present)} tone={color.ok} note={t('of {n}', { n: h.total })} />
              <Stat label="Absent" value={String(h.absent)} tone={h.absent ? color.warn : undefined} />
              <Stat label="On leave" value={String(h.on_leave)} />
              <Stat label="Not marked" value={String(h.unmarked)} tone={h.unmarked ? color.warn : undefined} />
            </View>
          ) : null}
          <ErrorText>{error}</ErrorText>
          {(leaves.data ?? []).length ? <SectionTitle>Leave waiting for you</SectionTitle> : null}
          {(leaves.data ?? []).map((l) => (
            <View key={l.leave_id} style={[s.card, { marginHorizontal: 16, marginTop: 8, gap: 4 }]}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: color.ink }}>{l.employee}</Text>
              <Soft>{`${shortDay(l.from_date)} – ${shortDay(l.to_date)} · ${t('{n} days', { n: leaveDays(l) })}${l.reason ? ` · ${l.reason}` : ''}`}</Soft>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Approve" onPress={() => decide(l, 'APPROVE')} disabled={busy} style={{ flex: 1 }} />
                <Button title="Turn down" kind="quiet" onPress={() => decide(l, 'REJECT')} disabled={busy} style={{ flex: 1 }} />
              </View>
            </View>
          ))}
          {att.data ? <SectionTitle>Mark today</SectionTitle> : null}
          {att.busy && !att.data ? <Loading /> : null}
          {(att.data?.rows ?? []).map((p) => (
            <View key={p.employee_id}>
              <Line left={p.name} sub={[p.designation, p.department].filter(Boolean).join(' · ')} right={p.status ? t(ATT_TEXT[p.status] ?? p.status) : p.leave_kind ? t('On leave') : p.weekly_off_today ? t('Day off') : t('Not marked')} selected={open === p.employee_id} onPress={() => setOpen(open === p.employee_id ? null : p.employee_id)} />
              {open === p.employee_id ? (
                <View style={{ padding: 16, backgroundColor: color.card }}>
                  <Chips items={ATT_CHOICES} value={p.status ?? ''} onChange={(v) => mark(p, v)} />
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
