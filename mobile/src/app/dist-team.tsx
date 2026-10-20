import { useState } from 'react';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { Card, Field, Input, Msg, Panel, Row, SetupShell, confirm, useAct, useList } from '../lib/formKit.tsx';
import {
  BASIS_CHOICES, PERIOD_CHOICES, ROLE_CHOICES, RULE_SCOPE_CHOICES, TARGET_SCOPE_CHOICES, emptyMember, emptyRule, emptyTarget, memberBody, memberForm, memberProblem, memberSub, ruleBody, ruleForm, ruleProblem, ruleSub, targetBody, targetProblem, targetSub,
  type Member, type MemberForm, type Rule, type RuleForm, type Target, type TargetForm
} from '../lib/distributorSales.ts';
import { Button, Chips, Failed, Line, Loading, Soft } from '../lib/ui.tsx';

type Choice = { id: string; label: string };
const today = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** What a target or a rule can point at, loaded when that kind is chosen. */
function useScope(type: string): Choice[] {
  const path = type === 'SALESPERSON' ? '/wholesale/salespeople?status=ACTIVE' : type === 'TERRITORY' ? '/distributor/territories' : type === 'BRAND' ? '/distributor/brands' : type === 'CATEGORY' ? '/wholesale/categories' : null;
  const rows = useList<Record<string, unknown>[]>(path).data;
  if (!path || !rows) return [];
  const key = type === 'SALESPERSON' ? 'salesperson_id' : type === 'TERRITORY' ? 'territory_id' : type === 'BRAND' ? 'brand_id' : 'category_id';
  return rows.map((r) => ({ id: String(r[key]), label: String(r.name) }));
}

const TeamTab = ({ edit }: { edit: boolean }) => {
  const [status, setStatus] = useState('ACTIVE');
  const list = useList<Member[]>(`/distributor/team?status=${status}`);
  const places = useList<{ territory_id: number; name: string }[]>('/distributor/territories');
  const [form, setForm] = useState<{ id?: number; f: MemberForm } | null>(null);
  const a = useAct();
  if (list.error && !list.data) return <Failed message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  const set = (patch: Partial<MemberForm>) => form && setForm({ ...form, f: { ...form.f, ...patch } });
  const placeChoices = [{ id: '', label: t('None') }, ...(places.data ?? []).map((p) => ({ id: String(p.territory_id), label: p.name }))];
  const bossChoices = [{ id: '', label: t('Nobody') }, ...list.data.filter((m) => m.salesperson_id !== form?.id).map((m) => ({ id: String(m.salesperson_id), label: m.name }))];
  return (
    <Panel>
      <Chips items={[{ id: 'ACTIVE', label: 'Active' }, { id: 'INACTIVE', label: 'Inactive' }]} value={status} onChange={setStatus} />
      {edit ? <Button title="Add a person" onPress={() => { a.setError(''); setForm({ f: emptyMember() }); }} /> : null}
      {list.data.length === 0 ? <Soft>{t('Add your salespeople, field reps and collection executives.')}</Soft> : null}
      {list.data.map((m) => <Line key={m.salesperson_id} left={m.name} sub={memberSub(m)} onPress={() => { if (edit) { a.setError(''); setForm({ id: m.salesperson_id, f: memberForm(m) }); } }} />)}
      {form ? (
        <Card>
          <Input label="Name" value={form.f.name} onChange={(v) => set({ name: v })} max={120} />
          <Input label="Employee ID" value={form.f.employee_id} onChange={(v) => set({ employee_id: v })} max={40} />
          <Input label="Phone" value={form.f.phone} onChange={(v) => set({ phone: v })} max={32} />
          <Input label="Email" value={form.f.email} onChange={(v) => set({ email: v })} />
          <Field label="Role"><Chips items={ROLE_CHOICES} value={form.f.sales_role} onChange={(v) => set({ sales_role: v })} /></Field>
          <Field label="Territory"><Chips items={placeChoices} value={form.f.territory_id} onChange={(v) => set({ territory_id: v })} /></Field>
          <Field label="Reports to"><Chips items={bossChoices} value={form.f.manager_id} onChange={(v) => set({ manager_id: v })} /></Field>
          <Input label="Default commission (%)" hint="Used where no commission rule applies" numeric value={form.f.commission_pct} onChange={(v) => set({ commission_pct: v })} max={6} />
          <Field label="Default commission on" hint={form.id ? 'Leave as it is, or choose' : undefined}><Chips items={[...(form.id ? [{ id: '', label: 'As it is' }] : []), { id: 'SALES', label: 'Sales invoiced' }, { id: 'COLLECTIONS', label: 'Payments collected' }]} value={form.f.commission_on} onChange={(v) => set({ commission_on: v })} /></Field>
          {form.id ? <Row label="Active" value={form.f.status === 'ACTIVE'} onChange={(v) => set({ status: v ? 'ACTIVE' : 'INACTIVE' })} /> : null}
          <Soft>{t('Linking a sign-in account is done on the web.')}</Soft>
          <Msg a={a} />
          <Button title="Save" busy={a.busy} onPress={() => { void a.run(memberProblem(form.f), async () => { await api.call(form.id ? `/wholesale/salespeople/${form.id}` : '/wholesale/salespeople', { method: form.id ? 'PUT' : 'POST', body: memberBody(form.f, Boolean(form.id)) }); setForm(null); list.reload(); }); }} />
          <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
        </Card>
      ) : null}
    </Panel>
  );
};

const TargetsTab = ({ edit }: { edit: boolean }) => {
  const [on] = useState(today());
  const list = useList<Target[]>(`/distributor/targets?on=${on}`);
  const [form, setForm] = useState<TargetForm | null>(null);
  const [open, setOpen] = useState<Target | null>(null);
  const choices = useScope(form?.scope_type ?? '');
  const a = useAct();
  if (list.error && !list.data) return <Failed message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  const set = (patch: Partial<TargetForm>) => form && setForm({ ...form, ...patch });
  return (
    <Panel>
      <Soft>{t('Targets running today. Setting one again for the same period changes it; it never adds a second.')}</Soft>
      {edit ? <Button title="Set a target" onPress={() => { a.setError(''); setOpen(null); setForm(emptyTarget(on)); }} /> : null}
      {list.data.length === 0 ? <Soft>{t('Set a monthly target for each salesperson, territory or brand to track how far they are.')}</Soft> : null}
      {list.data.map((x) => <Line key={x.target_id} left={x.scope_name} sub={targetSub(x)} onPress={() => { setForm(null); a.setError(''); a.setNote(''); setOpen(x); }} />)}
      {open ? (
        <Card>
          <Soft>{`${open.scope_name} · ${targetSub(open)}`}</Soft>
          <Msg a={a} />
          {edit ? <Button title="Remove" kind="danger" onPress={() => confirm(t('Remove this target?'), open.scope_name, 'Remove', () => { void a.run('', async () => { await api.call(`/distributor/targets/${open.target_id}`, { method: 'DELETE', body: {} }); setOpen(null); list.reload(); }, 'Removed'); })} /> : null}
          <Button title="Close" kind="quiet" onPress={() => setOpen(null)} />
        </Card>
      ) : null}
      {form ? (
        <Card>
          <Field label="Target for"><Chips items={TARGET_SCOPE_CHOICES} value={form.scope_type} onChange={(v) => set({ scope_type: v, scope_id: '' })} /></Field>
          {form.scope_type !== 'BUSINESS' ? <Field label="Choose"><Chips items={choices} value={form.scope_id} onChange={(v) => set({ scope_id: v })} /></Field> : null}
          <Field label="Period"><Chips items={PERIOD_CHOICES} value={form.period_type} onChange={(v) => set({ period_type: v })} /></Field>
          <Input label="Any day in the period" hint="Like 2026-11-01" value={form.date} onChange={(v) => set({ date: v })} max={10} />
          <Field label="Measured in"><Chips items={[{ id: 'VALUE', label: 'Sales value (before GST)' }, { id: 'QTY', label: 'Quantity sold' }]} value={form.metric} onChange={(v) => set({ metric: v })} /></Field>
          <Input label="Target" numeric value={form.target} onChange={(v) => set({ target: v })} max={12} />
          <Msg a={a} />
          <Button title="Save target" busy={a.busy} onPress={() => { void a.run(targetProblem(form), async () => { await api.post('/distributor/targets', targetBody(form)); setForm(null); list.reload(); }, 'Target saved'); }} />
          <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
        </Card>
      ) : null}
    </Panel>
  );
};

const CommissionTab = ({ edit }: { edit: boolean }) => {
  const list = useList<Rule[]>('/distributor/commission/rules');
  const reps = useList<{ salesperson_id: number; name: string }[]>('/wholesale/salespeople?status=ACTIVE');
  const [form, setForm] = useState<{ id?: number; f: RuleForm } | null>(null);
  const choices = useScope(form && form.f.scope_type !== 'ALL' ? form.f.scope_type : '');
  const a = useAct();
  if (list.error && !list.data) return <Failed message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  const set = (patch: Partial<RuleForm>) => form && setForm({ ...form, f: { ...form.f, ...patch } });
  const repChoices = [{ id: '', label: t('Every salesperson') }, ...(reps.data ?? []).map((r) => ({ id: String(r.salesperson_id), label: r.name }))];
  return (
    <Panel>
      <Soft>{t('Each sold line earns under the most specific rule that fits. Without rules each person earns their own default percentage.')}</Soft>
      {edit ? <Button title="New rule" onPress={() => { a.setError(''); setForm({ f: emptyRule() }); }} /> : null}
      {list.data.length === 0 ? <Soft>{t('No rules yet.')}</Soft> : null}
      {list.data.map((r) => <Line key={r.rule_id} left={r.name} sub={ruleSub(r)} onPress={() => { if (edit) { a.setError(''); setForm({ id: r.rule_id, f: ruleForm(r) }); } }} />)}
      {form ? (
        <Card>
          <Input label="Name" value={form.f.name} onChange={(v) => set({ name: v })} max={100} placeholder="2% on everything" />
          <Field label="Paid on"><Chips items={BASIS_CHOICES} value={form.f.basis} onChange={(v) => set({ basis: v })} /></Field>
          {form.f.basis === 'QTY' ? <Input label="Amount per unit" numeric value={form.f.per_unit} onChange={(v) => set({ per_unit: v })} max={8} /> : <Input label="Commission (%)" numeric value={form.f.rate_pct} onChange={(v) => set({ rate_pct: v })} max={6} />}
          <Field label="Applies to"><Chips items={RULE_SCOPE_CHOICES} value={form.f.scope_type} onChange={(v) => set({ scope_type: v, scope_id: '' })} /></Field>
          {form.f.scope_type !== 'ALL' ? <Field label="Choose"><Chips items={choices} value={form.f.scope_id} onChange={(v) => set({ scope_id: v })} /></Field> : null}
          <Field label="For"><Chips items={repChoices} value={form.f.salesperson_id} onChange={(v) => set({ salesperson_id: v })} /></Field>
          <Input label="Only once target is at least (%)" hint="Blank: no condition" numeric value={form.f.min_achievement_pct} onChange={(v) => set({ min_achievement_pct: v })} max={6} />
          <Input label="From" hint="Like 2026-11-01. Blank: always" value={form.f.starts_on} onChange={(v) => set({ starts_on: v })} max={10} />
          <Input label="To" value={form.f.ends_on} onChange={(v) => set({ ends_on: v })} max={10} />
          <Input label="Priority" hint="Higher wins between equally specific rules" value={form.f.priority} onChange={(v) => set({ priority: v.replace(/[^\d-]/g, '') })} max={4} />
          <Row label="Rule is switched on" value={form.f.is_active} onChange={(v) => set({ is_active: v })} />
          <Msg a={a} />
          <Button title="Save rule" busy={a.busy} onPress={() => { void a.run(ruleProblem(form.f), async () => { await api.call(form.id ? `/distributor/commission/rules/${form.id}` : '/distributor/commission/rules', { method: form.id ? 'PUT' : 'POST', body: ruleBody(form.f) }); setForm(null); list.reload(); }, 'Rule saved'); }} />
          {form.id ? <Button title="Delete" kind="danger" onPress={() => confirm(t('Delete {name}?', { name: form.f.name }), '', 'Delete', () => { void a.run('', async () => { await api.call(`/distributor/commission/rules/${form.id}`, { method: 'DELETE', body: {} }); setForm(null); list.reload(); }, 'Deleted'); })} /> : null}
          <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
        </Card>
      ) : null}
    </Panel>
  );
};

/* Sales team: who they are, what each should sell, and what they earn. */
export default function TeamScreen() {
  const me = currentBusiness(useSession());
  const [tab, setTab] = useState<'team' | 'targets' | 'commission'>('team');
  return (
    <SetupShell title="Sales team" sub="Your salespeople, their targets and what they earn" ok={allowed(me, 'targets', 'territories', 'reports', 'field_sales')} denied="You do not have access to the sales team.">
      <Chips items={[{ id: 'team', label: 'Team' }, { id: 'targets', label: 'Targets' }, { id: 'commission', label: 'Commission' }]} value={tab} onChange={setTab} />
      {tab === 'team' ? <TeamTab key="a" edit={allowed(me, 'settings')} /> : tab === 'targets' ? <TargetsTab key="b" edit={allowed(me, 'targets')} /> : <CommissionTab key="c" edit={allowed(me, 'targets')} />}
    </SetupShell>
  );
}
