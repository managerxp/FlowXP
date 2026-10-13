/* The membership plan builder: what the gym sells, for how long, for how much, where and when it works, and what happens about payment and freezes. */
import { useState } from 'react';
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { AUDIENCES, DAYS, PAYMENT_POLICIES, durationText, planPrice, rs, useLoad, windowText } from '../../lib/gym.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Textarea, useToast } from '../../components/ui.jsx';
import { NumberField, Toggle, useAction } from '../salon/parts.jsx';

const BLANK = { name: '', description: '', audience: 'STANDARD', duration_days: '30', price: '', tax_rate: '18', max_members: '1', payment_policy: 'FULL_REQUIRED', pay_later_days: '3', grace_days: '', freeze_allowed: true, max_freeze_days: '30', branches: [], timed: false, days: [1, 2, 3, 4, 5, 6, 0], from: '06:00', to: '22:00' };
const DURATIONS = [['30', 'Monthly'], ['90', 'Quarterly'], ['180', 'Half-yearly'], ['365', 'Yearly'], ['custom', 'Another length']];

const PlanForm = ({ plan, branches, onClose, onSaved }) => {
  const [f, setF] = useState(() => plan ? {
    ...BLANK, ...plan, duration_days: String(plan.duration_days), price: String(plan.price), tax_rate: String(plan.tax_rate), max_members: String(plan.max_members), pay_later_days: String(plan.pay_later_days),
    grace_days: plan.grace_days == null ? '' : String(plan.grace_days), max_freeze_days: String(plan.max_freeze_days), branches: plan.allowed_branch_ids || [],
    timed: Boolean(plan.time_window), days: plan.time_window?.days || [1, 2, 3, 4, 5, 6, 0], from: plan.time_window?.from || '06:00', to: plan.time_window?.to || '22:00'
  } : BLANK);
  const [custom, setCustom] = useState(plan ? !DURATIONS.some(([d]) => d === String(plan.duration_days)) : false);
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const evt = (k) => (e) => set(k)(e.target.value);
  const toggleDay = (d) => setF((x) => ({ ...x, days: x.days.includes(d) ? x.days.filter((n) => n !== d) : [...x.days, d] }));

  const save = () => run(async () => {
    setError('');
    const body = {
      name: f.name, description: f.description || null, audience: f.audience, duration_days: Number(f.duration_days), price: Number(f.price), tax_rate: Number(f.tax_rate), max_members: Number(f.max_members),
      payment_policy: f.payment_policy, pay_later_days: f.payment_policy === 'PAY_LATER' ? Number(f.pay_later_days) : 0, grace_days: f.grace_days === '' ? null : Number(f.grace_days),
      freeze_allowed: f.freeze_allowed, max_freeze_days: f.freeze_allowed ? Number(f.max_freeze_days) : 0,
      allowed_branch_ids: f.branches.length && f.branches.length < branches.length ? f.branches : null,
      time_window: f.timed ? { days: f.days, from: f.from, to: f.to } : null
    };
    try { onSaved(await api(plan ? `/gym/plans/${plan.plan_id}` : '/gym/plans', { method: plan ? 'PUT' : 'POST', body })); } catch (e) { setError(e.message); }
  }, null);

  return (
    <Modal title={plan ? `Edit ${plan.name}` : 'New plan'} onClose={onClose} wide
           footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.name.trim() || f.price === '' || !(Number(f.duration_days) >= 1)}>{plan ? 'Save plan' : 'Add plan'}</Button></>}>
      {plan && <div className="mb-4"><Alert>Changing a plan does not change memberships already sold: each keeps the rules it was sold with.</Alert></div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="p-name" label="Name"><Input id="p-name" value={f.name} onChange={evt('name')} autoFocus placeholder="Monthly, Student quarterly, Off-peak annual" /></Field>
        <Field id="p-aud" label="Who it is for"><Select id="p-aud" value={f.audience} onChange={evt('audience')}>{AUDIENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field id="p-dur" label="Length">
          <Select id="p-dur" value={custom ? 'custom' : f.duration_days} onChange={(e) => { if (e.target.value === 'custom') setCustom(true); else { setCustom(false); set('duration_days')(e.target.value); } }}>
            {DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}{v !== 'custom' ? ` (${durationText(Number(v))})` : ''}</option>)}
          </Select>
        </Field>
        {custom ? <NumberField id="p-days" label="Length in days" value={f.duration_days} onChange={set('duration_days')} min={1} step={1} /> : <div />}
        <NumberField id="p-price" label="Price (₹, before GST)" value={f.price} onChange={set('price')} prefix="₹" />
        <NumberField id="p-tax" label="GST rate" value={f.tax_rate} onChange={set('tax_rate')} suffix="%" hint="Gym memberships are usually 18%." />
        <div className="sm:col-span-2"><Field id="p-desc" label="Description (optional)"><Textarea id="p-desc" rows={2} value={f.description || ''} onChange={evt('description')} /></Field></div>
        {(f.audience === 'FAMILY' || Number(f.max_members) > 1) && <NumberField id="p-people" label="People covered" value={f.max_members} onChange={set('max_members')} min={1} step={1} hint="The person who pays plus the family members who share it." />}
      </div>

      <fieldset className="mt-5 space-y-3 rounded-(--radius-card) border border-line p-4">
        <legend className="px-1 text-small font-medium text-ink-700">Payment and access</legend>
        <Field id="p-pay" label="Can they come in before they have paid?">
          <Select id="p-pay" value={f.payment_policy} onChange={evt('payment_policy')}>{PAYMENT_POLICIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        {f.payment_policy === 'PAY_LATER' && <NumberField id="p-later" label="Days they can come in before paying" value={f.pay_later_days} onChange={set('pay_later_days')} min={1} step={1} />}
        <NumberField id="p-grace" label="Grace days after it ends (optional)" value={f.grace_days} onChange={set('grace_days')} min={0} step={1} hint="Empty uses the gym's default. 0 means none for this plan." />
      </fieldset>

      <fieldset className="mt-5 space-y-3 rounded-(--radius-card) border border-line p-4">
        <legend className="px-1 text-small font-medium text-ink-700">Where and when it works</legend>
        {branches.length > 1 && (
          <div>
            <p className="text-small text-ink-700">Branches</p>
            <div className="mt-1 flex flex-wrap gap-3">
              {branches.map((b) => <label key={b.branch_id} className="flex items-center gap-2 text-small"><input type="checkbox" checked={!f.branches.length || f.branches.includes(b.branch_id)} onChange={(e) => {
                const all = branches.map((x) => x.branch_id); const cur = f.branches.length ? f.branches : all;
                set('branches')(e.target.checked ? [...new Set([...cur, b.branch_id])] : cur.filter((x) => x !== b.branch_id));
              }} className="accent-(--color-brand-500)" />{b.name}</label>)}
            </div>
          </div>
        )}
        <Toggle id="p-timed" checked={f.timed} onChange={set('timed')} label="Only at certain times (an off-peak plan)" />
        {f.timed && (
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem]">
            <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">{DAYS.map(([d, n]) => <button key={d} type="button" aria-pressed={f.days.includes(d)} onClick={() => toggleDay(d)} className={`rounded-full border px-3 py-1 text-caption font-medium ${f.days.includes(d) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink-700'}`}>{n}</button>)}</div>
            <Field id="p-from" label="From"><Input id="p-from" type="time" value={f.from} onChange={evt('from')} /></Field>
            <Field id="p-to" label="To"><Input id="p-to" type="time" value={f.to} onChange={evt('to')} /></Field>
          </div>
        )}
        <Toggle id="p-freeze" checked={f.freeze_allowed} onChange={set('freeze_allowed')} label="Members can freeze it" />
        {f.freeze_allowed && <NumberField id="p-maxfreeze" label="Most days they can freeze in all" value={f.max_freeze_days} onChange={set('max_freeze_days')} min={1} step={1} />}
      </fieldset>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
    </Modal>
  );
};

export default function GymPlans() {
  const { can } = useAuth();
  const toast = useToast();
  const plans = useLoad('/gym/plans?all=true');
  const settings = useLoad('/gym/settings');
  const [edit, setEdit] = useState(null);       // null | 'new' | plan
  const manager = can('gym_setup');
  const rows = plans.data || [];
  const archive = async (p, on) => { try { await api(`/gym/plans/${p.plan_id}/${on ? 'restore' : 'archive'}`, { method: 'POST' }); plans.reload(); toast.success(on ? 'Plan is back on sale' : 'Plan taken off sale'); } catch (e) { toast.error(e.message); } };

  return (
    <div>
      <PageHeader title="Plans" lead="What you sell. Each membership keeps the rules it was sold with, so changing a plan only affects the next sale."
        action={manager && <Button onClick={() => setEdit('new')}><Plus aria-hidden="true" className="h-4 w-4" />New plan</Button>} />
      <ListState loading={plans.loading && !rows.length} error={plans.error} empty={!plans.loading && !rows.length} emptyLabel="No plans yet." emptyBody="Add a monthly plan to start selling memberships." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((p) => (
          <article key={p.plan_id} className={`flex flex-col rounded-(--radius-card) border bg-surface p-5 ${p.is_active ? 'border-line' : 'border-line opacity-70'}`}>
            <div className="flex items-start justify-between gap-2"><h2 className="text-body font-semibold text-ink-900">{p.name}</h2>{!p.is_active && <Badge>Off sale</Badge>}</div>
            <p className="mt-1 text-h3 font-semibold tabular text-ink-900">{rs(p.price)}<span className="ml-1 text-small font-normal text-ink-500">+ {Number(p.tax_rate)}% GST</span></p>
            <p className="text-small text-ink-500">{durationText(p.duration_days)}{p.audience !== 'STANDARD' ? ` · ${AUDIENCES.find(([a]) => a === p.audience)?.[1]}` : ''}{p.max_members > 1 ? ` · covers ${p.max_members} people` : ''}</p>
            {p.description && <p className="mt-2 text-small text-ink-700">{p.description}</p>}
            <ul className="mt-3 space-y-1 text-small text-ink-700">
              <li>{PAYMENT_POLICIES.find(([v]) => v === p.payment_policy)?.[1]}{p.payment_policy === 'PAY_LATER' ? ` (${p.pay_later_days} days)` : ''}</li>
              <li>{windowText(p.time_window)}</li>
              <li>{p.allowed_branch_ids ? `Only at: ${(settings.data?.branches || []).filter((b) => p.allowed_branch_ids.includes(b.branch_id)).map((b) => b.name).join(', ')}` : 'Every branch'}</li>
              <li>{p.freeze_allowed ? `Can freeze up to ${p.max_freeze_days} days` : 'Cannot be frozen'}{p.grace_days != null ? ` · ${p.grace_days} grace days` : ''}</li>
            </ul>
            {manager && (
              <div className="mt-auto flex gap-2 pt-4">
                <Button size="sm" variant="secondary" onClick={() => setEdit(p)}><Pencil aria-hidden="true" className="h-4 w-4" />Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => archive(p, !p.is_active)}>{p.is_active ? <><Archive aria-hidden="true" className="h-4 w-4" />Take off sale</> : <><ArchiveRestore aria-hidden="true" className="h-4 w-4" />Put back on sale</>}</Button>
              </div>
            )}
          </article>
        ))}
      </div>
      {edit && <PlanForm plan={edit === 'new' ? null : edit} branches={settings.data?.branches || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); toast.success('Plan saved'); plans.reload(); }} />}
    </div>
  );
}
