import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { AUDIENCES, DAYS, DURATIONS, PAYMENT_POLICIES, branchOn, emptyPlan, planBody, planForm, planProblem, toggleBranch, toggleIn, type GymSettings, type Plan, type PlanForm } from '../lib/gymSetup.ts';
import { Button, Chips, ErrorText, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* A new plan, or one changed. Changing a plan does not change memberships already sold. */
export default function GymPlanEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [f, setF] = useState<PlanForm>(emptyPlan());
  const [branches, setBranches] = useState<GymSettings['branches']>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    Promise.all([api.get<GymSettings>('/gym/settings'), id ? api.get<Plan[]>('/gym/plans?all=true') : Promise.resolve([] as Plan[])]).then(([st, plans]) => {
      setBranches(st.branches);
      const p = id ? plans.find((x) => x.plan_id === Number(id)) ?? null : null;
      setPlan(p); if (p) setF(planForm(p));
      setLoaded(true);
    }).catch((e: Error) => { setError(e.message || t('Could not load.')); setLoaded(true); });
  }, [id]);

  const save = async () => {
    const bad = planProblem(f);
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError('');
    try { await api.call(plan ? `/gym/plans/${plan.plan_id}` : '/gym/plans', { method: plan ? 'PUT' : 'POST', body: planBody(f, branches.map((b) => b.branch_id)) }); router.back(); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); } finally { setBusy(false); }
  };
  const text = (k: 'name' | 'duration_days' | 'description' | 'price' | 'tax_rate' | 'max_members' | 'pay_later_days' | 'grace_days' | 'max_freeze_days' | 'from' | 'to', label: string, o: { hint?: string; numeric?: boolean; placeholder?: string; max?: number } = {}) => (
    <View style={{ gap: 4 }}>
      <Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>
      <TextInput style={s.input} value={f[k]} onChangeText={(v) => set(k, o.numeric ? v.replace(/[^\d.]/g, '') : v)} keyboardType={o.numeric ? 'decimal-pad' : 'default'} placeholder={o.placeholder} maxLength={o.max} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t(label)} />
      {o.hint ? <Soft>{t(o.hint)}</Soft> : null}
    </View>
  );
  const row = (label: string, value: boolean, on: (v: boolean) => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><Text style={{ color: color.ink, flex: 1 }}>{t(label)}</Text><Switch value={value} onValueChange={on} accessibilityLabel={t(label)} /></View>
  );
  const allIds = branches.map((b) => b.branch_id);

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>{plan ? t('Edit {name}', { name: plan.name }) : 'New plan'}</Title><Button title="Cancel" kind="quiet" onPress={() => goBack()} /></View>
          {!loaded ? <Loading /> : (
            <>
              {plan ? <Soft>{t('Changing a plan does not change memberships already sold: each keeps the rules it was sold with.')}</Soft> : null}
              {text('name', 'Name', { placeholder: t('Monthly, Student quarterly, Off-peak annual'), max: 80 })}
              <Text style={{ color: color.soft, fontSize: 13 }}>{t('Who it is for')}</Text>
              <Chips items={AUDIENCES.map(([v, l]) => ({ id: v, label: l }))} value={f.audience} onChange={(v) => set('audience', v)} />
              <Text style={{ color: color.soft, fontSize: 13 }}>{t('Length')}</Text>
              <Chips items={DURATIONS.map(([v, l]) => ({ id: v, label: l }))} value={f.custom ? 'custom' : f.duration_days} onChange={(v) => { if (v === 'custom') set('custom', true); else setF((x) => ({ ...x, custom: false, duration_days: v })); }} />
              {f.custom ? text('duration_days', 'Length in days', { numeric: true, max: 4 }) : null}
              {text('price', 'Price (₹, before GST)', { numeric: true })}
              {text('tax_rate', 'GST rate', { numeric: true, hint: 'Gym memberships are usually 18%.', max: 5 })}
              {text('description', 'Description (optional)', { max: 300 })}
              {f.audience === 'FAMILY' || Number(f.max_members) > 1 ? text('max_members', 'People covered', { numeric: true, hint: 'The person who pays plus the others on the same membership.', max: 2 }) : null}

              <SectionTitle>Payment and access</SectionTitle>
              <Text style={{ color: color.soft, fontSize: 13 }}>{t('Can they come in before they have paid?')}</Text>
              <Chips items={PAYMENT_POLICIES.map(([v, l]) => ({ id: v, label: l }))} value={f.payment_policy} onChange={(v) => set('payment_policy', v)} />
              {f.payment_policy === 'PAY_LATER' ? text('pay_later_days', 'Days they can come in before paying', { numeric: true, max: 3 }) : null}
              {text('grace_days', 'Grace days after it ends (optional)', { numeric: true, hint: "Empty uses the gym's default. 0 means none for this plan.", max: 3 })}

              <SectionTitle>Where and when it works</SectionTitle>
              {branches.length > 1 ? (
                <>
                  <Text style={{ color: color.soft, fontSize: 13 }}>{t('Branches')}</Text>
                  {branches.map((b) => row(b.name, branchOn(f, b.branch_id), () => set('branches', toggleBranch(f, b.branch_id, allIds))))}
                </>
              ) : null}
              {row('Only at certain times (an off-peak plan)', f.timed, (v) => set('timed', v))}
              {f.timed ? (
                <>
                  <Text style={{ color: color.soft, fontSize: 13 }}>{t('Days')}</Text>
                  <Chips items={DAYS.map(([d, n]) => ({ id: String(d), label: f.days.includes(d) ? `✓ ${t(n)}` : t(n) }))} value="" onChange={(v) => set('days', toggleIn(f.days, Number(v)))} />
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>{text('from', 'From', { placeholder: '06:00', max: 5 })}</View><View style={{ flex: 1 }}>{text('to', 'To', { placeholder: '22:00', max: 5 })}</View>
                  </View>
                </>
              ) : null}
              {row('Members can freeze it', f.freeze_allowed, (v) => set('freeze_allowed', v))}
              {f.freeze_allowed ? text('max_freeze_days', 'Most days they can freeze in all', { numeric: true, max: 3 }) : null}

              <ErrorText>{error}</ErrorText>
              <Button title={plan ? 'Save plan' : 'Create plan'} onPress={() => { void save(); }} busy={busy} />
            </>
          )}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
