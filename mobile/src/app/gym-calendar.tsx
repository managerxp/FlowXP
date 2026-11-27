import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { newKey } from '../lib/api.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { SearchBox } from '../lib/SearchBox.tsx';
import { membersPath } from '../lib/gym.ts';
import { dmy } from '../lib/gymApp.ts';
import { rowsOf, timeOf, todayISO, type DayVisit } from '../lib/gymMembers.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Empty, ErrorText, Group, Line, Loading, SectionTitle, Soft, Title, color, s, TextInput } from '../lib/ui.tsx';

type Day = { date: string; visits: number };
type Found = { member_id: number; name: string; member_code: string };
const pad = (x: number) => String(x).padStart(2, '0');
const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/* Attendance by month: each day shows how many came; tap a day to see who, and add a visit that was missed (a back-dated entry, with a reason). */
export default function GymCalendar() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [day, setDay] = useState(todayISO());
  const first = `${ym.y}-${pad(ym.m + 1)}-01`;
  const last = `${ym.y}-${pad(ym.m + 1)}-${pad(new Date(ym.y, ym.m + 1, 0).getDate())}`;
  const month = useLoad<{ by_day: Day[] }>(`gym-cal:${scope}:${first}`, () => api.get(`/gym/reports/attendance?from=${first}&to=${last}`));
  const visits = useLoad<DayVisit[]>(`gym-cal-day:${scope}:${day}`, () => api.get<DayVisit[] | { rows: DayVisit[] }>(`/gym/attendance?from=${day}&to=${day}&limit=200`).then(rowsOf));
  const counts = new Map((month.data?.by_day ?? []).map((d) => [d.date, d.visits]));
  const lead = new Date(ym.y, ym.m, 1).getDay();
  const total = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  const step = (d: number) => setYm(({ y, m }) => { const x = new Date(y, m + d, 1); return { y: x.getFullYear(), m: x.getMonth() }; });

  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [time, setTime] = useState('07:00');
  const [reason, setReason] = useState('Forgot to scan');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const x = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(x); }, [text]);
  useEffect(() => { const p = membersPath(q, 6); if (!p) { setFound([]); return; } let live = true; void api.get<Found[] | { rows: Found[] }>(p).then((r) => { if (live) setFound(rowsOf(r)); }).catch(() => {}); return () => { live = false; }; }, [q]);

  const add = async (m: Found) => {
    setErr('');
    if (!/^\d{2}:\d{2}$/.test(time)) { setErr(t('Type the time like 07:30')); return; }
    const at = new Date(`${day}T${time}:00`);
    if (at.getTime() > Date.now()) { setErr(t('That time has not come yet.')); return; }
    setBusy(true);
    try {
      await api.post('/gym/attendance', { member_id: m.member_id, check_in_at: at.toISOString(), reason: reason.trim() || 'Added by hand' }, { idempotencyKey: newKey() });
      setAdding(false); setText(''); void visits.refresh(); void month.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Attendance</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        <ScrollView contentContainerStyle={{ paddingBottom: 60, gap: 8 }} keyboardShouldPersistTaps="handled">
          <View style={[s.card, { marginHorizontal: 16, gap: 8 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Button title="‹" kind="quiet" onPress={() => step(-1)} style={{ minHeight: 44, paddingHorizontal: 16 }} />
              <Text style={{ fontWeight: '700', color: color.ink, fontSize: 16 }}>{new Date(ym.y, ym.m, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</Text>
              <Button title="›" kind="quiet" onPress={() => step(1)} style={{ minHeight: 44, paddingHorizontal: 16 }} />
            </View>
            <View style={{ flexDirection: 'row' }}>{WEEK.map((w, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', color: color.soft, fontSize: 12 }}>{w}</Text>)}</View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {cells.map((c, i) => {
                const iso = c ? `${ym.y}-${pad(ym.m + 1)}-${pad(c)}` : '';
                const n = c ? counts.get(iso) ?? 0 : 0;
                const on = iso === day;
                return (
                  <View key={i} style={{ width: `${100 / 7}%`, padding: 2 }}>
                    {c ? <Pressable accessibilityRole="button" accessibilityLabel={`${iso}: ${n}`} accessibilityState={{ selected: on }} onPress={() => setDay(iso)} style={{ minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.action : n ? color.wash : 'transparent' }}>
                      <Text style={{ color: on ? color.onAction : color.ink, fontWeight: '600' }}>{c}</Text>
                      <Text style={{ fontSize: 11, color: on ? color.onAction : color.soft }}>{n || ''}</Text>
                    </Pressable> : null}
                  </View>
                );
              })}
            </View>
          </View>
          <SectionTitle>{`${dmy(day)} · ${t('{n} visits', { n: visits.data?.length ?? 0 })}`}</SectionTitle>
          {visits.busy && !visits.data ? <Loading /> : null}
          {visits.data && visits.data.length === 0 ? <Empty>Nobody came on this day.</Empty> : null}
          <Group>{(visits.data ?? []).map((x) => <Line key={x.attendance_id} left={x.member_name} sub={x.member_code} right={timeOf(x.check_in_at)} />)}</Group>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {adding ? (
              <View style={[s.card, { gap: 8 }]}>
                <Soft>{t('Add a visit that was missed on {day}', { day: dmy(day) })}</Soft>
                <SearchBox value={text} onChange={setText} placeholder="Name, phone or member number" label="Find a member" />
                <Text style={{ color: color.soft, fontSize: 13 }}>{t('Time (24-hour, like 07:30)')}</Text>
                <TextInput style={s.input} value={time} onChangeText={setTime} maxLength={5} keyboardType="numbers-and-punctuation" accessibilityLabel={t('Time (24-hour, like 07:30)')} />
                <Text style={{ color: color.soft, fontSize: 13 }}>{t('Why is it being added?')}</Text>
                <TextInput style={s.input} value={reason} onChangeText={setReason} maxLength={200} accessibilityLabel={t('Why is it being added?')} />
                <ErrorText>{err}</ErrorText>
                <Group>{found.map((m) => <Line key={m.member_id} left={m.name} sub={m.member_code} right={busy ? '…' : t('Add')} onPress={() => { void add(m); }} />)}</Group>
              </View>
            ) : <Button title="Add a back-dated entry" kind="quiet" onPress={() => setAdding(true)} />}
            <Soft>Only the owner or a manager can add a missed visit.</Soft>
          </View>
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
