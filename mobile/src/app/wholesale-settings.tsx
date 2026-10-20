import { useEffect, useState } from 'react';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { Card, Field, Input, Msg, Panel, Row, SetupShell, useAct, useList } from '../lib/formKit.tsx';
import {
  CREDIT_CHOICES, NOTIFY, STACKING_CHOICES, canWholesaleSettings, emptySp, spBody, spForm, spProblem, spSub, wbody, wform, wproblem, type Salesperson, type SpForm, type WForm, type WSettings
} from '../lib/wholesaleSettings.ts';
import { Button, Chips, Failed, Line, Loading, SectionTitle, Soft } from '../lib/ui.tsx';

const tr = (items: { id: string; label: string }[]) => items.map((x) => ({ id: x.id, label: t(x.label) }));

const RulesTab = ({ edit }: { edit: boolean }) => {
  const st = useList<WSettings>('/wholesale/settings');
  const lists = useList<{ list_id: number; name: string; kind: string }[]>('/wholesale/price-lists');
  const [f, setF] = useState<WForm | null>(null);
  const a = useAct();
  useEffect(() => { if (st.data) setF(wform(st.data)); }, [st.data]);
  if (!f || !st.data) return st.error ? <Failed message={st.error} onRetry={st.reload} /> : <Loading />;
  const set = (patch: Partial<WForm>) => setF({ ...f, ...patch });
  const listChoices = [{ id: '', label: t('None') }, ...(lists.data ?? []).filter((l) => l.kind === 'STANDARD').map((l) => ({ id: String(l.list_id), label: l.name }))];
  return (
    <Panel>
      {st.data.distributor_enabled ? (
        <>
          <SectionTitle>Distributor tools</SectionTitle>
          <Soft>{t('On for this business. FlowXP support sets this; ask them if you need it changed.')}</Soft>
          <Field label="When several schemes fit an order"><Chips items={tr(STACKING_CHOICES)} value={f.scheme_stacking} onChange={(v) => set({ scheme_stacking: v })} /></Field>
          <Row label="Field reps may collect payments" hint="Off: only the office records receipts" value={f.field_collections} onChange={(v) => set({ field_collections: v })} />
          <Row label="A manager may override a credit block" hint="Off: a blocked order stays blocked until the customer pays" value={f.credit_manager_override} onChange={(v) => set({ credit_manager_override: v })} />
          <Row label="Keep the location of a visit" hint="Only the place a rep records a visit is stored, and only when they choose to share it" value={f.visit_location} onChange={(v) => set({ visit_location: v })} />
        </>
      ) : null}
      <SectionTitle>Credit control</SectionTitle>
      <Soft>{t("What happens when a customer's order would take them past their credit limit")}</Soft>
      <Field label="When over the limit" hint="A customer can have their own rule on their profile"><Chips items={tr(CREDIT_CHOICES)} value={f.credit_policy} onChange={(v) => set({ credit_policy: v })} /></Field>
      <Input label="Grace period for overdue (days)" hint="Invoices count as overdue this many days after their due date" numeric value={f.overdue_grace_days} onChange={(v) => set({ overdue_grace_days: v })} max={3} />
      <Row label="Hold orders from customers with overdue invoices" hint="Even if they are inside their credit limit" value={f.block_when_overdue} onChange={(v) => set({ block_when_overdue: v })} />
      <SectionTitle>Orders and pricing</SectionTitle>
      <Input label="Default payment terms (days)" numeric value={f.default_payment_terms_days} onChange={(v) => set({ default_payment_terms_days: v })} max={3} />
      <Field label="Default price list" hint="For customers with no list of their own"><Chips items={listChoices} value={f.default_price_list_id} onChange={(v) => set({ default_price_list_id: v })} /></Field>
      <Input label="Orders over this need manager approval" hint="Blank for no limit" numeric value={f.order_approval_over} onChange={(v) => set({ order_approval_over: v })} max={10} />
      <Input label="Order number prefix" hint="Letters and digits, up to 8" upper value={f.order_prefix} onChange={(v) => set({ order_prefix: v })} max={8} />
      <Input label="Invoice footer note" value={f.invoice_footer} onChange={(v) => set({ invoice_footer: v })} max={300} />
      <SectionTitle>Stock rules</SectionTitle>
      <Row label="Reserve stock when an order is confirmed" hint="Reserved stock cannot be sold to someone else" value={f.reserve_on_confirm} onChange={(v) => set({ reserve_on_confirm: v })} />
      <Row label="Pick the soonest expiry first" hint="Otherwise the oldest received batch goes first" value={f.fefo} onChange={(v) => set({ fefo: v })} />
      <Input label="Expiry alerts, days before" hint="Up to six numbers, like 30, 60, 90" value={f.expiry_alert_days} onChange={(v) => set({ expiry_alert_days: v.replace(/[^\d,\s]/g, '') })} max={40} />
      <Input label="Slow-moving after (days)" numeric value={f.slow_moving_days} onChange={(v) => set({ slow_moving_days: v })} max={4} />
      <Input label="Dead stock after (days)" numeric value={f.dead_stock_days} onChange={(v) => set({ dead_stock_days: v })} max={4} />
      <SectionTitle>Customer messages</SectionTitle>
      <Soft>{t('Sent through the channel you set up under Messaging. If messaging is off, nothing is sent.')}</Soft>
      {NOTIFY.map(([k, label, hint]) => <Row key={k} label={label} hint={hint} value={f.notifications[k] === true} onChange={(v) => set({ notifications: { ...f.notifications, [k]: v } })} />)}
      <Msg a={a} />
      {edit ? <Button title="Save settings" busy={a.busy} onPress={() => { void a.run(wproblem(f), async () => { await api.call('/wholesale/settings', { method: 'PUT', body: wbody(f) }); st.reload(); }); }} /> : null}
    </Panel>
  );
};

const PeopleTab = ({ edit }: { edit: boolean }) => {
  const [status, setStatus] = useState('ACTIVE');
  const list = useList<Salesperson[]>(`/wholesale/salespeople?status=${status}`);
  const [form, setForm] = useState<{ id?: number; f: SpForm } | null>(null);
  const a = useAct();
  if (list.error && !list.data) return <Failed message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  const set = (patch: Partial<SpForm>) => form && setForm({ ...form, f: { ...form.f, ...patch } });
  return (
    <Panel>
      <Chips items={[{ id: 'ACTIVE', label: 'Active' }, { id: 'INACTIVE', label: 'Inactive' }]} value={status} onChange={setStatus} />
      {edit ? <Button title="Add a salesperson" onPress={() => { a.setError(''); setForm({ f: emptySp() }); }} /> : null}
      {list.data.length === 0 ? <Soft>{t('Add the people who sell for you to assign customers and track commission.')}</Soft> : null}
      {list.data.map((p) => <Line key={p.salesperson_id} left={p.name} sub={spSub(p)} onPress={() => { if (edit) { a.setError(''); setForm({ id: p.salesperson_id, f: spForm(p) }); } }} />)}
      {form ? (
        <Card>
          <Input label="Name" value={form.f.name} onChange={(v) => set({ name: v })} max={120} />
          <Input label="Phone" value={form.f.phone} onChange={(v) => set({ phone: v })} max={32} />
          <Input label="Email" value={form.f.email} onChange={(v) => set({ email: v })} />
          <Input label="Territory" value={form.f.territory} onChange={(v) => set({ territory: v })} max={120} />
          <Input label="Commission (%)" numeric value={form.f.commission_pct} onChange={(v) => set({ commission_pct: v })} max={6} />
          <Field label="Commission on"><Chips items={[{ id: 'SALES', label: t('Sales invoiced') }, { id: 'COLLECTIONS', label: t('Payments collected') }]} value={form.f.commission_on} onChange={(v) => set({ commission_on: v })} /></Field>
          {form.id ? <Row label="Active" value={form.f.status === 'ACTIVE'} onChange={(v) => set({ status: v ? 'ACTIVE' : 'INACTIVE' })} /> : null}
          <Soft>{t('Linking a sign-in account is done on the web.')}</Soft>
          <Msg a={a} />
          <Button title="Save" busy={a.busy} onPress={() => { void a.run(spProblem(form.f), async () => { await api.call(form.id ? `/wholesale/salespeople/${form.id}` : '/wholesale/salespeople', { method: form.id ? 'PUT' : 'POST', body: spBody(form.f, Boolean(form.id)) }); setForm(null); list.reload(); }); }} />
          <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
        </Card>
      ) : null}
    </Panel>
  );
};

/* Wholesale settings: credit rules, stock rules, approvals, customer messages, and the salespeople. */
export default function WholesaleSettingsScreen() {
  const me = currentBusiness(useSession());
  const [tab, setTab] = useState<'rules' | 'people'>('rules');
  const ok = canWholesaleSettings((p) => allowed(me, p));
  return (
    <SetupShell title="Wholesale settings" sub="Credit rules, stock rules, approvals, messages and your salespeople" ok={ok} denied="You do not have access to wholesale settings.">
      <Chips items={[{ id: 'rules', label: 'Rules and messages' }, { id: 'people', label: 'Salespeople' }]} value={tab} onChange={setTab} />
      {tab === 'rules' ? <RulesTab key="r" edit={ok} /> : <PeopleTab key="p" edit={ok} />}
    </SetupShell>
  );
}
