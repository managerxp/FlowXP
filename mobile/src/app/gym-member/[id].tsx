import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { newKey } from '../../lib/api.ts';
import { api, useSession } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { manualBody } from '../../lib/gym.ts';
import type { Plan } from '../../lib/gymSetup.ts';
import { METHODS, STATE_TEXT, currentMembership, freezeBody, freezeProblem, renewable, rowsOf, sellBody, sellProblem, timeOf, todayISO, type MemberFull, type Pay } from '../../lib/gymMembers.ts';
import { Page } from '../../lib/responsive.tsx';
import { t } from '../../lib/i18n.ts';
import { Button, Chips, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const left = (c: { state: string; days_left: number | null }) => (c.state !== 'ACTIVE' || c.days_left == null ? '' : ` · ${c.days_left <= 0 ? t('Ends today') : t(c.days_left === 1 ? '1 day left' : '{n} days left', { n: c.days_left })}`);
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/* One member: their current membership, selling or renewing it (pick a plan, say how it was paid), freezing it, letting them in, and their latest visits. The server works out price, dates and rules. */
export default function GymMember() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const m = useLoad<MemberFull>(`gym-member:${scope}:${id}`, () => api.get<MemberFull>(`/gym/members/${id}`));
  const plans = useLoad<Plan[]>(`gym-plans-sell:${scope}`, () => api.get<Plan[] | { rows: Plan[] }>('/gym/plans?kind=MEMBERSHIP').then((r) => rowsOf(r).filter((p) => p.is_active !== false)));
  const [panel, setPanel] = useState<'' | 'sell' | 'freeze'>('');
  const [planId, setPlanId] = useState<number | null>(null);
  const [pay, setPay] = useState<Pay>('FULL');
  const [method, setMethod] = useState('CASH');
  const [part, setPart] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const d = m.data;
  const cur = d ? currentMembership(d) : null;
  const ren = d ? renewable(d) : null;
  const plan = (plans.data ?? []).find((p) => p.plan_id === planId) ?? null;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(''); setNote('');
    try { await fn(); setPanel(''); setNote(done); await m.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };
  const sell = () => {
    const bad = sellProblem(planId, pay, Number(part));
    if (bad) { setError(t(bad)); return; }
    const body = sellBody(planId as number, pay, method, Number(part));
    // a member with something to renew is renewed, so the new term follows the old one; otherwise it is a fresh sale
    void run(() => (ren ? api.post(`/gym/memberships/${ren.membership_id}/renew`, body, { idempotencyKey: newKey() }) : api.post(`/gym/members/${id}/memberships`, body, { idempotencyKey: newKey() })), ren ? t('Renewed.') : t('Membership sold.'));
  };
  const freeze = () => {
    const n = Number(days);
    const bad = freezeProblem(n, cur?.max_freeze_days ?? 0);
    if (bad) { setError(n > (cur?.max_freeze_days ?? 0) ? t('This plan allows up to {n} days.', { n: cur?.max_freeze_days ?? 0 }) : t(bad)); return; }
    void run(() => api.post(`/gym/memberships/${cur?.membership_id}/freeze`, freezeBody(n, todayISO()), { idempotencyKey: newKey() }), t('Membership frozen.'));
  };
  const unfreeze = () => Alert.alert(t('End the freeze?'), t('They can come in again from today.'), [{ text: t('No'), style: 'cancel' }, { text: t('Yes, end it'), onPress: () => { void run(() => api.post(`/gym/memberships/${cur?.membership_id}/unfreeze`, {}, { idempotencyKey: newKey() }), t('Freeze ended.')); } }]);
  const checkIn = () => Alert.alert(t('Is this {name}?', { name: d?.name ?? '' }), t('Look at who is in front of you. Check them in only if it is them.'), [{ text: t('No'), style: 'cancel' }, { text: t('Yes, check in'), onPress: () => { void run(() => api.post('/gym/access/manual', manualBody(Number(id), newKey(), 'IN')), t('Checked in.')); } }]);

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{d?.name ?? 'Member'}</Title>{d ? <Soft>{[d.member_code, d.phone].filter(Boolean).join(' · ')}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {m.busy && !d ? <Loading /> : null}
          {m.error && !d ? <Failed message={m.error} onRetry={() => { void m.refresh(); }} /> : null}
          {d ? (
            <>
              {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, paddingHorizontal: 16, paddingBottom: 8, fontWeight: '600' }}>{note}</Text> : null}
              <View style={[s.card, { marginHorizontal: 16, gap: 4 }]}>
                {cur ? (
                  <>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>{cur.plan_name}</Text>
                    <Text style={{ color: cur.state === 'ACTIVE' ? color.ok : color.warn, fontWeight: '600' }}>{t(STATE_TEXT[cur.state])}{left(cur)}</Text>
                    <Soft>{`${day(cur.start_date)} to ${day(cur.end_date)}`}</Soft>
                    {cur.amount_due > 0 ? <Text style={{ color: color.warn, fontWeight: '600' }}>{t('Still to pay')}: {inr(cur.amount_due)}</Text> : null}
                  </>
                ) : <Text style={{ color: color.ink }}>{ren ? t('Their last membership has ended.') : t('No membership yet.')}</Text>}
              </View>

              <View style={{ padding: 16, gap: 8 }}>
                <Button title={ren ? 'Renew membership' : 'Sell a membership'} onPress={() => { setPanel(panel === 'sell' ? '' : 'sell'); setError(''); }} selected={panel === 'sell'} />
                {cur && cur.state !== 'FROZEN' && cur.freeze_allowed ? <Button title="Freeze membership" kind="quiet" onPress={() => { setPanel(panel === 'freeze' ? '' : 'freeze'); setError(''); }} selected={panel === 'freeze'} /> : null}
                {cur?.state === 'FROZEN' ? <Button title="End the freeze" kind="quiet" onPress={unfreeze} busy={busy} /> : null}
                <Button title="Check in" kind="quiet" onPress={checkIn} disabled={busy} />
              </View>

              {panel === 'sell' ? (
                <View style={{ paddingHorizontal: 16, gap: 8 }}>
                  <SectionTitle>Choose a plan</SectionTitle>
                  {plans.busy && !plans.data ? <Loading /> : null}
                  {(plans.data ?? []).map((p) => <Line key={p.plan_id} left={p.name} sub={`${inr(Number(p.price))} · ${p.duration_days} days`} selected={p.plan_id === planId} onPress={() => setPlanId(p.plan_id)} />)}
                  {plan ? (
                    <>
                      <SectionTitle>How was it paid?</SectionTitle>
                      <Chips items={[{ id: 'FULL', label: 'All paid' }, { id: 'PART', label: 'Part paid' }, { id: 'LATER', label: 'Pay later' }]} value={pay} onChange={(v) => setPay(v as Pay)} />
                      {pay === 'PART' ? <TextInput style={s.input} value={part} onChangeText={(v) => setPart(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder={t('Amount paid now (₹)')} accessibilityLabel={t('Amount paid now (₹)')} /> : null}
                      {pay !== 'LATER' ? <Chips items={METHODS} value={method} onChange={setMethod} /> : null}
                      <Soft>The price, GST and dates are worked out when you save.</Soft>
                    </>
                  ) : null}
                  <ErrorText>{error}</ErrorText>
                  <Button title={ren ? 'Renew now' : 'Sell now'} onPress={sell} busy={busy} disabled={!plan} />
                </View>
              ) : null}

              {panel === 'freeze' && cur ? (
                <View style={{ paddingHorizontal: 16, gap: 8 }}>
                  <SectionTitle>Freeze from today</SectionTitle>
                  <TextInput style={s.input} value={days} onChangeText={(v) => setDays(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder={t('How many days')} accessibilityLabel={t('How many days')} maxLength={3} />
                  <Soft>{t('This plan allows up to {n} days.', { n: cur.max_freeze_days })}</Soft>
                  <ErrorText>{error}</ErrorText>
                  <Button title="Freeze now" onPress={freeze} busy={busy} />
                </View>
              ) : null}
              {!panel && error ? <ErrorText>{error}</ErrorText> : null}

              <SectionTitle>Visits</SectionTitle>
              <Soft style={{ paddingHorizontal: 16 }}>{t('{a} in the last 30 days · {b} in all', { a: d.stats.visits_30d, b: d.stats.visits })}</Soft>
              {d.recent_visits.length === 0 ? <Soft style={{ padding: 16 }}>No visits yet.</Soft> : d.recent_visits.slice(0, 8).map((v) => <Line key={v.attendance_id} left={day(v.check_in_at)} right={timeOf(v.check_in_at)} />)}
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
