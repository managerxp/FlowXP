import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { adoptToken, api, currentBusiness, loadMe, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import {
  OUTCOME, canSeeTeamSecurity, capProblem, changePasswordBody, cleanCode, codesLow, deviceName, disableBody, enableBody, looksLikeCode, passwordProblem, pinProblem, recoveryText, roleText, whenText,
  type ApprovalRules, type LoginEvent, type TeamSecurity, type TwoFactorSetup, type TwoFactorStatus
} from '../lib/security.ts';
import { Button, ErrorText, Failed, Line, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

const failText = (e: unknown) => (e instanceof ApiError ? e.message : t('Could not save. Check the connection and try again.'));

const Card = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <View style={[s.card, { gap: 10 }]}>
    <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '700', color: color.ink }}>{t(title)}</Text>
    {hint ? <Soft>{t(hint)}</Soft> : null}
    {children}
  </View>
);
const Field = ({ label, value, onChange, secure, numeric, hint, max }: { label: string; value: string; onChange: (v: string) => void; secure?: boolean; numeric?: boolean; hint?: string; max?: number }) => (
  <View style={{ gap: 4 }}>
    <Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>
    <TextInput style={s.input} value={value} onChangeText={onChange} secureTextEntry={secure} keyboardType={numeric ? 'numeric' : 'default'} maxLength={max} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t(label)} />
    {hint ? <Soft>{t(hint)}</Soft> : null}
  </View>
);
const Badge = ({ text, bad }: { text: string; bad?: boolean }) => <Text style={{ color: bad ? color.danger : color.ok, fontWeight: '700' }}>{t(text)}</Text>;

/* Events: one line each, when / what / device and address. */
const Events = ({ rows, showWho }: { rows: LoginEvent[]; showWho?: boolean }) => (
  <View>
    {rows.map((e) => {
      const o = OUTCOME[e.outcome] ?? { label: e.outcome, bad: false };
      return <Line key={e.event_id} left={`${showWho ? `${e.name || e.email} · ` : ''}${t(o.label)}${e.method === 'RECOVERY' ? ` · ${t('recovery code')}` : ''}${e.new_device ? ` · ${t('new device')}` : ''}`} right={whenText(e.at)}
        sub={[deviceName(e.device) === 'Unknown device' ? t('Unknown device') : deviceName(e.device), e.ip].filter(Boolean).join(' · ')} />;
    })}
  </View>
);

const TwoFactor = ({ onChanged }: { onChanged: () => void }) => {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [off, setOff] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get<TwoFactorStatus>('/auth/2fa').then(setStatus).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(failText(e)); } finally { setBusy(false); } };

  const start = () => run(async () => { setSetup(await api.post<TwoFactorSetup>('/auth/2fa/setup', {})); });
  const enable = () => run(async () => {
    if (!looksLikeCode(code)) { setError(t('Enter the 6-digit code it shows to confirm.')); return; }
    const r = await api.post<{ recovery_codes: string[]; token?: string }>('/auth/2fa/enable', enableBody(code));
    adoptToken(r.token); setSetup(null); setCode(''); setCodes(r.recovery_codes); void load(); void loadMe(); onChanged();
  });
  const newCodes = () => run(async () => {
    if (!password) { setError(t('Your password')); return; }
    const r = await api.post<{ recovery_codes: string[] }>('/auth/2fa/recovery-codes', { password });
    setPassword(''); setCodes(r.recovery_codes); void load();
  });
  const turnOff = () => run(async () => {
    if (!password || !code.trim()) { setError(t('Enter your password and a code.')); return; }
    const r = await api.post<{ token?: string }>('/auth/2fa/disable', disableBody(password, code));
    adoptToken(r.token); setOff(false); setPassword(''); setCode(''); void load(); void loadMe(); onChanged();
    Alert.alert(t('Two-step verification is off'));
  });

  if (!status) return <Card title="Two-step verification">{error ? <ErrorText>{error}</ErrorText> : <Loading />}</Card>;
  return (
    <Card title="Two-step verification" hint="After your password, you enter a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password). A stolen password alone is then not enough.">
      <View style={{ flexDirection: 'row', gap: 8 }}><Text style={{ color: color.soft }}>{t('Two-step verification')}:</Text><Badge text={status.enabled ? 'On' : 'Off'} bad={!status.enabled} /></View>
      {status.required && !status.enabled ? <Text style={{ color: color.danger }}>{t('Your business requires two-step verification for owners and admins. Set it up to continue using FlowXP.')}</Text> : null}
      {codes ? (
        <View style={{ gap: 8, padding: 12, borderRadius: 12, backgroundColor: color.warnBg, borderWidth: 1, borderColor: color.warnLine }}>
          <Text style={{ fontWeight: '700', color: color.ink }}>{t('Save these recovery codes now')}</Text>
          <Soft>{t('Each works once if you lose your phone. They are shown only this time. Keep them somewhere safe, not on the same phone.')}</Soft>
          {codes.map((c) => <Text key={c} selectable style={{ fontFamily: 'monospace', fontSize: 16, color: color.ink }}>{c}</Text>)}
          <Button title="Save the codes" kind="quiet" onPress={() => { void Share.share({ message: recoveryText(codes) }); }} />
          <Button title="I have saved them" onPress={() => setCodes(null)} />
        </View>
      ) : null}
      {!status.enabled && !setup && !codes ? <Button title="Set up two-step verification" onPress={() => { void start(); }} busy={busy} /> : null}
      {setup ? (
        <View style={{ gap: 8 }}>
          <Button title="Open the authenticator app" onPress={() => { Linking.openURL(setup.otpauth_url).catch(() => setError(t('Or enter this key by hand in your authenticator app:'))); }} />
          <Soft>{t('Or enter this key by hand in your authenticator app:')}</Soft>
          <Text selectable style={{ fontFamily: 'monospace', color: color.ink, backgroundColor: color.wash, padding: 8, borderRadius: 8 }}>{setup.secret}</Text>
          <Field label="Code from your app" value={code} onChange={setCode} numeric max={7} hint="Enter the 6-digit code it shows to confirm." />
          <Button title="Turn on" onPress={() => { void enable(); }} busy={busy} />
        </View>
      ) : null}
      {status.enabled && !codes ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: color.ink }}>{status.recovery_codes_left === 1 ? t('1 recovery code left') : t('{n} recovery codes left', { n: status.recovery_codes_left })}{codesLow(status.recovery_codes_left) ? ` ${t('· get new ones soon')}` : ''}</Text>
          <Field label="Your password" value={password} onChange={setPassword} secure />
          <Button title="New recovery codes" kind="quiet" onPress={() => { void newCodes(); }} busy={busy} />
          {!status.required ? <Button title={off ? t('Cancel') : t('Turn off two-step verification')} kind="quiet" onPress={() => { setOff((v) => !v); setError(''); }} /> : null}
          {off ? <><Field label="A code, or a recovery code" value={code} onChange={setCode} /><Button title="Turn off" kind="danger" onPress={() => { void turnOff(); }} busy={busy} /></> : null}
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
};

const Password = () => {
  const [form, setForm] = useState({ current: '', next: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const problem = passwordProblem(form.current, form.next);
    if (problem) { setError(t(problem)); return; }
    setBusy(true); setError(''); setDone('');
    try { const r = await api.post<{ token?: string }>('/auth/change-password', changePasswordBody(form.current, form.next)); adoptToken(r.token); setForm({ current: '', next: '' }); setDone(t('Password changed. Your other devices were signed out.')); }
    catch (e) { setError(failText(e)); } finally { setBusy(false); }
  };
  const out = () => Alert.alert(t('Sign out everywhere else?'), t('Every other device and tab is signed out. You stay signed in here.'), [
    { text: t('Cancel'), style: 'cancel' },
    { text: t('Sign out others'), onPress: () => { void (async () => { try { const r = await api.post<{ token?: string }>('/auth/sign-out-everywhere', {}); adoptToken(r.token); setDone(t('Every other device was signed out')); } catch (e) { setError(failText(e)); } })(); } }
  ]);
  return (
    <Card title="Password and devices">
      <Field label="Current password" value={form.current} onChange={(v) => setForm((o) => ({ ...o, current: v }))} secure />
      <Field label="New password" value={form.next} onChange={(v) => setForm((o) => ({ ...o, next: v }))} secure hint="At least 10 characters" />
      <ErrorText>{error}</ErrorText>
      {done ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{done}</Text> : null}
      <Button title="Change password" onPress={() => { void save(); }} busy={busy} />
      <Soft>{t('Lost a phone, or used a shared computer? End every other session at once.')}</Soft>
      <Button title="Sign out everywhere else" kind="quiet" onPress={out} />
    </Card>
  );
};

const ApprovalPin = () => {
  const [status, setStatus] = useState<{ has_pin: boolean; can_approve: boolean } | null>(null);
  const [form, setForm] = useState({ password: '', pin: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const load = useCallback(() => api.get<{ has_pin: boolean; can_approve: boolean }>('/auth/approval-pin').then(setStatus).catch(() => setStatus(null)), []);
  useEffect(() => { void load(); }, [load]);
  if (!status?.can_approve) return null;
  const call = async (method: string, body: object, message: string) => {
    setError(''); setDone('');
    try { await api.call('/auth/approval-pin', { method, body }); setForm({ password: '', pin: '' }); setDone(t(message)); void load(); } catch (e) { setError(failText(e)); }
  };
  return (
    <Card title="Your approval PIN" hint="Staff at the till ask for this PIN to cancel a bill or give a large discount.">
      <Soft>{status.has_pin ? t('You have a PIN set.') : t('You have not set one yet, so nobody can ask you.')}</Soft>
      <Field label="Your password" value={form.password} onChange={(v) => setForm((o) => ({ ...o, password: v }))} secure />
      <Field label={status.has_pin ? 'New PIN' : 'PIN'} value={form.pin} onChange={(v) => setForm((o) => ({ ...o, pin: v }))} secure numeric max={8} hint="4 to 8 digits" />
      <ErrorText>{error}</ErrorText>
      {done ? <Text style={{ color: color.ok }}>{done}</Text> : null}
      <Button title={status.has_pin ? t('Change PIN') : t('Set PIN')} onPress={() => { const p = pinProblem(form.pin); if (p) setError(t(p)); else void call('PUT', form, 'PIN saved'); }} />
      {status.has_pin ? <Button title="Remove PIN" kind="quiet" disabled={!form.password} onPress={() => { void call('DELETE', { password: form.password }, 'PIN removed'); }} /> : null}
    </Card>
  );
};

const ApprovalRulesCard = () => {
  const [d, setD] = useState<ApprovalRules | null>(null);
  const [cap, setCap] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const load = useCallback(() => api.get<ApprovalRules>('/approvals').then((r) => { setD(r); setCap(String(r.discount_cap_pct)); }).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return error ? <Card title="Manager approval at the till"><ErrorText>{error}</ErrorText></Card> : null;
  const save = async (body: object) => { setError(''); setDone(''); try { await api.call('/approvals', { method: 'PUT', body }); setDone(t('Saved')); void load(); } catch (e) { setError(failText(e)); } };
  return (
    <Card title="Manager approval at the till" hint="Owners, admins and managers are never held back. Everyone else needs one of them to type in their PIN.">
      <Field label="Biggest discount staff may give alone (%)" value={cap} onChange={setCap} numeric max={3} hint="Of the bill, for discounts typed in at the till. Offers you set up are not counted." />
      <Button title="Save" kind="quiet" onPress={() => { const p = capProblem(cap); if (p) setError(t(p)); else void save({ discount_cap_pct: Number(cap) }); }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}><Text style={{ color: color.ink }}>{t("Cancelling a bill needs a manager's PIN")}</Text><Soft>{t('Staff also have to say why.')}</Soft></View>
        <Switch value={d.cancel_needs_approval} onValueChange={(v) => { void save({ cancel_needs_approval: v }); }} accessibilityLabel={t("Cancelling a bill needs a manager's PIN")} />
      </View>
      <Text style={{ fontWeight: '700', color: color.ink }}>{t('Who can approve')}</Text>
      {d.approvers?.length ? d.approvers.map((m) => <Line key={m.user_id} left={m.name} sub={roleText(m.role)} right={m.has_pin ? t('Set') : t('Not set')} />) : <Soft>{t('Nobody yet.')}</Soft>}
      <ErrorText>{error}</ErrorText>
      {done ? <Text style={{ color: color.ok }}>{done}</Text> : null}
    </Card>
  );
};

const Team = ({ owner }: { owner: boolean }) => {
  const [d, setD] = useState<TeamSecurity | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get<TeamSecurity>('/security/team').then(setD).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <Card title="Your team’s sign-ins">{error ? <ErrorText>{error}</ErrorText> : <Loading />}</Card>;
  const toggle = async (on: boolean) => { setError(''); try { await api.call('/security/policy', { method: 'PUT', body: { require_2fa_admins: on } }); Alert.alert(on ? t('Owners and admins must now use two-step verification') : t('Policy switched off')); void load(); } catch (e) { setError(failText(e)); } };
  return (
    <Card title="Your team’s sign-ins">
      <Text style={{ color: color.ink }}>{`${d.summary.failed_7d} ${t('failed attempts in the last 7 days')}`}</Text>
      <Text style={{ color: color.ink }}>{`${d.summary.new_devices_7d} ${t('sign-ins from new devices')}`}</Text>
      <Text style={{ color: d.summary.privileged_without_2fa ? color.warn : color.ink }}>{`${d.summary.privileged_without_2fa} ${t('owners/admins without two-step verification')}`}</Text>
      {owner ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}><Text style={{ color: color.ink }}>{t('Require two-step verification for owners and admins')}</Text><Soft>{t('Until they set it up, they cannot use the app. Turn on only once everyone is ready.')}</Soft></View>
          <Switch value={d.require_2fa_admins} onValueChange={(v) => { void toggle(v); }} accessibilityLabel={t('Require two-step verification for owners and admins')} />
        </View>
      ) : null}
      {d.members.map((m) => <Line key={m.user_id} left={m.name} sub={`${roleText(m.role)} · ${m.email}`} right={t(m.two_factor ? 'On' : 'Off')} />)}
      <Text style={{ fontWeight: '700', color: color.ink }}>{t('Recent activity')}</Text>
      {d.events.length ? <Events rows={d.events.slice(0, 30)} showWho /> : <Soft>{t('Nothing yet.')}</Soft>}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
};

/* Security: two-step verification, the password, other devices, the approval PIN and rules, recent sign-ins, and (owner and admin) the team's sign-ins. */
export default function Security() {
  const session = useSession();
  const me = currentBusiness(session);
  const [history, setHistory] = useState<LoginEvent[] | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => { api.get<LoginEvent[]>('/auth/login-history').then(setHistory).catch((e: Error) => setError(e.message)); }, [version]);
  const canSettings = me?.effective_permissions ? me.effective_permissions.settings === true : canSeeTeamSecurity(me?.role);
  return (
    <SafeAreaView style={s.screen}>
      <Page max={720}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Security</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
          <Soft>{t('Keep your account and your business safe.')}</Soft>
          <TwoFactor onChanged={() => setVersion((v) => v + 1)} />
          <Password />
          <ApprovalPin />
          {canSettings ? <ApprovalRulesCard /> : null}
          <Card title="Your recent sign-ins" hint="If you see one you don't recognise, change your password and sign out everywhere.">
            {error ? <Failed message={error} /> : history ? <Events rows={history.slice(0, 20)} /> : <Loading />}
          </Card>
          {canSeeTeamSecurity(me?.role) ? <Team owner={me?.role === 'OWNER'} /> : null}
          <Card title="Delete my account" hint="Erases your name, email, phone and sign-ins from FlowXP. The business keeps its bills and records.">
            <Button title="Delete my account" kind="quiet" onPress={() => router.push('/delete-account')} />
          </Card>
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
