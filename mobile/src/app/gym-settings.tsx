import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { qrSvg } from '../lib/qr.ts';
import {
  DAYS, INT_RULES, canGymSetup, defaultHours, hoursBody, hoursProblem, portalText, setDayHours, settingsBody, settingsForm, settingsProblem,
  type GymSettings, type Hours, type SettingsForm
} from '../lib/gymSetup.ts';
import { Button, Chips, Empty, ErrorText, Failed, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const why = (e: unknown) => (e instanceof Error ? e.message : t('Could not save. Check the connection and try again.'));
const Row = ({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1 }}><Text style={{ color: color.ink, fontWeight: '600' }}>{t(label)}</Text>{hint ? <Soft>{t(hint)}</Soft> : null}</View><Switch value={value} onValueChange={onChange} accessibilityLabel={t(label)} /></View>
);

/* ── rules ───────────────────────────────────────────────────────────────── */
const Rules = ({ st, reload }: { st: GymSettings; reload: () => void }) => {
  const [f, setF] = useState<SettingsForm>(settingsForm(st));
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(settingsForm(st)), [st]);
  const set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (k: keyof SettingsForm, hint?: string) => {
    const label = INT_RULES.find((r) => r[0] === k)![1];
    return (
      <View key={k} style={{ gap: 4 }}>
        <Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>
        <TextInput style={s.input} value={String(f[k])} onChangeText={(v) => set(k, v.replace(/\D/g, '') as never)} keyboardType="numeric" maxLength={5} accessibilityLabel={t(label)} />
        {hint ? <Soft>{t(hint)}</Soft> : null}
      </View>
    );
  };
  const save = async () => {
    const bad = settingsProblem(f);
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError(''); setNote('');
    try { await api.call('/gym/settings', { method: 'PUT', body: settingsBody(f) }); setNote(t('Settings saved')); reload(); } catch (e) { setError(why(e)); } finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <SectionTitle>Check-in rules</SectionTitle>
      <Soft>{t("Every way in follows these: the desk, the member's phone and the gates.")}</Soft>
      {num('grace_days')}{num('cooldown_seconds')}{num('visits_per_day')}{num('travel_minutes')}
      <Row label="Record check-out as well as check-in" hint="Shows who is in the gym now." value={f.checkout_enabled} onChange={(v) => set('checkout_enabled', v)} />
      <Row label="The desk confirms every scan by looking at the member" hint="Printed cards can be lent to a friend. With this on, the desk sees the member's photo and confirms." value={f.reception_confirm} onChange={(v) => set('reception_confirm', v)} />

      <SectionTitle>Members on their own phone</SectionTitle>
      <Soft>{t('A member signs in with a code sent to their phone, then shows a pass or checks in themselves. No app to install.')}</Soft>
      <Row label="Let members check in from their own phone" hint="They scan the poster at the door with their phone's camera." value={f.self_checkin_enabled} onChange={(v) => set('self_checkin_enabled', v)} />
      <Row label="Also ask for today's front-desk code" value={f.self_checkin_daily_code} onChange={(v) => set('self_checkin_daily_code', v)} />
      <Row label="Ask for a fresh sign-in code every time" value={f.fresh} onChange={(v) => set('fresh', v)} />
      {f.fresh ? (
        <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t('A code counts for (minutes)')}</Text><TextInput style={s.input} value={f.fresh_minutes} onChangeText={(v) => set('fresh_minutes', v.replace(/\D/g, ''))} keyboardType="numeric" maxLength={4} accessibilityLabel={t('A code counts for (minutes)')} /></View>
      ) : null}
      <View style={{ gap: 4 }}>
        <Text style={{ color: color.soft, fontSize: 13 }}>{t("The gym's web address")}</Text>
        <TextInput style={s.input} value={f.public_slug} onChangeText={(v) => set('public_slug', v.toLowerCase())} autoCapitalize="none" autoCorrect={false} maxLength={40} placeholder="ironworks" accessibilityLabel={t("The gym's web address")} />
        <Soft>{portalText({ public_slug: f.public_slug || null, portal_url: st.portal_url })}</Soft>
      </View>
      <View style={{ gap: 4 }}>
        <Text style={{ color: color.soft, fontSize: 13 }}>{t('Member number starts with')}</Text>
        <TextInput style={s.input} value={f.member_prefix} onChangeText={(v) => set('member_prefix', v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={8} accessibilityLabel={t('Member number starts with')} />
      </View>
      {num('session_days')}{num('pass_ttl_seconds')}

      <SectionTitle>Classes</SectionTitle>
      <Soft>{t('How booking works for members and the desk.')}</Soft>
      {num('class_cancel_hours')}{num('pt_cancel_hours')}{num('class_booking_days')}
      <Row label="A full class has a waitlist" value={f.class_waitlist} onChange={(v) => set('class_waitlist', v)} />
      <ErrorText>{error}</ErrorText>
      {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{note}</Text> : null}
      <Button title="Save settings" onPress={() => { void save(); }} busy={busy} />
    </ScrollView>
  );
};

/* ── branches: hours, holidays, the entrance QR ──────────────────────────── */
const Branches = ({ st, reload }: { st: GymSettings; reload: () => void }) => {
  const [id, setId] = useState(st.branches[0]?.branch_id);
  const b = st.branches.find((x) => x.branch_id === id) ?? st.branches[0];
  const [hours, setHours] = useState<Hours>(null);
  const [holidays, setHolidays] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (b) { setHours(b.hours); setHolidays((b.holidays ?? []).join('\n')); } }, [b?.branch_id, b?.hours, b?.holidays]);   // eslint-disable-line react-hooks/exhaustive-deps
  const svg = useMemo(() => (b ? qrSvg(b.checkin_url, 240) : ''), [b?.checkin_url]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!b) return null;

  const save = async () => {
    const bad = hoursProblem(hours, holidays);
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError(''); setNote('');
    try { await api.call(`/gym/branches/${b.branch_id}/settings`, { method: 'PUT', body: hoursBody(hours, holidays) }); setNote(t('Hours saved')); reload(); } catch (e) { setError(why(e)); } finally { setBusy(false); }
  };
  const rotate = () => Alert.alert(t('Make a new entrance QR?'), t('The poster on the wall stops working. Print the new one and put it up. Use this if the old poster was copied or spread around.'), [
    { text: t('Cancel'), style: 'cancel' },
    { text: t('Make a new QR'), style: 'destructive', onPress: () => { void api.call(`/gym/branches/${b.branch_id}/checkin-qr/rotate`, { method: 'POST', body: {} }).then(() => { setNote(t('New QR made. Print it now.')); reload(); }).catch((e) => setError(why(e))); } }
  ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {st.branches.length > 1 ? <Chips items={st.branches.map((x) => ({ id: String(x.branch_id), label: x.name }))} value={String(b.branch_id)} onChange={(v) => setId(Number(v))} /> : null}
      <SectionTitle>Opening hours</SectionTitle>
      <Soft>{t('Nobody is let in outside these hours, whatever their plan.')}</Soft>
      <Row label="Open all day, every day" value={hours == null} onChange={(v) => setHours(v ? null : defaultHours())} />
      {hours ? DAYS.map(([d, name]) => {
        const h = hours[String(d)];
        return (
          <View key={d} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Switch value={Boolean(h)} onValueChange={(on) => setHours(setDayHours(hours, d, on ? { open: '06:00', close: '22:00' } : null))} accessibilityLabel={t(name)} />
            <Text style={{ color: color.ink, width: 44 }}>{t(name)}</Text>
            {h ? (
              <>
                <TextInput style={[s.input, { flex: 1, minHeight: 44 }]} value={h.open} onChangeText={(v) => setHours(setDayHours(hours, d, { ...h, open: v }))} maxLength={5} placeholder="06:00" accessibilityLabel={`${t(name)} ${t('Opens')}`} />
                <Text style={{ color: color.soft }}>{t('to')}</Text>
                <TextInput style={[s.input, { flex: 1, minHeight: 44 }]} value={h.close} onChangeText={(v) => setHours(setDayHours(hours, d, { ...h, close: v }))} maxLength={5} placeholder="22:00" accessibilityLabel={`${t(name)} ${t('Closes')}`} />
              </>
            ) : <Soft>{t('Closed')}</Soft>}
          </View>
        );
      }) : null}
      <View style={{ gap: 4 }}>
        <Text style={{ color: color.soft, fontSize: 13 }}>{t('Holidays (closed all day)')}</Text>
        <TextInput style={[s.input, { minHeight: 90, textAlignVertical: 'top', paddingTop: 12 }]} multiline value={holidays} onChangeText={setHolidays} autoCapitalize="none" autoCorrect={false} placeholder="2026-11-08" accessibilityLabel={t('Holidays (closed all day)')} />
        <Soft>{t('One date a line, like 2026-11-08.')}</Soft>
      </View>
      <ErrorText>{error}</ErrorText>
      {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{note}</Text> : null}
      <Button title="Save hours" onPress={() => { void save(); }} busy={busy} />

      <SectionTitle>Entrance QR</SectionTitle>
      <Soft>{t('Put this poster at the door. It only opens the check-in page for this branch.')}</Soft>
      {!st.public_slug && !st.self_checkin_enabled ? <Soft>{t('Phone check-in is switched off. Turn it on under Rules before putting the poster up.')}</Soft> : null}
      <View style={{ alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 6 }}>
        <Text style={{ fontWeight: '800', fontSize: 18, color: '#111' }}>{t('Check in here')}</Text>
        <SvgXml xml={svg} width={240} height={240} />
        <Text style={{ color: '#444', textAlign: 'center' }}>{t("Scan with your phone's camera. Sign in with the code we send you, then tap Check in.")}</Text>
        <Text style={{ color: '#666' }}>{b.name}</Text>
      </View>
      <Button title="New QR" kind="danger" onPress={rotate} />
    </ScrollView>
  );
};

/* Gym settings: the rules for coming in, each branch's hours and holidays, and the entrance QR. */
export default function GymSettingsScreen() {
  const me = currentBusiness(useSession());
  const ok = canGymSetup((p) => allowed(me, p));
  const [st, setSt] = useState<GymSettings | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'rules' | 'branches'>('rules');
  const load = useCallback(() => { api.get<GymSettings>('/gym/settings').then((d) => { setSt(d); setError(''); }).catch((e: Error) => setError(e.message || t('Could not load.'))); }, []);
  useEffect(() => { if (ok) load(); }, [load, ok]);
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View style={{ flex: 1 }}><Title>Gym settings</Title><Soft>{t("The rules for coming in, each branch's hours, and the entrance QR.")}</Soft></View><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>You do not have access to gym set-up.</Empty> : error && !st ? <Failed message={error} onRetry={load} /> : !st ? <Loading /> : (
          <>
            <Chips items={[{ id: 'rules', label: 'Rules' }, { id: 'branches', label: 'Branches and QR' }]} value={tab} onChange={setTab} />
            {tab === 'rules' ? <Rules st={st} reload={load} /> : <Branches st={st} reload={load} />}
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
