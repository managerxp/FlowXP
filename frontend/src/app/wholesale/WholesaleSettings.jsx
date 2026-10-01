/*
 * Wholesale settings: credit control, payment terms, stock rules (negative stock, reservation, FEFO, expiry alert windows,
 * slow-moving and dead-stock days), approvals, order numbering, customer notifications, and salespeople with their
 * commission. Message delivery uses the Messaging screen’s provider; nothing about it is configured here.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, useLoad } from '../../lib/wholesale.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Skeleton, Table, Td, Th, Thead, Tr, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, Tabs, Toggle, useAction } from './parts.jsx';

const NOTIFY = [
  ['order_confirmed', 'Order confirmed', 'Tell the customer when you confirm their order'],
  ['order_dispatched', 'Order dispatched', 'Tell the customer when their goods leave, with the invoice and vehicle'],
  ['invoice_issued', 'Invoice issued', 'Send the invoice link with its due date'],
  ['payment_received', 'Payment received', 'Thank the customer and give the receipt number'],
  ['payment_due', 'Payment due reminder', 'A reminder shortly before an invoice falls due (off unless you switch it on)'],
  ['payment_overdue', 'Overdue reminder', 'A weekly reminder while an invoice is overdue (off unless you switch it on)']
];

const General = () => {
  const toast = useToast();
  const { data: s, loading, error, reload } = useLoad('/wholesale/settings');
  const lists = useLoad('/wholesale/price-lists');
  const [f, setF] = useState(null);
  const [busy, run] = useAction();
  useEffect(() => { if (s) setF({ ...s, expiry_alert_days: (s.expiry_alert_days || []).join(', '), order_approval_over: s.order_approval_over ?? '', default_price_list_id: s.default_price_list_id ?? '', invoice_footer: s.invoice_footer ?? '' }); }, [s]);
  if (error) return <Alert>{error}</Alert>;
  if (loading || !f) return <Skeleton className="h-64" />;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    const days = String(f.expiry_alert_days).split(/[,\s]+/).filter(Boolean).map(Number);
    const body = { credit_policy: f.credit_policy, block_when_overdue: f.block_when_overdue, overdue_grace_days: Number(f.overdue_grace_days), default_payment_terms_days: Number(f.default_payment_terms_days), default_price_list_id: f.default_price_list_id === '' ? null : Number(f.default_price_list_id),
      negative_stock: f.negative_stock, reserve_on_confirm: f.reserve_on_confirm, fefo: f.fefo, expiry_alert_days: days, order_approval_over: f.order_approval_over === '' ? null : Number(f.order_approval_over), slow_moving_days: Number(f.slow_moving_days), dead_stock_days: Number(f.dead_stock_days),
      order_prefix: f.order_prefix, invoice_footer: f.invoice_footer || null, notifications: f.notifications };
    const r = await run(() => api('/wholesale/settings', { method: 'PUT', body }), 'Settings saved');
    if (r) reload();
  };
  return (
    <div className="space-y-6">
      <Panel title="Credit control" lead="What happens when a customer’s order would take them past their credit limit">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="s-policy" label="When over the limit" hint="A customer can have their own rule on their profile"><Select id="s-policy" value={f.credit_policy} onChange={set('credit_policy')}><option value="OFF">Allow it (no checks)</option><option value="WARN">Warn, but allow</option><option value="BLOCK">Block until a manager overrides</option></Select></Field>
          <NumberField id="s-grace" label="Grace period for overdue" suffix="days" step={1} hint="Invoices count as overdue this many days after their due date" value={f.overdue_grace_days} onChange={set('overdue_grace_days')} />
          <div className="sm:col-span-2"><Toggle id="s-overdue" checked={f.block_when_overdue} onChange={(v) => setF((x) => ({ ...x, block_when_overdue: v }))} label="Hold orders from customers with overdue invoices" hint="Even if they are inside their credit limit" /></div>
        </div>
      </Panel>
      <Panel title="Orders and pricing">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField id="s-terms" label="Default payment terms" suffix="days" step={1} value={f.default_payment_terms_days} onChange={set('default_payment_terms_days')} />
          <Field id="s-list" label="Default price list" hint="For customers with no list of their own"><Select id="s-list" value={f.default_price_list_id} onChange={set('default_price_list_id')}><option value="">None (use product price tiers)</option>{(lists.data || []).filter((l) => l.kind === 'STANDARD').map((l) => <option key={l.list_id} value={l.list_id}>{l.name}</option>)}</Select></Field>
          <NumberField id="s-approval" label="Orders over this need manager approval" prefix="₹" hint="Blank for no limit" value={f.order_approval_over} onChange={set('order_approval_over')} />
          <Field id="s-prefix" label="Order number prefix" hint="Letters and digits, up to 8"><Input id="s-prefix" value={f.order_prefix} onChange={(e) => setF((x) => ({ ...x, order_prefix: e.target.value.toUpperCase() }))} maxLength={8} /></Field>
          <div className="sm:col-span-2"><Field id="s-footer" label="Invoice footer note"><Input id="s-footer" value={f.invoice_footer} onChange={set('invoice_footer')} maxLength={300} /></Field></div>
        </div>
      </Panel>
      <Panel title="Stock rules">
        <div className="grid gap-4 sm:grid-cols-2">
          <Toggle id="s-reserve" checked={f.reserve_on_confirm} onChange={(v) => setF((x) => ({ ...x, reserve_on_confirm: v }))} label="Reserve stock when an order is confirmed" hint="Reserved stock cannot be sold to someone else" />
          <Toggle id="s-fefo" checked={f.fefo} onChange={(v) => setF((x) => ({ ...x, fefo: v }))} label="Pick the soonest expiry first (FEFO)" hint="Otherwise the oldest received batch goes first" />
          <Field id="s-expiry" label="Expiry alerts, days before" hint="Up to six numbers, e.g. 30, 60, 90"><Input id="s-expiry" value={f.expiry_alert_days} onChange={set('expiry_alert_days')} /></Field>
          <div className="grid grid-cols-2 gap-4"><NumberField id="s-slow" label="Slow-moving after" suffix="days" step={1} value={f.slow_moving_days} onChange={set('slow_moving_days')} /><NumberField id="s-dead" label="Dead stock after" suffix="days" step={1} value={f.dead_stock_days} onChange={set('dead_stock_days')} /></div>
        </div>
      </Panel>
      <Panel title="Customer messages" lead="Sent through the channel you set up under Messaging (WhatsApp or SMS). If messaging is off, nothing is sent.">
        <div className="space-y-3">{NOTIFY.map(([k, label, hint]) => <Toggle key={k} id={`n-${k}`} checked={['payment_due', 'payment_overdue'].includes(k) ? f.notifications?.[k] === true : f.notifications?.[k] !== false} onChange={(v) => setF((x) => ({ ...x, notifications: { ...x.notifications, [k]: v } }))} label={label} hint={hint} />)}</div>
        <p className="mt-4 text-caption text-ink-500">Provider keys and the channel live in <Link to="/app/messaging" className="font-semibold text-brand-600">Messaging</Link>. Customers who opted out of messages are never sent promotional ones.</p>
      </Panel>
      <div className="flex justify-end"><Button onClick={save} loading={busy}>Save settings</Button></div>
    </div>
  );
};

/* ── salespeople ──────────────────────────────────────────────────────────────────────────────── */

const SalespersonForm = ({ person, onClose, onSaved }) => {
  const [f, setF] = useState({ name: person?.name || '', phone: person?.phone || '', email: person?.email || '', territory: person?.territory || '', commission_pct: person?.commission_pct ?? '', commission_on: person?.commission_on || 'SALES', status: person?.status || 'ACTIVE', user_id: person?.user_id ?? '' });
  const staff = useLoad('/staff');
  const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    const body = { name: f.name, phone: f.phone || null, email: f.email || null, territory: f.territory || null, commission_pct: Number(f.commission_pct) || 0, commission_on: f.commission_on, status: f.status, user_id: f.user_id === '' ? null : Number(f.user_id) };
    const r = await run(() => api(person ? `/wholesale/salespeople/${person.salesperson_id}` : '/wholesale/salespeople', { method: person ? 'PUT' : 'POST', body }), 'Salesperson saved');
    if (r) onSaved();
  };
  return (
    <Modal title={person ? 'Edit salesperson' : 'Add a salesperson'} onClose={onClose}>
      <div className="space-y-4">
        <Field id="sp-name" label="Name"><Input id="sp-name" value={f.name} onChange={set('name')} autoFocus maxLength={120} /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field id="sp-phone" label="Phone"><Input id="sp-phone" type="tel" value={f.phone} onChange={set('phone')} /></Field><Field id="sp-email" label="Email"><Input id="sp-email" type="email" value={f.email} onChange={set('email')} /></Field></div>
        <Field id="sp-terr" label="Territory"><Input id="sp-terr" value={f.territory} onChange={set('territory')} maxLength={120} /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><NumberField id="sp-pct" label="Commission" suffix="%" value={f.commission_pct} onChange={set('commission_pct')} /><Field id="sp-on" label="Commission on"><Select id="sp-on" value={f.commission_on} onChange={set('commission_on')}><option value="SALES">Sales (invoiced)</option><option value="COLLECTIONS">Collections (money received)</option></Select></Field></div>
        <Field id="sp-user" label="Sign-in account" hint="Link a team member so a sales executive sees only their own customers"><Select id="sp-user" value={f.user_id} onChange={set('user_id')}><option value="">Not linked</option>{(staff.data || []).filter((s) => s.status === 'ACTIVE').map((s) => <option key={s.user_id} value={s.user_id}>{s.name} ({s.role.toLowerCase().replace(/_/g, ' ')})</option>)}</Select></Field>
        {person && <Field id="sp-status" label="Status"><Select id="sp-status" value={f.status} onChange={set('status')}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></Field>}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={f.name.trim().length < 2}>Save</Button></div>
      </div>
    </Modal>
  );
};

const Salespeople = () => {
  const [view, setView] = useState('ACTIVE');
  const { data, loading, error, reload } = useLoad(`/wholesale/salespeople?status=${view}`);
  const [editing, setEditing] = useState(null);
  const [perf, setPerf] = useState(null);
  const performance = useLoad(perf ? `/wholesale/salespeople/${perf.salesperson_id}/performance` : null);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1.5">{[['ACTIVE', 'Active'], ['INACTIVE', 'Inactive']].map(([v, l]) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`rounded-full border px-3 py-1 text-caption font-medium ${view === v ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink-700'}`}>{l}</button>)}</div><Button onClick={() => setEditing({})}><Plus aria-hidden="true" className="h-4 w-4" />Add salesperson</Button></div>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel="No salespeople" emptyBody="Add the people who sell for you to assign customers and track commission." />
      {data?.length > 0 && <Table><Thead><Th>Name</Th><Th>Territory</Th><Th className="text-right">Customers</Th><Th className="text-right">Commission</Th><Th>Sign-in</Th><Th><span className="sr-only">Actions</span></Th></Thead>
        <tbody>{data.map((p) => <Tr key={p.salesperson_id} onClick={() => setPerf(perf?.salesperson_id === p.salesperson_id ? null : p)}><Td className="font-medium">{p.name}<span className="block text-caption text-ink-500">{[p.phone, p.email].filter(Boolean).join(' · ')}</span></Td><Td className="text-ink-500">{p.territory || '—'}</Td><Td className="text-right tabular">{p.customers}</Td><Td className="text-right tabular">{p.commission_pct}% of {p.commission_on === 'COLLECTIONS' ? 'collections' : 'sales'}</Td><Td>{p.user_id ? <Badge tone="success">linked</Badge> : <span className="text-ink-400">—</span>}</Td>
          <Td className="text-right"><button type="button" aria-label={`Edit ${p.name}`} onClick={(e) => { e.stopPropagation(); setEditing(p); }} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-ink-900"><Pencil className="h-4 w-4" /></button></Td></Tr>)}</tbody></Table>}
      {perf && performance.data && (
        <div className="mt-4 rounded-(--radius-card) border border-line bg-surface p-5"><p className="mb-3 text-small font-semibold">{perf.name} · this month so far</p>
          <dl className="grid grid-cols-2 gap-4 text-small sm:grid-cols-5">{[['Invoices', performance.data.invoices], ['Sales', money(performance.data.sales)], ['Collected', money(performance.data.collections)], ['Customers', performance.data.customers], ['Commission earned', money(performance.data.commission)]].map(([k, v]) => <div key={k}><dt className="text-caption text-ink-500">{k}</dt><dd className="tabular text-title font-semibold">{v}</dd></div>)}</dl></div>
      )}
      {editing && <SalespersonForm person={editing.salesperson_id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
};

const WholesaleSettings = () => {
  const [tab, setTab] = useState('general');
  return (
    <div>
      <PageHeader title="Wholesale settings" lead="Credit rules, stock rules, approvals, messages and your sales team." />
      <Tabs tabs={[{ key: 'general', label: 'Rules & messages' }, { key: 'people', label: 'Salespeople' }]} value={tab} onChange={setTab} />
      {tab === 'general' ? <General /> : <Salespeople />}
    </div>
  );
};

export default WholesaleSettings;
