import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { RefreshControl, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import {
  BILL_CHOICES, VISIT_CHOICES, adjustBody, adjustProblem, canLoyalty, couponLine, couponState, dishPrice, exampleEarn, memberLine, newTier, percentOf, pointsBody, pointsForm, pointsProblem, programBody, programForm, programProblem, todayText,
  type Coupon, type Dish, type PointsForm, type PointsProgram, type PointsSummary, type Program, type ProgramForm, type Stats
} from '../lib/loyalty.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));
const why = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : t('Could not save. Check the connection and try again.'));

const Labeled = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>{children}{hint ? <Soft>{t(hint)}</Soft> : null}</View>
);
const Row = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><Text style={{ color: color.ink, fontWeight: '600', flex: 1 }}>{t(label)}</Text><Switch value={value} onValueChange={onChange} accessibilityLabel={t(label)} /></View>
);

/* ── visit card ──────────────────────────────────────────────────────────── */
const VisitCard = () => {
  const [form, setForm] = useState<ProgramForm | null>(null);
  const [saved, setSaved] = useState('');
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState('');
  const load = useCallback(async () => {
    try {
      const [program, products, summary] = await Promise.all([api.get<Program>('/loyalty/program'), api.get<Dish[]>('/products?kind=DISH'), api.get<Stats>('/loyalty/summary')]);
      const f = programForm(program); setForm(f); setSaved(JSON.stringify(f)); setDishes(products); setStats(summary); setError('');
    } catch (e) { setError(e instanceof ApiError && e.status === 403 ? t('Loyalty is set up by owners and admins.') : e instanceof Error ? e.message : t('Could not load.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!form) return error ? <Failed message={error} onRetry={() => { void load(); }} /> : <Loading />;

  const reward = dishes.find((d) => String(d.product_id) === form.reward_product_id);
  const n = Math.max(2, Number(form.visits_required) || 7);
  const qty = Number(form.reward_quantity) || 1;
  const dirty = JSON.stringify(form) !== saved;
  const set = <K extends keyof ProgramForm>(k: K, v: ProgramForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const save = async () => {
    const problem = programProblem(form);
    if (problem) { setError(t(problem)); return; }
    setBusy(true); setError('');
    try { await api.call('/loyalty/program', { method: 'PUT', body: programBody(form) }); await load(); } catch (e) { setError(why(e)); } finally { setBusy(false); }
  };
  const shown = dishes.filter((d) => d.name.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 30);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <Soft>{t('A customer is their mobile number. Every day they are billed counts as one visit, at any outlet. On the visit that earns it, the free item comes off the bill once it is on the order (the till offers to add it).')}</Soft>
      <Row label="Visit card on" value={form.is_enabled} onChange={(v) => set('is_enabled', v)} />
      <Labeled label="What is free?">
        {reward && !picking ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: color.ink, fontWeight: '600', flex: 1 }}>{reward.name}</Text><Button title="Change" kind="quiet" onPress={() => setPicking(true)} />
          </View>
        ) : (
          <>
            <TextInput style={s.input} value={filter} onChangeText={setFilter} placeholder={t('Choose from your menu…')} autoCorrect={false} accessibilityLabel={t('What is free?')} onFocus={() => setPicking(true)} />
            {picking || !form.reward_product_id ? shown.map((d) => (
              <Line key={d.product_id} left={d.name} right={money(dishPrice(d))} selected={String(d.product_id) === form.reward_product_id} onPress={() => { set('reward_product_id', String(d.product_id)); setPicking(false); setFilter(''); }} />
            )) : null}
          </>
        )}
      </Labeled>
      {reward ? <Soft>{t('Worth {value} to the customer.', { value: money(qty * dishPrice(reward)) })}</Soft> : null}
      <Labeled label="How many free"><Chips items={['1', '2', '3', '4'].map((x) => ({ id: x, label: `× ${x}` }))} value={form.reward_quantity} onChange={(v) => set('reward_quantity', v)} /></Labeled>
      <Labeled label="On which visit?">
        <Chips items={VISIT_CHOICES.map((x) => ({ id: String(x), label: t('Visit {n}', { n: x }) }))} value={VISIT_CHOICES.includes(n) && form.visits_required === String(n) ? String(n) : ''} onChange={(v) => set('visits_required', v)} />
        <TextInput style={s.input} value={form.visits_required} onChangeText={(v) => set('visits_required', v.replace(/\D/g, ''))} keyboardType="numeric" maxLength={2} accessibilityLabel={t('Visit number')} />
      </Labeled>
      <Labeled label="Which bills earn a stamp?">
        <Chips items={BILL_CHOICES.map((b) => ({ id: b.value || 'all', label: b.label }))} value={form.min_bill === '' ? 'all' : BILL_CHOICES.some((b) => b.value === form.min_bill) ? form.min_bill : ''} onChange={(v) => set('min_bill', v === 'all' ? '' : v)} />
        <TextInput style={s.input} value={form.min_bill} onChangeText={(v) => set('min_bill', v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder={t('Minimum bill (₹)')} accessibilityLabel={t('Minimum bill (₹)')} />
      </Labeled>
      <Soft>{reward ? `${t('Customers get {item} free on their visit {n}, then the card starts again.', { item: `${qty > 1 ? `${qty} × ` : ''}${reward.name}`, n })}${Number(form.min_bill) > 0 ? ` ${t('Only bills of {value} or more earn a stamp.', { value: money(Number(form.min_bill)) })}` : ''}` : t('Pick the item that will be free.')}</Soft>
      <ErrorText>{error}</ErrorText>
      <Soft>{dirty ? t('You have changes not saved yet.') : t('Saved.')}</Soft>
      <Button title="Save" onPress={() => { void save(); }} busy={busy} disabled={!dirty} />

      {stats ? (
        <>
          <SectionTitle>Members</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Stat label="Members" value={String(stats.members)} /><Stat label="Came back, 30 days" value={String(stats.active_30d)} />
            <Stat label="Free items given" value={String(stats.rewards_redeemed)} /><Stat label="Not back in 60 days" value={String(stats.lapsed_60d)} tone={stats.lapsed_60d > 0 ? color.warn : undefined} />
          </View>
          <Soft>{[t('{n} new in the last 30 days', { n: stats.new_30d }), t('{n} visits stamped', { n: stats.visits_30d }), t('{n} in 30 days · worth {value}', { n: stats.rewards_redeemed_30d, value: money(stats.rewards_value) })].join(' · ')}</Soft>
          <SectionTitle>How often members come</SectionTitle>
          {stats.by_visits.map((b) => <Line key={b.label} left={t(b.label)} right={`${b.count} · ${percentOf(b.count, stats.members)}%`} />)}
          <SectionTitle>Free item due now</SectionTitle>
          <Soft>{t('Their next bill gets the free item. A nice reason to call them in.')}</Soft>
          {stats.reward_due.members.length === 0 ? <Soft>{t('Nobody has a reward waiting.')}</Soft> : stats.reward_due.members.map((m) => <Line key={m.customer_id} left={m.name} sub={memberLine(m)} right={m.phone ?? ''} />)}
          {stats.reward_due.count > stats.reward_due.members.length ? <Soft>{t('and {n} more.', { n: stats.reward_due.count - stats.reward_due.members.length })}</Soft> : null}
          <SectionTitle>One visit away</SectionTitle>
          <Soft>{t('One more visit and the next one is free.')}</Soft>
          {stats.one_visit_away.members.length === 0 ? <Soft>{t('Nobody is one visit away right now.')}</Soft> : stats.one_visit_away.members.map((m) => <Line key={m.customer_id} left={m.name} sub={memberLine(m)} right={m.phone ?? ''} />)}
          {stats.one_visit_away.count > stats.one_visit_away.members.length ? <Soft>{t('and {n} more.', { n: stats.one_visit_away.count - stats.one_visit_away.members.length })}</Soft> : null}
          {stats.regulars.length > 0 ? (
            <>
              <SectionTitle>Your regulars</SectionTitle>
              {stats.regulars.map((r) => <Line key={r.customer_id} left={r.name} sub={r.phone ?? ''} right={r.reward_ready ? t('Free item due') : t('{visits} visits', { visits: r.visits })} />)}
            </>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
};

/* ── points and tiers ────────────────────────────────────────────────────── */
const Adjust = ({ onDone }: { onDone: () => void }) => {
  const [phone, setPhone] = useState('');
  const [who, setWho] = useState<{ customer_id: number; name: string } | null>(null);
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const find = async () => {
    setError(''); setMessage(''); setWho(null);
    try { const r = await api.get<{ customer: { customer_id: number; name: string } | null }>(`/loyalty/lookup?phone=${encodeURIComponent(phone.trim())}`); if (r.customer) setWho(r.customer); else setError(t('No customer with that number.')); } catch (e) { setError(why(e)); }
  };
  const give = async () => {
    const problem = adjustProblem(points, note);
    if (!who || problem) { setError(problem ? t(problem) : ''); return; }
    setBusy(true); setError('');
    try { const card = await api.post<{ balance: number }>(`/loyalty/customers/${who.customer_id}/points/adjust`, adjustBody(points, note)); setMessage(t('{name} now has {balance} points', { name: who.name, balance: card.balance })); setPoints(''); setNote(''); onDone(); } catch (e) { setError(why(e)); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 10 }}>
      <SectionTitle>Give or take points</SectionTitle>
      <TextInput style={s.input} value={phone} onChangeText={(v) => setPhone(v.replace(/[^\d+]/g, ''))} keyboardType="phone-pad" placeholder={t('Customer mobile number')} accessibilityLabel={t('Customer mobile number')} />
      <Button title="Find" kind="quiet" onPress={() => { void find(); }} />
      {who ? (
        <>
          <Labeled label={t('Points for {name}', { name: who.name })} hint="Negative takes away"><TextInput style={s.input} value={points} onChangeText={(v) => setPoints(v.replace(/[^\d-]/g, ''))} keyboardType="numbers-and-punctuation" accessibilityLabel={t('Points for {name}', { name: who.name })} /></Labeled>
          <Labeled label="Reason (kept in their history)"><TextInput style={s.input} value={note} onChangeText={setNote} placeholder={t('Birthday gift, service recovery…')} accessibilityLabel={t('Reason (kept in their history)')} /></Labeled>
          <Button title="Save" onPress={() => { void give(); }} busy={busy} />
        </>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {message ? <Soft>{message}</Soft> : null}
    </View>
  );
};

const Points = () => {
  const [form, setForm] = useState<PointsForm | null>(null);
  const [summary, setSummary] = useState<PointsSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const [p, sm] = await Promise.all([api.get<PointsProgram>('/loyalty/points-program'), api.get<PointsSummary>('/loyalty/points-summary').catch(() => null)]); setForm(pointsForm(p)); setSummary(sm); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!form) return error ? <Failed message={error} onRetry={() => { void load(); }} /> : <Loading />;
  const set = <K extends keyof PointsForm>(k: K, v: PointsForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setTier = (i: number, k: 'name' | 'min_points' | 'multiplier', v: string) => setForm((f) => (f ? { ...f, tiers: f.tiers.map((x, j) => (j === i ? { ...x, [k]: v } : x)) } : f));
  const save = async () => {
    const problem = pointsProblem(form);
    if (problem) { setError(t(problem)); return; }
    setBusy(true); setError('');
    try { const saved = await api.call<PointsProgram>('/loyalty/points-program', { method: 'PUT', body: pointsBody(form) }); if (saved.data) setForm(pointsForm(saved.data)); await load(); } catch (e) { setError(why(e)); } finally { setBusy(false); }
  };
  const num = (k: 'earn_per_100' | 'point_value' | 'min_redeem_points' | 'max_redeem_pct', label: string, hint?: string, decimal = false) => (
    <Labeled label={label} hint={hint}><TextInput style={s.input} value={form[k]} onChangeText={(v) => set(k, v.replace(decimal ? /[^\d.]/g : /\D/g, ''))} keyboardType={decimal ? 'decimal-pad' : 'numeric'} accessibilityLabel={t(label)} /></Labeled>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <Row label="Loyalty points are on" value={form.is_enabled} onChange={(v) => set('is_enabled', v)} />
      {num('earn_per_100', 'Points earned per ₹100 paid', t('A bill of ₹500 earns {n} points.', { n: exampleEarn(form.earn_per_100) }), true)}
      {num('point_value', 'One point is worth (in rupees)', 'What a customer saves per point spent.', true)}
      {num('min_redeem_points', 'Least points that can be spent')}
      {num('max_redeem_pct', 'Most of one bill points can pay (%)')}
      <SectionTitle>Tiers</SectionTitle>
      <Soft>{t('A tier is decided by the points a customer has earned over time (spending points never lowers it). A higher tier earns points faster. The first tier must start at 0. Leave empty for no tiers.')}</Soft>
      {form.tiers.map((x, i) => (
        <View key={i} style={{ gap: 6 }}>
          <TextInput style={s.input} value={x.name} onChangeText={(v) => setTier(i, 'name', v)} placeholder={t('Tier name')} maxLength={30} accessibilityLabel={t('Tier name')} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput style={[s.input, { flex: 1 }]} value={x.min_points} onChangeText={(v) => setTier(i, 'min_points', v.replace(/\D/g, ''))} keyboardType="numeric" placeholder={t('From points')} accessibilityLabel={t('From points')} />
            <TextInput style={[s.input, { flex: 1 }]} value={x.multiplier} onChangeText={(v) => setTier(i, 'multiplier', v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder={t('× earning')} accessibilityLabel={t('× earning')} />
            <Button title="Remove" kind="quiet" onPress={() => set('tiers', form.tiers.filter((_, j) => j !== i))} />
          </View>
        </View>
      ))}
      {form.tiers.length < 6 ? <Button title="Add tier" kind="quiet" onPress={() => set('tiers', [...form.tiers, newTier(form)])} /> : null}
      <ErrorText>{error}</ErrorText>
      <Button title="Save" onPress={() => { void save(); }} busy={busy} />
      {summary?.enabled ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Stat label="Customers with points" value={String(summary.members_with_points)} />
            <Stat label="Points outstanding" value={t('{points} ({value})', { points: summary.outstanding_points, value: money(summary.liability) })} />
            <Stat label="Earned, last 30 days" value={String(summary.earned_30d)} />
            <Stat label="Spent, last 30 days" value={t('{points} ({value} off)', { points: summary.redeemed_30d, value: money(summary.discount_30d) })} />
          </View>
          {summary.top.length > 0 ? <SectionTitle>Top holders</SectionTitle> : null}
          {summary.top.map((c) => <Line key={c.customer_id} left={c.name} sub={`${c.phone ?? ''} · ${t('{earned} earned over time', { earned: c.lifetime ?? 0 })}`} right={t('{balance} points', { balance: c.balance })} />)}
        </>
      ) : null}
      {form.is_enabled ? <Adjust onDone={() => { void load(); }} /> : null}
    </ScrollView>
  );
};

/* ── coupons ─────────────────────────────────────────────────────────────── */
const Coupons = () => {
  const [rows, setRows] = useState<Coupon[] | null>(null);
  const [error, setError] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setRows(await api.get<Coupon[]>('/coupons')); setError(''); } catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); } finally { setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const toggle = async (c: Coupon) => { setProblem(''); try { await api.call(`/coupons/${c.coupon_id}`, { method: 'PUT', body: { is_active: !c.is_active } }); await load(); } catch (e) { setProblem(why(e)); } };
  if (error && !rows) return <Failed message={error} onRetry={() => { void load(); }} />;
  if (!rows) return <Loading />;
  const today = todayText();
  return (
    <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { void load(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={{ padding: 16, gap: 8 }}><Button title="New coupon" onPress={() => router.push('/coupon-edit')} /><ErrorText>{problem}</ErrorText></View>
      {rows.length === 0 ? <Empty>No coupons yet. Create one and give the code to a customer; the cashier enters it at billing.</Empty> : null}
      {rows.map((c) => (
        <View key={c.coupon_id}>
          <Line left={c.code} right={t(couponState(c, today))} sub={`${c.description ? `${c.description} · ` : ''}${couponLine(c)}`} onPress={() => router.push({ pathname: '/coupon-edit', params: { id: String(c.coupon_id) } })} />
          <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><Button title={c.is_active ? 'Turn off' : 'Turn on'} kind="quiet" onPress={() => { void toggle(c); }} /></View>
        </View>
      ))}
    </ScrollView>
  );
};

/* Loyalty and coupons (owner and admin): the visit card, points and tiers, and offer codes. */
export default function Loyalty() {
  const me = currentBusiness(useSession());
  const [tab, setTab] = useState<'card' | 'points' | 'coupons'>('card');
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Loyalty & coupons</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!canLoyalty(me?.role) ? <Empty>Loyalty is set up by owners and admins.</Empty> : (
          <>
            <Chips items={[{ id: 'card', label: 'Visit card' }, { id: 'points', label: 'Points & tiers' }, { id: 'coupons', label: 'Coupons' }]} value={tab} onChange={setTab} />
            {tab === 'card' ? <VisitCard /> : tab === 'points' ? <Points /> : <Coupons />}
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
