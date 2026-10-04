/*
 * The sales team: who they are, what each should sell (targets by salesperson, territory, brand, category, product or
 * retailer, per day, week, month, quarter or year), how far they are, and what they earn (commission rules and the
 * statement). Achievement and commission are worked out live from invoices net of returns, so they always match the books.
 */
import { Fragment, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Pencil, Plus, Target, Trash, Upload } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { PERIODS, SALES_ROLES, TARGET_SCOPES, TARGET_STATUS, dateText, money, parseCsv, pct, qty, saveCsv, todayIn, useLoad } from '../../lib/distributor.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Chips, NumberField, Panel, StatusPill, Tabs, Toggle, Toolbar, useAction } from '../wholesale/parts.jsx';
import { CustomerPicker, ProductPicker } from '../wholesale/parts.jsx';
import { SalespersonSelect, TerritorySelect, useTerritories } from './parts.jsx';

/* ── team ─────────────────────────────────────────────────────────────────── */

const MemberForm = ({ person, onClose, onSaved }) => {
  const staff = useLoad('/staff');
  const people = useLoad('/wholesale/salespeople?status=ACTIVE').data || [];
  const [f, setF] = useState(() => ({ name: person?.name || '', phone: person?.phone || '', email: person?.email || '', employee_id: person?.employee_id || '', sales_role: person?.sales_role || 'SALES_EXECUTIVE', territory_id: person?.territory_id ?? '', manager_id: person?.manager_id ?? '',
    commission_pct: person?.commission_pct ?? '', commission_on: person?.commission_on || 'SALES', user_id: person?.user_id ?? '', status: person?.status || 'ACTIVE' }));
  const [busy, run] = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const save = async () => {
    const body = { name: f.name, phone: f.phone || null, email: f.email || null, employee_id: f.employee_id || null, sales_role: f.sales_role, territory_id: f.territory_id === '' ? null : f.territory_id, manager_id: f.manager_id === '' ? null : Number(f.manager_id),
      commission_pct: Number(f.commission_pct) || 0, commission_on: f.commission_on, user_id: f.user_id === '' ? null : Number(f.user_id), status: f.status };
    const r = await run(() => api(person ? `/wholesale/salespeople/${person.salesperson_id}` : '/wholesale/salespeople', { method: person ? 'PUT' : 'POST', body }), 'Saved');
    if (r) onSaved();
  };
  return (
    <Modal title={person ? `Edit ${person.name}` : 'Add to the sales team'} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="sm-name" label="Name"><Input id="sm-name" value={f.name} onChange={set('name')} autoFocus maxLength={120} /></Field>
          <Field id="sm-emp" label="Employee ID"><Input id="sm-emp" value={f.employee_id} onChange={set('employee_id')} maxLength={40} /></Field>
          <Field id="sm-phone" label="Phone"><Input id="sm-phone" type="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field id="sm-email" label="Email"><Input id="sm-email" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field id="sm-role" label="Role"><Select id="sm-role" value={f.sales_role} onChange={set('sales_role')}>{Object.entries(SALES_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <TerritorySelect id="sm-terr" value={f.territory_id} onChange={set('territory_id')} label="Territory" />
          <Field id="sm-mgr" label="Reports to"><Select id="sm-mgr" value={f.manager_id} onChange={set('manager_id')}><option value="">Nobody</option>{people.filter((p) => p.salesperson_id !== person?.salesperson_id).map((p) => <option key={p.salesperson_id} value={p.salesperson_id}>{p.name}</option>)}</Select></Field>
          <Field id="sm-user" label="Sign-in account" hint="Link their login so they see only their own retailers, beats and van"><Select id="sm-user" value={f.user_id} onChange={set('user_id')}><option value="">None</option>{(staff.data || []).map((s) => <option key={s.user_id} value={s.user_id}>{s.name} ({String(s.role).toLowerCase().replace(/_/g, ' ')})</option>)}</Select></Field>
          <NumberField id="sm-pct" label="Default commission" suffix="%" hint="Used where no commission rule covers a sale" value={f.commission_pct} onChange={set('commission_pct')} />
          <Field id="sm-on" label="Default commission on"><Select id="sm-on" value={f.commission_on} onChange={set('commission_on')}><option value="SALES">Sales invoiced</option><option value="COLLECTIONS">Payments collected</option></Select></Field>
          {person && <Field id="sm-status" label="Status"><Select id="sm-status" value={f.status} onChange={set('status')}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></Field>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={f.name.trim().length < 2}>Save</Button></div>
      </div>
    </Modal>
  );
};

const Bar = ({ value }) => (value == null ? <span className="text-ink-400">—</span> : (
  <div className="flex items-center gap-2"><div className="h-2 w-24 overflow-hidden rounded-full bg-surface-2"><div className={`h-full rounded-full ${value >= 100 ? 'bg-success' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, value)}%` }} /></div><span className="tabular text-caption text-ink-700">{pct(value)}</span></div>
));

const Team = () => {
  const { can } = useAuth();
  const [view, setView] = useState('ACTIVE');
  const [editing, setEditing] = useState(null);
  const { data, loading, error, reload } = useLoad(`/distributor/team?status=${view}`);
  const canEdit = can('targets') || can('territories');
  return (
    <div>
      <Toolbar><Chips label="Status" value={view} onChange={setView} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />{canEdit && <Button className="ml-auto" onClick={() => setEditing({})}><Plus aria-hidden="true" className="h-4 w-4" />Add person</Button>}</Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel="No one on the team yet" emptyBody="Add your salespeople, field reps and collection executives." emptyAction={canEdit ? <Button onClick={() => setEditing({})}>Add a person</Button> : undefined} />
      {data?.length > 0 && <Table><Thead><Th>Name</Th><Th>Role</Th><Th>Territory</Th><Th className="text-right">Retailers</Th><Th className="text-right">Beats</Th><Th className="text-right">Sold this month</Th><Th>Against target</Th><Th><span className="sr-only">Edit</span></Th></Thead>
        <tbody>{data.map((p) => <Tr key={p.salesperson_id}><Td><span className="font-medium">{p.name}</span><span className="block text-caption text-ink-500">{[p.employee_id, p.phone].filter(Boolean).join(' · ')}</span></Td><Td>{SALES_ROLES[p.sales_role]}</Td><Td>{p.territory || '—'}</Td><Td className="text-right tabular">{p.customers}</Td><Td className="text-right tabular">{p.beats}</Td>
          <Td className="text-right tabular">{money(p.month_sales)}{p.month_target != null && <span className="block text-caption text-ink-500">of {money(p.month_target)}</span>}</Td><Td><Bar value={p.achievement_pct} /></Td>
          <Td className="text-right">{canEdit && <button type="button" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-ink-900"><Pencil aria-hidden="true" className="h-4 w-4" /></button>}</Td></Tr>)}</tbody></Table>}
      {editing && <MemberForm person={editing.salesperson_id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
};

/* ── targets ──────────────────────────────────────────────────────────────── */

const ScopePicker = ({ type, value, onChange }) => {
  const brands = useLoad(type === 'BRAND' ? '/distributor/brands' : null).data || [];
  const cats = useLoad(type === 'CATEGORY' ? '/wholesale/categories' : null).data || [];
  if (type === 'BUSINESS') return <p className="text-small text-ink-500">The target for the whole business.</p>;
  if (type === 'SALESPERSON') return <SalespersonSelect id="tg-scope" value={value?.id ?? ''} onChange={(v) => onChange(v === '' ? null : { id: v })} emptyLabel="Choose…" />;
  if (type === 'TERRITORY') return <TerritorySelect id="tg-scope" value={value?.id ?? ''} onChange={(v) => onChange(v === '' ? null : { id: v })} emptyLabel="Choose…" label="Territory" />;
  if (type === 'BRAND') return <Field id="tg-scope" label="Brand"><Select id="tg-scope" value={value?.id ?? ''} onChange={(e) => onChange(e.target.value ? { id: Number(e.target.value) } : null)}><option value="">Choose…</option>{brands.map((b) => <option key={b.brand_id} value={b.brand_id}>{b.name}</option>)}</Select></Field>;
  if (type === 'CATEGORY') return <Field id="tg-scope" label="Category"><Select id="tg-scope" value={value?.id ?? ''} onChange={(e) => onChange(e.target.value ? { id: Number(e.target.value) } : null)}><option value="">Choose…</option>{cats.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</Select></Field>;
  if (type === 'PRODUCT') return value ? <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-small"><span>{value.name}</span><button type="button" className="text-caption text-brand-600" onClick={() => onChange(null)}>Change</button></div> : <ProductPicker onPick={(p) => onChange({ id: p.product_id, name: p.name })} />;
  return <CustomerPicker value={value ? { name: value.name } : null} onChange={(c) => onChange(c ? { id: c.customer_id, name: c.name } : null)} id="tg-scope" />;
};

const TargetForm = ({ onClose, onSaved }) => {
  const [f, setF] = useState({ scope_type: 'SALESPERSON', period_type: 'MONTHLY', date: todayIn(), metric: 'VALUE', target: '', notes: '' });
  const [scope, setScope] = useState(null);
  const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    const r = await run(() => api('/distributor/targets', { method: 'POST', body: { scope_type: f.scope_type, scope_id: scope?.id ?? null, period_type: f.period_type, date: f.date, metric: f.metric, target: Number(f.target), notes: f.notes || null } }), 'Target saved');
    if (r) onSaved();
  };
  return (
    <Modal title="Set a target" onClose={onClose}>
      <div className="space-y-4">
        <Field id="tg-type" label="Target for"><Select id="tg-type" value={f.scope_type} onChange={(e) => { set('scope_type')(e); setScope(null); }}>{Object.entries(TARGET_SCOPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <ScopePicker type={f.scope_type} value={scope} onChange={setScope} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="tg-period" label="Period"><Select id="tg-period" value={f.period_type} onChange={set('period_type')}>{Object.entries(PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field id="tg-date" label="Any day in the period"><Input id="tg-date" type="date" value={f.date} onChange={set('date')} /></Field>
          <Field id="tg-metric" label="Measured in"><Select id="tg-metric" value={f.metric} onChange={set('metric')}><option value="VALUE">Sales value (before GST)</option><option value="QTY">Quantity (base units)</option></Select></Field>
          <NumberField id="tg-amount" label="Target" prefix={f.metric === 'VALUE' ? '₹' : undefined} value={f.target} onChange={set('target')} />
        </div>
        <p className="text-caption text-ink-500">Setting it again for the same period changes the target; it never adds a second one.</p>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!(Number(f.target) > 0) || (f.scope_type !== 'BUSINESS' && !scope)}>Save target</Button></div>
      </div>
    </Modal>
  );
};

const BulkTargets = ({ onClose, onDone }) => {
  const toast = useToast();
  const file = useRef(null);
  const people = useLoad('/wholesale/salespeople?status=ALL').data || [];
  const { territories } = useTerritories();
  const brands = useLoad('/distributor/brands').data || [];
  const cats = useLoad('/wholesale/categories').data || [];
  const [rows, setRows] = useState(null);
  const [errors, setErrors] = useState([]);
  const [busy, run] = useAction();
  const lookup = { SALESPERSON: (n) => people.find((p) => p.name.toLowerCase() === n)?.salesperson_id, TERRITORY: (n) => territories.find((t) => t.name.toLowerCase() === n || t.path.toLowerCase() === n)?.territory_id, BRAND: (n) => brands.find((b) => b.name.toLowerCase() === n)?.brand_id, CATEGORY: (n) => cats.find((c) => c.name.toLowerCase() === n)?.category_id };
  const read = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const parsed = parseCsv(await f.text()); const out = []; const bad = [];
    parsed.forEach((r0, i) => {
      const r = Object.fromEntries(Object.entries(r0).map(([k, v]) => [k.trim().toLowerCase().replace(/\s+/g, '_'), v]));
      const type = String(r.scope_type || '').toUpperCase();
      let id = r.scope_id ? Number(r.scope_id) : null;
      if (type !== 'BUSINESS' && id == null) { const fn = lookup[type]; id = fn ? fn(String(r.scope || r.name || '').trim().toLowerCase()) : undefined; if (id == null) { bad.push({ row: i + 2, message: `Could not find ${type.toLowerCase() || 'scope'} "${r.scope || r.name || ''}"` }); return; } }
      out.push({ scope_type: type, scope_id: type === 'BUSINESS' ? null : id, period_type: String(r.period_type || r.period || 'MONTHLY').toUpperCase(), period_start: r.period_start || r.date || undefined, target: Number(String(r.target).replace(/[₹,]/g, '')), metric: String(r.metric || 'VALUE').toUpperCase() });
    });
    setRows(out); setErrors(bad);
  };
  const upload = async () => {
    const r = await run(() => api('/distributor/targets/bulk', { method: 'POST', body: { targets: rows } }), null);
    if (r) { toast.success(`${r.created} added, ${r.changed} changed`); onDone(); }
  };
  return (
    <Modal title="Upload targets" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-small text-ink-500">A CSV with <code>scope_type</code> (SALESPERSON, TERRITORY, BRAND, CATEGORY, BUSINESS), <code>scope</code> (the name), <code>period_type</code> (MONTHLY…), <code>period_start</code> (any date in the period), <code>target</code> and optionally <code>metric</code> (VALUE or QTY). For a product or retailer give <code>scope_id</code>.</p>
        <Button variant="secondary" onClick={() => saveCsv('targets-template.csv', ['scope_type', 'scope', 'period_type', 'period_start', 'target', 'metric'].map((k) => ({ key: k, label: k })), [{ scope_type: 'SALESPERSON', scope: 'Ravi Kumar', period_type: 'MONTHLY', period_start: todayIn(), target: 500000, metric: 'VALUE' }])}><Download aria-hidden="true" className="h-4 w-4" />Template</Button>
        <input ref={file} type="file" accept=".csv,text/csv" onChange={read} className="block w-full text-small" aria-label="Choose a CSV file" />
        {errors.length > 0 && <Alert>{errors.slice(0, 5).map((e) => `Row ${e.row}: ${e.message}`).join('. ')}</Alert>}
        {rows && <p className="text-small">{rows.length} target{rows.length === 1 ? '' : 's'} ready{errors.length ? `, ${errors.length} to fix` : ''}.</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={upload} loading={busy} disabled={!rows?.length || errors.length > 0}>Upload</Button></div>
      </div>
    </Modal>
  );
};

const Targets = () => {
  const { can } = useAuth();
  const dialog = useDialog();
  const [on, setOn] = useState(todayIn());
  const [scope, setScope] = useState('');
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [stamp, setStamp] = useState(0);
  const [busy, run] = useAction();
  const query = useMemo(() => new URLSearchParams({ on, ...(scope ? { scope_type: scope } : {}), k: stamp }).toString(), [on, scope, stamp]);
  const { data, loading, error } = useLoad(`/distributor/targets?${query}`);
  const canEdit = can('targets');
  const fmt = (t, v) => (t.metric === 'QTY' ? qty(v) : money(v));
  const remove = async (t) => { if (await dialog.confirm({ title: 'Remove this target?', body: `${t.scope_name} · ${t.period_start} to ${t.period_end}`, confirmLabel: 'Remove', danger: true })) { const r = await run(() => api(`/distributor/targets/${t.target_id}`, { method: 'DELETE' }), 'Removed'); if (r) setStamp((n) => n + 1); } };
  return (
    <div>
      <Toolbar>
        <Field id="tg-on" label="On"><Input id="tg-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
        <Chips label="For" value={scope} onChange={setScope} options={[{ value: '', label: 'All' }, ...Object.entries(TARGET_SCOPES).map(([value, label]) => ({ value, label }))]} />
        {canEdit && <span className="ml-auto flex gap-2"><Button variant="secondary" onClick={() => setBulk(true)}><Upload aria-hidden="true" className="h-4 w-4" />Upload</Button><Button onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />Set target</Button></span>}
      </Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={Target} emptyLabel="No targets running on that date" emptyBody="Set a monthly target for each salesperson, territory or brand to track achievement." emptyAction={canEdit ? <Button onClick={() => setAdding(true)}>Set a target</Button> : undefined} />
      {data?.length > 0 && <Table><Thead><Th>For</Th><Th>Period</Th><Th className="text-right">Target</Th><Th className="text-right">Achieved</Th><Th>Progress</Th><Th className="text-right">Left</Th><Th className="text-right">Needed per day</Th><Th>Status</Th><Th><span className="sr-only">Remove</span></Th></Thead>
        <tbody>{data.map((t) => <Tr key={t.target_id}><Td><span className="font-medium">{t.scope_name}</span><span className="block text-caption text-ink-500">{TARGET_SCOPES[t.scope_type]}{t.metric === 'QTY' ? ' · quantity' : ''}</span></Td><Td className="text-ink-700">{dateText(t.period_start)} – {dateText(t.period_end)}</Td><Td className="text-right tabular">{fmt(t, t.target)}</Td><Td className="text-right tabular">{fmt(t, t.actual)}</Td>
          <Td><Bar value={t.achievement_pct} /></Td><Td className="text-right tabular">{fmt(t, t.remaining)}</Td><Td className="text-right tabular">{t.days_left > 0 ? fmt(t, t.required_per_day) : '—'}</Td><Td><StatusPill map={TARGET_STATUS} status={t.status} /></Td>
          <Td className="text-right">{canEdit && <button type="button" disabled={busy} aria-label="Remove target" onClick={() => remove(t)} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-danger"><Trash aria-hidden="true" className="h-4 w-4" /></button>}</Td></Tr>)}</tbody></Table>}
      {adding && <TargetForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setStamp((n) => n + 1); }} />}
      {bulk && <BulkTargets onClose={() => setBulk(false)} onDone={() => { setBulk(false); setStamp((n) => n + 1); }} />}
    </div>
  );
};

/* ── commission ───────────────────────────────────────────────────────────── */

const RuleForm = ({ rule, onClose, onSaved }) => {
  const [f, setF] = useState(() => ({ name: rule?.name || '', basis: rule?.basis || 'VALUE', rate_pct: rule?.rate_pct ?? '', per_unit: rule?.per_unit ?? '', scope_type: rule?.scope_type || 'ALL', salesperson_id: rule?.salesperson_id ?? '', min_achievement_pct: rule?.min_achievement_pct ?? '', starts_on: rule?.starts_on ? String(rule.starts_on).slice(0, 10) : '', ends_on: rule?.ends_on ? String(rule.ends_on).slice(0, 10) : '', priority: rule?.priority ?? 0, is_active: rule?.is_active ?? true }));
  const [scope, setScope] = useState(rule?.scope_id ? { id: rule.scope_id, name: rule.scope_name } : null);
  const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    const body = { name: f.name, basis: f.basis, scope_type: f.scope_type, scope_id: f.scope_type === 'ALL' ? null : scope?.id, salesperson_id: f.salesperson_id === '' ? null : f.salesperson_id,
      ...(f.basis === 'QTY' ? { per_unit: Number(f.per_unit) } : { rate_pct: Number(f.rate_pct) }), min_achievement_pct: f.min_achievement_pct === '' ? null : Number(f.min_achievement_pct), starts_on: f.starts_on || null, ends_on: f.ends_on || null, priority: Number(f.priority) || 0, is_active: f.is_active };
    const r = await run(() => api(rule ? `/distributor/commission/rules/${rule.rule_id}` : '/distributor/commission/rules', { method: rule ? 'PUT' : 'POST', body }), 'Rule saved');
    if (r) onSaved();
  };
  const scopeType = f.scope_type === 'ALL' ? null : f.scope_type;
  return (
    <Modal title={rule ? 'Edit commission rule' : 'New commission rule'} onClose={onClose}>
      <div className="space-y-4">
        <Field id="cr-name" label="Name"><Input id="cr-name" value={f.name} onChange={set('name')} autoFocus maxLength={100} placeholder="2% on everything" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="cr-basis" label="Paid on"><Select id="cr-basis" value={f.basis} onChange={set('basis')}><option value="VALUE">Sales value (before GST)</option><option value="MARGIN">Gross margin</option><option value="QTY">Quantity sold</option></Select></Field>
          {f.basis === 'QTY' ? <NumberField id="cr-unit" label="Amount per unit" prefix="₹" value={f.per_unit} onChange={set('per_unit')} /> : <NumberField id="cr-rate" label="Commission" suffix="%" value={f.rate_pct} onChange={set('rate_pct')} />}
          <Field id="cr-scope" label="Applies to"><Select id="cr-scope" value={f.scope_type} onChange={(e) => { set('scope_type')(e); setScope(null); }}><option value="ALL">Everything</option>{['BRAND', 'PRODUCT', 'CATEGORY', 'TERRITORY', 'CUSTOMER'].map((k) => <option key={k} value={k}>{TARGET_SCOPES[k]}</option>)}</Select></Field>
          <SalespersonSelect id="cr-rep" value={f.salesperson_id} onChange={(v) => setF((x) => ({ ...x, salesperson_id: v }))} label="For" emptyLabel="Every salesperson" />
        </div>
        {scopeType && <ScopePicker type={scopeType} value={scope} onChange={setScope} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField id="cr-min" label="Only once target is at least" suffix="%" hint="Blank: no condition. Uses their own targets for the period." value={f.min_achievement_pct} onChange={set('min_achievement_pct')} />
          <NumberField id="cr-prio" label="Priority" step={1} hint="Higher wins between equally specific rules" min={-100} value={f.priority} onChange={set('priority')} />
          <Field id="cr-from" label="From"><Input id="cr-from" type="date" value={f.starts_on} onChange={set('starts_on')} /></Field>
          <Field id="cr-to" label="To"><Input id="cr-to" type="date" value={f.ends_on} onChange={set('ends_on')} /></Field>
        </div>
        <Toggle id="cr-active" checked={f.is_active} onChange={(v) => setF((x) => ({ ...x, is_active: v }))} label="Rule is switched on" />
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={f.name.trim().length < 2 || (f.scope_type !== 'ALL' && !scope)}>Save rule</Button></div>
      </div>
    </Modal>
  );
};

const Commission = () => {
  const { can } = useAuth();
  const dialog = useDialog();
  const today = todayIn();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [editing, setEditing] = useState(null);
  const [stamp, setStamp] = useState(0);
  const [open, setOpen] = useState(null);
  const [busy, run] = useAction();
  const statement = useLoad(`/distributor/commission?from=${from}&to=${to}&k=${stamp}`);
  const rules = useLoad(`/distributor/commission/rules?k=${stamp}`);
  const canEdit = can('targets');
  const remove = async (r) => { if (await dialog.confirm({ title: `Delete “${r.name}”?`, confirmLabel: 'Delete', danger: true })) { const x = await run(() => api(`/distributor/commission/rules/${r.rule_id}`, { method: 'DELETE' }), 'Deleted'); if (x) setStamp((n) => n + 1); } };
  const s = statement.data;
  return (
    <div className="space-y-6">
      <Panel title="Commission earned" lead="Worked out from invoices net of returns, under the rules below"
             action={<div className="flex items-end gap-2"><Field id="cm-from" label="From"><Input id="cm-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field id="cm-to" label="To"><Input id="cm-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>}>
        <ListState loading={statement.loading && !s} error={statement.error} empty={s?.salespeople.length === 0} emptyLabel="No salespeople" />
        {s?.salespeople.length > 0 && <Table><Thead><Th>Salesperson</Th><Th className="text-right">Net sales</Th><Th className="text-right">Collected</Th><Th className="text-right">Margin</Th><Th className="text-right">Target met</Th><Th className="text-right">Commission</Th></Thead>
          <tbody>{s.salespeople.map((p) => <Fragment key={p.salesperson_id}><Tr onClick={() => setOpen(open === p.salesperson_id ? null : p.salesperson_id)}><Td className="font-medium">{p.name}</Td><Td className="text-right tabular">{money(p.sales)}</Td><Td className="text-right tabular">{money(p.collections)}</Td><Td className="text-right tabular">{money(p.margin)}</Td><Td className="text-right tabular">{p.achievement_pct == null ? '—' : pct(p.achievement_pct)}</Td><Td className="text-right tabular font-semibold">{money(p.commission)}</Td></Tr>
            {open === p.salesperson_id && <tr><td colSpan={6} className="bg-surface-2 px-6 py-3">{p.lines.length === 0 ? <span className="text-small text-ink-500">Nothing earned in this period.</span> : <ul className="space-y-1 text-small">{p.lines.map((l, i) => <li key={i} className="flex justify-between gap-4"><span>{l.rule} <span className="text-ink-500">on {l.basis === 'QTY' ? `${qty(l.base)} units` : money(l.base)}</span></span><span className="tabular">{money(l.amount)}</span></li>)}</ul>}</td></tr>}</Fragment>)}</tbody></Table>}
        {s && <p className="mt-3 text-right text-small font-semibold">Total commission {money(s.total)}</p>}
      </Panel>
      <Panel title="Commission rules" lead="Each sold line earns under the most specific rule that fits — product, then brand, category, retailer, territory, then everything; a rule for one salesperson beats a general one" action={canEdit && <Button variant="secondary" size="sm" onClick={() => setEditing({})}><Plus aria-hidden="true" className="h-4 w-4" />New rule</Button>}>
        <ListState loading={rules.loading && !rules.data} error={rules.error} empty={rules.data?.length === 0} emptyLabel="No rules yet" emptyBody="Without rules each salesperson earns their own default percentage." />
        {rules.data?.length > 0 && <Table><Thead><Th>Rule</Th><Th>Paid on</Th><Th>Applies to</Th><Th>For</Th><Th>Conditions</Th><Th><span className="sr-only">Actions</span></Th></Thead>
          <tbody>{rules.data.map((r) => <Tr key={r.rule_id}><Td className="font-medium">{r.name}{!r.is_active && <Badge tone="warning">Off</Badge>}</Td><Td>{r.basis === 'QTY' ? `${money(r.per_unit)} a unit` : `${r.rate_pct}% of ${r.basis === 'MARGIN' ? 'margin' : 'sales'}`}</Td><Td>{r.scope_type === 'ALL' ? 'Everything' : `${TARGET_SCOPES[r.scope_type]}: ${r.scope_name || r.scope_id}`}</Td>
            <Td>{r.salesperson_id ? (statement.data?.salespeople.find((p) => p.salesperson_id === r.salesperson_id)?.name || `#${r.salesperson_id}`) : 'Everyone'}</Td><Td className="text-caption text-ink-500">{[r.min_achievement_pct != null && `target ≥ ${r.min_achievement_pct}%`, r.starts_on && `from ${dateText(r.starts_on)}`, r.ends_on && `to ${dateText(r.ends_on)}`].filter(Boolean).join(' · ') || '—'}</Td>
            <Td className="text-right">{canEdit && <><button type="button" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-ink-900"><Pencil aria-hidden="true" className="h-4 w-4" /></button><button type="button" disabled={busy} aria-label={`Delete ${r.name}`} onClick={() => remove(r)} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-danger"><Trash aria-hidden="true" className="h-4 w-4" /></button></>}</Td></Tr>)}</tbody></Table>}
      </Panel>
      {editing && <RuleForm rule={editing.rule_id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setStamp((n) => n + 1); }} />}
    </div>
  );
};

const SalesTeam = () => {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'team';
  return (
    <div>
      <PageHeader title="Sales team & targets" lead="Your salespeople, what each should sell, how far they are, and what they earn." />
      <Tabs tabs={[{ key: 'team', label: 'Team' }, { key: 'targets', label: 'Targets' }, { key: 'commission', label: 'Commission' }]} value={tab} onChange={(k) => setParams(k === 'team' ? {} : { tab: k }, { replace: true })} />
      {tab === 'team' && <Team />}{tab === 'targets' && <Targets />}{tab === 'commission' && <Commission />}
    </div>
  );
};

export default SalesTeam;
