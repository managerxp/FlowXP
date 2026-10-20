import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, NetworkError, newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { setCaptured, useCaptured } from '../lib/capture.ts';
import { SearchBox } from '../lib/SearchBox.tsx';
import { STATE_LABEL, addRecent, deniedTotal, manualBody, memberSub, membersPath, needsConfirm, reasonOf, recentOf, scanBody, type AccessResult, type GymDash, type Member, type Recent } from '../lib/gym.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Empty, Failed, Line, Loading, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

const TONE = { get ok() { return color.ok; }, get warn() { return color.warn; }, get bad() { return color.danger; }, get soft() { return color.soft; } };

/* The front desk: let a member in by scanning their card or phone pass, or by finding them and checking it is them. The server decides every time; if it cannot be reached, nobody is let in. */
export default function Gym() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const dash = useLoad<GymDash>(`gym-dash:${scope}`, () => api.get<GymDash>('/gym/dashboard'));
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text), 300); return () => clearTimeout(t); }, [text]);
  const path = membersPath(q);
  const found = useLoad<Member[]>(`gym-find:${scope}:${q}`, () => api.get<Member[]>(path as string), path !== null);
  const [result, setResult] = useState<(AccessResult & { _retry?: () => void }) | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);

  // a camera scan hands its code back here
  const captured = useCaptured();
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));

  const show = (r: AccessResult, label: string, retry?: () => void) => {
    setResult({ ...r, _retry: retry });
    setRecent((l) => addRecent(l, recentOf(r, label)));
    if (hide.current) clearTimeout(hide.current);
    // the screen may face other members: an answer folds away after a few seconds, unless the desk has to look at the person first
    if (!needsConfirm(r)) hide.current = setTimeout(() => setResult(null), 8000);
    if (r.decision === 'APPROVED') void dash.refresh();
  };
  const send = async (path: string, body: object, label: string, retry?: () => void) => {
    setBusy(true); setProblem('');
    try { show(await api.post<AccessResult>(path, body), label, retry); }
    catch (e) {
      // nothing is decided on the phone: if the server cannot answer, nobody is let in
      setResult(null);
      setProblem(e instanceof NetworkError ? 'No connection, so nobody can be let in. Try again when it is back, or tell the manager.' : e instanceof ApiError ? e.message : 'Could not check. Nobody is let in.');
    } finally { setBusy(false); }
  };
  const scan = (code: string, confirm = false) => { const key = newKey(); void send('/gym/access/scan', scanBody(code, key, 'IN', confirm), 'a pass', () => scan(code, true)); };
  useEffect(() => { if (focused && captured) { setCaptured(null); scan(captured); } }, [focused, captured]);   // eslint-disable-line react-hooks/exhaustive-deps

  const letIn = (m: Member, action: 'IN' | 'OUT' = 'IN') => Alert.alert(`Is this ${m.name}?`, `Look at who is in front of you. ${action === 'IN' ? 'Check them in' : 'Check them out'} as ${m.name} (${m.member_code}) only if it is them.`,
    [{ text: 'No', style: 'cancel' }, { text: action === 'IN' ? 'Yes, check in' : 'Yes, check out', onPress: () => { void send('/gym/access/manual', manualBody(m.member_id, newKey(), action), m.name); setText(''); } }]);

  const r = result; const info = r ? reasonOf(r.reason) : null;
  const d = dash.data;
  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Front desk</Title><Soft>Let members in</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {d ? (
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
              <Stat label="In the gym now" value={String(d.visits.open_now)} tone={color.brand} />
              <Stat label="Visits today" value={String(d.visits.today)} note={`${d.visits.today_unique} members`} />
              <Stat label="Turned away" value={String(deniedTotal(d))} tone={deniedTotal(d) ? color.warn : undefined} />
            </View>
          ) : null}
          {dash.error && !d ? <Failed message={dash.error} onRetry={() => { void dash.refresh(); }} /> : null}

          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <Button title="Scan a pass" onPress={() => router.push({ pathname: '/scan', params: { capture: '1' } })} disabled={busy} />
          </View>

          {busy ? <Loading what="Checking" /> : null}
          {problem ? <Text accessibilityRole="alert" style={{ color: color.danger, padding: 16, fontWeight: '600' }}>{problem}</Text> : null}
          {r && info ? (
            <View accessibilityLiveRegion="polite" style={[s.card, { margin: 16, gap: 4, borderWidth: 2, borderColor: TONE[info.tone] }]}>
              <Text style={{ fontSize: 22, fontWeight: '700', color: TONE[info.tone] }}>{r.decision === 'APPROVED' ? (r.action === 'OUT' ? 'Checked out' : info.title) : info.title}</Text>
              {r.member ? <Text style={{ fontSize: 18, color: color.ink, fontWeight: '600' }}>{r.member.name}<Text style={{ color: color.soft, fontWeight: '400' }}>{`  ${r.member.member_code}`}</Text></Text> : null}
              {r.membership ? <Soft>{`${r.membership.plan_name} · ${r.membership.days_left >= 0 ? `${r.membership.days_left} day${r.membership.days_left === 1 ? '' : 's'} left` : 'ended'}`}</Soft> : null}
              {r.in_grace ? <Text style={{ color: color.warn, fontWeight: '600' }}>The membership has run out but is inside its grace days.</Text> : null}
              {info.next ? <Text style={{ color: color.ink }}>{info.next}</Text> : null}
              {needsConfirm(r) && r._retry ? <Button title="It is them, let them in" onPress={() => r._retry?.()} busy={busy} /> : null}
              <Button title="Done" kind="quiet" onPress={() => setResult(null)} />
            </View>
          ) : null}

          <SectionTitle>Find a member</SectionTitle>
          <View style={{ paddingHorizontal: 16 }}><SearchBox value={text} onChange={setText} placeholder="Name, phone or member number" label="Find a member" /></View>
          {found.busy && !found.data ? <Loading /> : null}
          {found.error && !found.data ? <Failed message={found.error} onRetry={() => { void found.refresh(); }} /> : null}
          {found.data && found.data.length === 0 ? <Empty>No member matches that.</Empty> : null}
          {(found.data ?? []).map((m) => <Line key={m.member_id} left={m.name} sub={memberSub(m)} right={STATE_LABEL[m.state] ?? m.state} onPress={() => letIn(m)} />)}

          {recent.length ? (
            <>
              <SectionTitle>Just now</SectionTitle>
              {recent.map((x, i) => <Line key={`${x.at}${i}`} left={x.who} right={x.what} />)}
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
