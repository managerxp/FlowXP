/* The extra panels on a member's page: reward points, personal-training and class packs, and (for trainers and managers) the workout plan, goals and measurements. */
import { useState } from 'react';
import { Gift, Plus, Target } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import { METHODS, dayTime, longDate, rs, useLoad } from '../../lib/gym.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, Select, Textarea, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, useAction } from '../salon/parts.jsx';
import { useT } from '../../i18n/useT.js';

const REASONS = { VISIT: 'Visit', RENEWAL: 'Paid membership', REFERRAL: 'Referral', MILESTONE: 'Milestone', BIRTHDAY: 'Birthday', MANUAL: 'By hand', REDEMPTION: 'Spent', EXPIRY: 'Expired', REFUND: 'Taken back' };

export function MemberRewards({ memberId, canRedeem, canAdjust, canExclude, excluded, onChanged }) {
  const tr = useT();
  const toast = useToast();
  const p = useLoad(`/gym/members/${memberId}/points`);
  const catalogue = useLoad(canRedeem ? '/gym/rewards' : null);
  const [dialog, setDialog] = useState(null);       // 'redeem' | 'adjust'
  const [pick, setPick] = useState('');
  const [pts, setPts] = useState('');
  const [why, setWhy] = useState('');
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const key = useIdempotencyKey();
  const d = p.data;
  const close = () => { setDialog(null); setError(''); setPick(''); setPts(''); setWhy(''); };
  const done = (msg) => { close(); toast.success(msg); p.reload(); onChanged?.(); };
  const redeem = () => run(async () => { try { await api(`/gym/members/${memberId}/redeem`, { method: 'POST', body: { reward_id: Number(pick) }, idempotencyKey: key.get() }); key.settle(null); done('Redeemed'); } catch (e) { key.settle(e); setError(e.message); } }, null);
  const adjust = () => run(async () => { try { await api(`/gym/members/${memberId}/points/adjust`, { method: 'POST', body: { points: Number(pts), reason: why } }); done('Points changed'); } catch (e) { setError(e.message); } }, null);
  const toggleExcluded = async () => { try { await api(`/gym/members/${memberId}/rewards-exclusion`, { method: 'POST', body: { excluded: !excluded } }); toast.success(excluded ? tr('Earning points again') : tr('No longer earns points')); onChanged?.(); } catch (e) { toast.error(e.message); } };
  return (
    <Panel title={tr('Reward points')} lead={d ? `${d.balance} points${d.expiring_in_30_days ? ` · ${d.expiring_in_30_days} expire within 30 days` : ''}` : ' '}
           action={<div className="flex gap-2">{canRedeem && <Button size="sm" onClick={() => setDialog('redeem')} disabled={!d?.balance}><Gift aria-hidden="true" className="h-4 w-4" />{tr('Spend')}</Button>}{canAdjust && <Button size="sm" variant="secondary" onClick={() => setDialog('adjust')}>{tr('Adjust')}</Button>}</div>}>
      <ListState loading={p.loading && !d} error={p.error} />
      {d && (d.entries.length === 0 ? <p className="text-small text-ink-500">{tr('No points yet.')}</p> : (
        <ul className="divide-y divide-line text-small">
          {d.entries.slice(0, 8).map((e) => <li key={e.entry_id} className="flex items-center justify-between gap-3 py-1.5"><span className="min-w-0 truncate">{REASONS[e.reason] || e.reason}{e.note ? <span className="text-ink-500"> · {e.note}</span> : null}</span><span className="flex shrink-0 items-center gap-3"><span className="text-caption text-ink-400">{dayTime(e.created_at)}</span><span className={`tabular w-12 text-right font-medium ${e.points < 0 ? 'text-danger' : 'text-success'}`}>{e.points > 0 ? `+${e.points}` : e.points}</span></span></li>)}
        </ul>
      ))}
      {canExclude && <button type="button" onClick={toggleExcluded} className="mt-3 text-caption text-ink-500 hover:underline">{excluded ? tr('This member is left out of rewards. Let them earn again') : tr('Leave this member out of rewards')}</button>}
      {dialog === 'redeem' && (
        <Modal title={tr('Spend points')} onClose={close} footer={<><Button variant="secondary" onClick={close}>{tr('Cancel')}</Button><Button onClick={redeem} loading={busy} disabled={!pick}>{tr('Spend')}</Button></>}>
          <Field id="rd-pick" label={tr('Reward')}><Select id="rd-pick" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">{tr('Choose')}</option>{(catalogue.data || []).map((r) => <option key={r.reward_id} value={r.reward_id} disabled={d && r.points_cost > d.balance}>{r.name}: {r.points_cost} points{r.stock != null ? ` (${r.stock} left)` : ''}</option>)}</Select></Field>
          <p className="mt-2 text-small text-ink-500">They have {d?.balance} points. Free days are added to the running membership straight away; a gift is handed over at the desk.</p>
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        </Modal>
      )}
      {dialog === 'adjust' && (
        <Modal title={tr('Change points by hand')} onClose={close} footer={<><Button variant="secondary" onClick={close}>{tr('Cancel')}</Button><Button onClick={adjust} loading={busy} disabled={!Number(pts) || !why.trim()}>{tr('Save')}</Button></>}>
          <NumberField id="ad-pts" label={tr('Points to add (negative to take away)')} value={pts} onChange={setPts} min={-100000} step={1} />
          <div className="mt-3"><Field id="ad-why" label={tr('Why')} hint={tr('Kept on the ledger with your name.')}><Input id="ad-why" value={why} onChange={(e) => setWhy(e.target.value)} /></Field></div>
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        </Modal>
      )}
    </Panel>
  );
}

const SellPackDialog = ({ memberId, memberName, canDiscount, onClose, onDone }) => {
  const tr = useT();
  const plans = useLoad('/gym/plans');
  const packs = (plans.data || []).filter((p) => p.kind !== 'MEMBERSHIP');
  const [planId, setPlanId] = useState('');
  const [pay, setPay] = useState('FULL');
  const [method, setMethod] = useState('CASH');
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const key = useIdempotencyKey();
  const plan = packs.find((p) => String(p.plan_id) === (planId || String(packs[0]?.plan_id)));
  return (
    <Modal title={tr('Sell a pack to {{memberName}}', { memberName })} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button loading={busy} disabled={!plan} onClick={() => run(async () => { setError(''); try { onDone(await api(`/gym/members/${memberId}/packs`, { method: 'POST', body: { plan_id: plan.plan_id, ...(pay === 'FULL' ? { payment: { method, amount: 'FULL' } } : {}) }, idempotencyKey: key.get() })); key.settle(null); } catch (e) { key.settle(e); setError(e.message); } }, null)}>Sell{plan ? ` · ${rs(plan.price * (1 + Number(plan.tax_rate) / 100))}` : ''}</Button></>}>
      <ListState loading={plans.loading && !plans.data} error={plans.error} empty={!plans.loading && !packs.length} emptyLabel={tr('There are no packs to sell.')} emptyBody="Make a personal-training or class pack under Plans first." />
      {packs.length > 0 && (
        <div className="space-y-4">
          <Field id="pk-plan" label={tr('Pack')}><Select id="pk-plan" value={planId || packs[0].plan_id} onChange={(e) => setPlanId(e.target.value)}>{packs.map((p) => <option key={p.plan_id} value={p.plan_id}>{tr('{{p_name}}: {{sessions}} sessions · {{rs}} + {{Number}}% GST', { p_name: p.name, sessions: p.sessions, rs: rs(p.price), Number: Number(p.tax_rate) })}</option>)}</Select></Field>
          <fieldset className="space-y-2 rounded-(--radius-card) border border-line p-3">
            <legend className="px-1 text-small text-ink-700">{tr('Payment')}</legend>
            <label className="flex items-center gap-2 text-small"><input type="radio" checked={pay === 'FULL'} onChange={() => setPay('FULL')} className="accent-(--color-brand-500)" />{tr('Paid in full now')}</label>
            <label className="flex items-center gap-2 text-small"><input type="radio" checked={pay === 'LATER'} onChange={() => setPay('LATER')} className="accent-(--color-brand-500)" />{tr('Bill it, take payment later')}</label>
            {pay === 'FULL' && <Select aria-label={tr('Paid by')} value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}
          </fieldset>
          {canDiscount && <p className="text-caption text-ink-500">{tr('Discounts and free packs are set from the plan screen by a manager.')}</p>}
          {error && <Alert>{error}</Alert>}
        </div>
      )}
    </Modal>
  );
};

export function MemberPacks({ memberId, memberName, canSell, onChanged }) {
  const tr = useT();
  const toast = useToast();
  const packs = useLoad(`/gym/members/${memberId}/packs`);
  const [selling, setSelling] = useState(false);
  const rows = packs.data || [];
  return (
    <Panel title={tr('Packs')} lead={tr('Personal-training and class sessions bought in advance.')} action={canSell && <Button size="sm" variant="secondary" onClick={() => setSelling(true)}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Sell a pack')}</Button>}>
      <ListState loading={packs.loading && !packs.data} error={packs.error} />
      {packs.data && rows.length === 0 && <p className="text-small text-ink-500">{tr('No packs.')}</p>}
      <ul className="divide-y divide-line text-small">
        {rows.map((p) => <li key={p.pack_id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><span className="font-medium text-ink-900">{p.plan_name}</span><span className="ml-2 text-caption text-ink-500">{tr('to {{longDate}}', { longDate: longDate(p.expires_on) })}</span></span><span className="flex items-center gap-2">{p.status === 'CANCELLED' ? <Badge tone="danger">{tr('Cancelled')}</Badge> : <Badge tone={p.sessions_left ? 'success' : 'neutral'}>{tr('{{sessions_left}} of {{sessions_total}} left', { sessions_left: p.sessions_left, sessions_total: p.sessions_total })}</Badge>}{p.due > 0 && <Badge tone="danger">{tr('{{rs}} due', { rs: rs(p.due) })}</Badge>}</span></li>)}
      </ul>
      {selling && <SellPackDialog memberId={memberId} memberName={memberName} onClose={() => setSelling(false)} onDone={() => { setSelling(false); toast.success(tr('Pack sold')); packs.reload(); onChanged?.(); }} />}
    </Panel>
  );
}

const WorkoutForm = ({ memberId, onClose, onSaved }) => {
  const tr = useT();
  const templates = useLoad('/gym/workout-templates');
  const library = useLoad('/gym/exercises');
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [items, setItems] = useState([{ exercise_name: '', day_no: 1, sets: '3', reps: '10', weight_kg: '' }]);
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const setItem = (i, k, v) => setItems((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = () => run(async () => {
    setError('');
    try { onSaved(await api(`/gym/members/${memberId}/workouts`, { method: 'POST', body: { name, goal: goal || undefined, items: items.filter((i) => i.exercise_name.trim()).map((i) => ({ exercise_name: i.exercise_name, day_no: Number(i.day_no) || 1, sets: i.sets ? Number(i.sets) : undefined, reps: i.reps || undefined, weight_kg: i.weight_kg ? Number(i.weight_kg) : undefined })) } })); } catch (e) { setError(e.message); }
  }, null);
  const copy = (id) => run(async () => { try { onSaved(await api(`/gym/members/${memberId}/workouts`, { method: 'POST', body: { template_id: Number(id) } })); } catch (e) { setError(e.message); } }, null);
  return (
    <Modal title={tr('New workout plan')} onClose={onClose} wide footer={<><Button variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button onClick={save} loading={busy} disabled={!name.trim()}>{tr('Save the plan')}</Button></>}>
      {(templates.data || []).length > 0 && (
        <div className="mb-4 flex items-end gap-2"><Field id="wf-tpl" label={tr('Start from a template')}><Select id="wf-tpl" defaultValue="" onChange={(e) => e.target.value && copy(e.target.value)}><option value="">{tr('Choose a template')}</option>{templates.data.map((t) => <option key={t.workout_id} value={t.workout_id}>{t.name}</option>)}</Select></Field></div>
      )}
      <div className="grid gap-4 sm:grid-cols-2"><Field id="wf-name" label={tr('Plan name')}><Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} /></Field><Field id="wf-goal" label={tr('Goal (optional)')}><Input id="wf-goal" value={goal} onChange={(e) => setGoal(e.target.value)} /></Field></div>
      <datalist id="exercise-list">{(library.data || []).map((e) => <option key={e.exercise_id} value={e.name} />)}</datalist>
      <div className="mt-4 space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_4rem_4rem_5rem_5rem_auto] items-end gap-2">
            <Field id={`wi-n-${i}`} label={i === 0 ? tr('Exercise') : ''}><Input id={`wi-n-${i}`} list="exercise-list" value={it.exercise_name} onChange={(e) => setItem(i, 'exercise_name', e.target.value)} /></Field>
            <Field id={`wi-d-${i}`} label={i === 0 ? tr('Day') : ''}><Input id={`wi-d-${i}`} type="number" min={1} max={14} value={it.day_no} onChange={(e) => setItem(i, 'day_no', e.target.value)} /></Field>
            <Field id={`wi-s-${i}`} label={i === 0 ? tr('Sets') : ''}><Input id={`wi-s-${i}`} type="number" min={1} value={it.sets} onChange={(e) => setItem(i, 'sets', e.target.value)} /></Field>
            <Field id={`wi-r-${i}`} label={i === 0 ? tr('Reps') : ''}><Input id={`wi-r-${i}`} value={it.reps} onChange={(e) => setItem(i, 'reps', e.target.value)} /></Field>
            <Field id={`wi-w-${i}`} label={i === 0 ? tr('Kg') : ''}><Input id={`wi-w-${i}`} type="number" min={0} value={it.weight_kg} onChange={(e) => setItem(i, 'weight_kg', e.target.value)} /></Field>
            <Button variant="ghost" size="sm" aria-label={tr('Remove this exercise')} onClick={() => setItems((l) => l.filter((_, j) => j !== i))} disabled={items.length === 1}>×</Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setItems((l) => [...l, { exercise_name: '', day_no: l.at(-1)?.day_no || 1, sets: '3', reps: '10', weight_kg: '' }])}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add an exercise')}</Button>
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Modal>
  );
};

export function MemberTraining({ memberId, trainerId, canAssign, onChanged }) {
  const tr = useT();
  const toast = useToast();
  const workouts = useLoad(`/gym/members/${memberId}/workouts`);
  const progress = useLoad(`/gym/members/${memberId}/progress`);
  const trainers = useLoad(canAssign ? '/gym/trainers' : null);
  const [plan, setPlan] = useState(false);
  const [goal, setGoal] = useState('');
  const [m, setM] = useState({ measured_on: new Date().toLocaleDateString('en-CA'), weight_kg: '', waist_cm: '', body_fat_pct: '' });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const assign = async (v) => { try { await api(`/gym/members/${memberId}/trainer`, { method: 'POST', body: { trainer_id: v ? Number(v) : null } }); toast.success(tr('Saved')); onChanged?.(); } catch (e) { toast.error(e.message); } };
  const addGoal = () => run(async () => { try { await api(`/gym/members/${memberId}/goals`, { method: 'POST', body: { description: goal } }); setGoal(''); progress.reload(); } catch (e) { setError(e.message); } }, null);
  const addMeasure = () => run(async () => { setError(''); try { await api(`/gym/members/${memberId}/measurements`, { method: 'POST', body: Object.fromEntries(Object.entries(m).filter(([, v]) => v !== '').map(([k, v]) => [k, k === 'measured_on' ? v : Number(v)])) }); setAdding(false); progress.reload(); toast.success(tr('Recorded')); } catch (e) { setError(e.message); } }, null);
  return (
    <Panel title={tr('Training')} lead={tr('Private: only trainers and managers see this.')}>
      {canAssign && (
        <div className="mb-4 max-w-xs"><Field id="tr-assign" label={tr('Their trainer')}><Select id="tr-assign" defaultValue={trainerId ?? ''} onChange={(e) => assign(e.target.value)}><option value="">{tr('Not assigned')}</option>{(trainers.data || []).map((t) => <option key={t.trainer_id} value={t.trainer_id}>{t.name}</option>)}</Select></Field></div>
      )}
      <div className="flex items-center justify-between"><h3 className="text-small font-semibold text-ink-900">{tr('Workout plans')}</h3><Button size="sm" variant="secondary" onClick={() => setPlan(true)}><Plus aria-hidden="true" className="h-4 w-4" />{tr('New plan')}</Button></div>
      {(workouts.data || []).length === 0 ? <p className="mt-1 text-small text-ink-500">{tr('No plan yet.')}</p> : (workouts.data || []).map((w) => (
        <div key={w.workout_id} className="mt-2 rounded-lg bg-surface-2 p-3 text-small">
          <p className="font-medium text-ink-900">{w.name}{w.goal ? <span className="ml-2 font-normal text-ink-500">{w.goal}</span> : null}</p>
          <ul className="mt-1 space-y-0.5 text-ink-700">{w.items.map((i) => <li key={i.item_id}>Day {i.day_no}: {i.exercise_name}{i.sets ? `, ${i.sets} × ${i.reps || '?'}` : ''}{i.weight_kg ? `, ${i.weight_kg} kg` : ''}</li>)}</ul>
        </div>
      ))}
      <h3 className="mb-1 mt-5 text-small font-semibold text-ink-900"><Target aria-hidden="true" className="mr-1 inline h-4 w-4" />{tr('Goals')}</h3>
      <ul className="text-small">{(progress.data?.goals || []).map((g) => <li key={g.goal_id} className="flex justify-between py-0.5"><span>{tr(g.description)}</span><span className="text-ink-500">{g.status === 'ACTIVE' ? (g.moved != null ? `${g.moved > 0 ? '+' : ''}${g.moved} so far` : '') : g.status.toLowerCase()}</span></li>)}</ul>
      <div className="mt-2 flex gap-2"><Input aria-label={tr('Add a goal')} placeholder={tr('Add a goal')} value={goal} onChange={(e) => setGoal(e.target.value)} /><Button size="sm" variant="secondary" onClick={addGoal} disabled={!goal.trim() || busy}>{tr('Add')}</Button></div>
      <div className="mt-5 flex items-center justify-between"><h3 className="text-small font-semibold text-ink-900">{tr('Measurements')}</h3><Button size="sm" variant="secondary" onClick={() => setAdding((a) => !a)}>{adding ? tr('Close') : tr('Record')}</Button></div>
      {adding && (
        <div className="mt-2 grid gap-3 sm:grid-cols-4">
          <Field id="ms-date" label={tr('Date')}><Input id="ms-date" type="date" value={m.measured_on} onChange={(e) => setM({ ...m, measured_on: e.target.value })} /></Field>
          <Field id="ms-w" label={tr('Weight (kg)')}><Input id="ms-w" type="number" value={m.weight_kg} onChange={(e) => setM({ ...m, weight_kg: e.target.value })} /></Field>
          <Field id="ms-waist" label={tr('Waist (cm)')}><Input id="ms-waist" type="number" value={m.waist_cm} onChange={(e) => setM({ ...m, waist_cm: e.target.value })} /></Field>
          <Field id="ms-bf" label={tr('Body fat %')}><Input id="ms-bf" type="number" value={m.body_fat_pct} onChange={(e) => setM({ ...m, body_fat_pct: e.target.value })} /></Field>
          <div className="sm:col-span-4"><Button size="sm" onClick={addMeasure} loading={busy}>{tr('Save')}</Button></div>
        </div>
      )}
      <ul className="mt-2 divide-y divide-line text-small">{(progress.data?.measurements || []).slice(0, 6).map((x) => <li key={x.measurement_id} className="flex justify-between py-1"><span>{longDate(x.measured_on)}</span><span className="text-ink-700">{[x.weight_kg && `${x.weight_kg} kg`, x.waist_cm && `waist ${x.waist_cm}`, x.body_fat_pct && `${x.body_fat_pct}% fat`].filter(Boolean).join(' · ')}</span></li>)}</ul>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {plan && <WorkoutForm memberId={memberId} onClose={() => setPlan(false)} onSaved={() => { setPlan(false); workouts.reload(); toast.success(tr('Plan saved')); }} />}
    </Panel>
  );
}
