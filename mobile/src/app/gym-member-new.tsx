import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { dmy, parseDmy } from '../lib/gymApp.ts';
import { METHODS, newMemberBody, newMemberProblem, rowsOf, sellBody, sellProblem, todayISO, type Pay } from '../lib/gymMembers.ts';
import { useLoad } from '../lib/useLoad.ts';
import { useSession } from '../lib/session.ts';
import { Chips, Group, Line, SectionTitle } from '../lib/ui.tsx';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';

type PlanRow = { plan_id: number; name: string; price: number | string; duration_days: number; is_active?: boolean };
/* A new member: name and mobile number are enough. If the number is already a member, the desk is asked before a second one is made. */
export default function GymMemberNew() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dupe, setDupe] = useState(false);
  const [key] = useState(() => newKey());
  const [sellKey] = useState(() => newKey());
  const session = useSession();
  const [gender, setGender] = useState('');
  const [dob, setDob] = useState('');
  const [planId, setPlanId] = useState<number | null>(null);
  const [start, setStart] = useState(dmy(todayISO()));
  const [disc, setDisc] = useState('');
  const [pct, setPct] = useState(false);
  const [pay, setPay] = useState<Pay>('FULL');
  const [method, setMethod] = useState('CASH');
  const [part, setPart] = useState('');
  const plans = useLoad<PlanRow[]>(`gym-plans-new:${session.businessId}:${session.branchId}`, () => api.get<PlanRow[] | { rows: PlanRow[] }>('/gym/plans?kind=MEMBERSHIP').then((r) => rowsOf(r).filter((p) => p.is_active !== false)));
  const plan = (plans.data ?? []).find((p) => p.plan_id === planId) ?? null;
  const price = plan ? Number(plan.price) : 0;
  const off = Math.min(price, Math.max(0, pct ? Math.round(price * Number(disc || 0)) / 100 : Number(disc || 0)));
  const payable = Math.max(0, price - off);
  const dueNow = pay === 'FULL' ? 0 : pay === 'PART' ? Math.max(0, payable - Number(part || 0)) : payable;

  const save = async (confirm = false) => {
    const bad = newMemberProblem(name, phone);
    if (bad) { setError(t(bad)); return; }
    if (dob.trim() && !parseDmy(dob)) { setError(t('Type the date like 23/11/2026')); return; }
    if (!parseDmy(start)) { setError(t('Type the date like 23/11/2026')); return; }
    setBusy(true); setError('');
    try {
      const extra = { ...(gender ? { gender } : {}), ...(parseDmy(dob) ? { dob: parseDmy(dob) } : {}) };
      const m = await api.post<{ member_id: number }>('/gym/members', { ...newMemberBody(name, phone, email, confirm), ...extra, joined_on: parseDmy(start) || todayISO() }, { idempotencyKey: key });
      if (planId) {
        const why = sellProblem(planId, pay, Number(part || 0));
        try {
          if (why) throw new Error(t(why));
          await api.post(`/gym/members/${m.member_id}/memberships`, { ...sellBody(planId, pay, method, Number(part || 0)), start_date: parseDmy(start) || todayISO(), ...(off > 0 ? { discount: off } : {}) }, { idempotencyKey: sellKey });
        } catch (e) { setError(`${t('The member was saved, but the plan was not sold')}: ${e instanceof Error ? e.message : ''}`); }
      }
      router.replace({ pathname: '/gym-member/[id]', params: { id: String(m.member_id) } });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 409 || /DUPLICATE/.test(e.code ?? ''))) setDupe(true);
      else setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.'));
    } finally { setBusy(false); }
  };
  const field = (label: string, v: string, on: (x: string) => void, o: { keyboard?: 'default' | 'phone-pad' | 'email-address'; max?: number } = {}) => (
    <View style={{ gap: 4 }}>
      <Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>
      <TextInput style={s.input} value={v} onChangeText={(x) => { on(x); setDupe(false); }} keyboardType={o.keyboard ?? 'default'} maxLength={o.max} autoCapitalize={o.keyboard === 'email-address' ? 'none' : 'words'} autoCorrect={false} accessibilityLabel={t(label)} />
    </View>
  );
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>New member</Title><Button title="Cancel" kind="quiet" onPress={() => goBack()} /></View>
          {field('Name', name, setName, { max: 80 })}
          {field('Mobile number', phone, setPhone, { keyboard: 'phone-pad', max: 16 })}
          {field('Email (optional)', email, setEmail, { keyboard: 'email-address', max: 120 })}
          <Text style={{ color: color.soft, fontSize: 13 }}>{t('Gender')}</Text>
          <Chips items={[{ id: 'FEMALE', label: 'Female' }, { id: 'MALE', label: 'Male' }, { id: 'OTHER', label: 'Other' }]} value={gender} onChange={setGender} />
          {field('Date of birth (DD/MM/YYYY, optional)', dob, setDob, { keyboard: 'phone-pad', max: 10 })}
          <SectionTitle>Membership plan (optional)</SectionTitle>
          {plans.busy && !plans.data ? <Soft>Loading</Soft> : null}
          <Group>{(plans.data ?? []).map((p) => <Line key={p.plan_id} left={p.name} sub={`${rupees(toPaise(p.price))} · ${p.duration_days} ${t('days')}`} selected={p.plan_id === planId} onPress={() => setPlanId(p.plan_id === planId ? null : p.plan_id)} />)}</Group>
          {plan ? <>
            {field('Joining date (DD/MM/YYYY)', start, setStart, { keyboard: 'phone-pad', max: 10 })}
            <Chips items={[{ id: 'amt', label: 'Discount in ₹' }, { id: 'pct', label: 'Discount in %' }]} value={pct ? 'pct' : 'amt'} onChange={(v) => setPct(v === 'pct')} />
            {field(pct ? 'Discount %' : 'Discount ₹', disc, setDisc, { keyboard: 'phone-pad', max: 7 })}
            <Chips items={[{ id: 'FULL', label: 'Paid in full' }, { id: 'PART', label: 'Part paid' }, { id: 'LATER', label: 'Pay later' }]} value={pay} onChange={(v) => setPay(v as Pay)} />
            {pay === 'PART' ? field('Amount paid now ₹', part, setPart, { keyboard: 'phone-pad', max: 8 }) : null}
            {pay !== 'LATER' ? <Chips items={METHODS} value={method} onChange={setMethod} /> : null}
            <View style={[s.card, { gap: 4 }]}>
              <Text style={{ color: color.ink }}>{t('Plan amount')}: {rupees(toPaise(price))}</Text>
              {off > 0 ? <Text style={{ color: color.ink }}>{t('Discount')}: -{rupees(toPaise(off))}</Text> : null}
              <Text style={{ color: color.ink, fontWeight: '700' }}>{t('To pay')}: {rupees(toPaise(payable))}</Text>
              <Text style={{ color: dueNow ? color.danger : color.ok, fontWeight: '600' }}>{t('Due')}: {rupees(toPaise(dueNow))}</Text>
            </View>
          </> : <Soft>Pick a plan to sell it now, or skip and do it later from the member page.</Soft>}
          <ErrorText>{error}</ErrorText>
          {dupe ? (
            <View style={[s.card, { gap: 8 }]}>
              <Text style={{ color: color.warn, fontWeight: '600' }}>{t('Someone with this number is already a member.')}</Text>
              <Button title="Go back and search for them" kind="quiet" onPress={() => router.replace('/gym-members')} />
              <Button title="Add as a new member anyway" kind="quiet" onPress={() => { void save(true); }} busy={busy} />
            </View>
          ) : <Button title="Save member" onPress={() => { void save(); }} busy={busy} />}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
