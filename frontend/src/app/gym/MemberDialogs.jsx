/* The things done to a membership: sell, renew, change plan, freeze, extend, cancel, transfer, and its history. Each is a small form; the rules are the server's. */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import { METHODS, addDays, dayTime, durationText, longDate, qs, rs, useDebounced, useLoad } from '../../lib/gym.js';
import { Alert, Avatar, Button, Field, Input, ListState, Modal, Select, Textarea } from '../../components/ui.jsx';
import { NumberField, Toggle, useAction } from '../salon/parts.jsx';
import { useT, T } from '../../i18n/useT.js';

const today = () => new Date().toLocaleDateString('en-CA');   // only a default for the date boxes; the server decides which day it really is

/* One form for selling, renewing and changing plan: choose a plan, say how it is being paid for. */
export function SellDialog({ mode = 'sell', member, membership = null, canDiscount, canComplimentary, onClose, onDone }) {
  const tr = useT();
  const plans = useLoad('/gym/plans?kind=MEMBERSHIP');
  const [planId, setPlanId] = useState('');
  const [start, setStart] = useState('');
  const [discount, setDiscount] = useState('');
  const [free, setFree] = useState(false);
  const [pay, setPay] = useState('FULL');           // FULL | PART | LATER
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const key = useIdempotencyKey();
  const list = plans.data || [];
  const plan = list.find((p) => String(p.plan_id) === planId);
  useEffect(() => { if (!planId && list.length) setPlanId(String((membership && list.find((p) => p.plan_id === membership.plan_id) || list[0]).plan_id)); }, [list, membership, planId]);

  const net = plan ? Math.max(0, Number(plan.price) - (Number(discount) || 0)) : 0;
  const total = plan ? net * (1 + Number(plan.tax_rate) / 100) : 0;
  const title = { sell: `Sell a membership to ${member.name}`, renew: `Renew ${member.name}`, change: `Change ${member.name}'s plan` }[mode];

  const submit = () => run(async () => {
    setError('');
    const body = { plan_id: Number(planId), ...(start && mode !== 'change' ? { start_date: start } : {}), ...(discount ? { discount: Number(discount) } : {}), ...(free ? { complimentary: true } : {}) };
    if (!free) {
      if (pay === 'FULL') body.payment = { method, amount: 'FULL' };
      else if (pay === 'PART') body.payment = { method, amount: Number(amount) };
    }
    const path = mode === 'sell' ? `/gym/members/${member.member_id}/memberships` : mode === 'renew' ? `/gym/memberships/${membership.membership_id}/renew` : `/gym/memberships/${membership.membership_id}/change-plan`;
    try { const out = await api(path, { method: 'POST', body, idempotencyKey: key.get() }); key.settle(null); onDone(out); }
    catch (e) { key.settle(e); setError(e.message); }
  }, null);

  return (
    <Modal title={tr(title)} onClose={onClose} wide
           footer={<><Button variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button onClick={submit} loading={busy} disabled={!plan || (pay === 'PART' && !free && !(Number(amount) > 0))}>{mode === 'change' ? tr('Change plan') : tr('Sell')}{plan && !free ? ` · ${rs(total)}` : ''}</Button></>}>
      <ListState loading={plans.loading && !list.length} error={plans.error} empty={!plans.loading && !list.length} emptyLabel={tr('There are no plans to sell yet.')} emptyBody="Make one under Plans first." />
      {list.length > 0 && (
        <div className="space-y-4">
          <Field id="s-plan" label={tr('Plan')}>
            <Select id="s-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {list.map((p) => <option key={p.plan_id} value={p.plan_id}>{tr('{{p_name}} · {{durationText}} · {{rs}} + {{Number}}% GST', { p_name: p.name, durationText: durationText(p.duration_days), rs: rs(p.price), Number: Number(p.tax_rate) })}</option>)}
            </Select>
          </Field>
          {mode === 'change' && <Alert>{tr('The days left on the current membership are credited against the new plan. A cash refund is a credit note on the old bill.')}</Alert>}
          {mode !== 'change' && (
            <Field id="s-start" label={tr('Starts on')} hint={mode === 'renew' ? tr('Leave empty: it starts the day after the current one ends.') : tr('Leave empty to start today.')}><Input id="s-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} min={addDays(today(), -31)} /></Field>
          )}
          {plan && <p className="text-small text-ink-500">{plan.payment_policy === 'FULL_REQUIRED' ? tr('Must be paid in full before they can come in.') : plan.payment_policy === 'ANY_PAYMENT' ? tr('Any payment lets them in.') : `They can come in for ${plan.pay_later_days} days before paying in full.`}</p>}
          {canDiscount && <NumberField id="s-discount" label={tr('Discount (₹, before GST)')} value={discount} onChange={setDiscount} prefix="₹" />}
          {canComplimentary && <Toggle id="s-free" checked={free} onChange={setFree} label={tr('Give it free')} hint={tr('No bill is made. Use for a comp pass or a staff member.')} />}
          {!free && (
            <fieldset className="space-y-3 rounded-(--radius-card) border border-line p-4">
              <legend className="px-1 text-small font-medium text-ink-700">{tr('Payment')}</legend>
              {[['FULL', `Paid in full now (${rs(total)})`], ['PART', T('Part payment now')], ['LATER', T('Nothing yet: bill it and take payment later')]].map(([v, label]) => (
                <label key={v} className="flex items-center gap-2 text-small"><input type="radio" name="pay" checked={pay === v} onChange={() => setPay(v)} className="accent-(--color-brand-500)" />{tr(label)}</label>
              ))}
              {pay !== 'LATER' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="s-method" label={tr('Paid by')}><Select id="s-method" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
                  {pay === 'PART' && <NumberField id="s-amount" label={tr('Amount paid now (₹)')} value={amount} onChange={setAmount} prefix="₹" />}
                </div>
              )}
            </fieldset>
          )}
          {error && <Alert>{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}

export function FreezeDialog({ membership, onClose, onDone }) {
  const tr = useT();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(addDays(today(), 6));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const used = (membership.freezes || []).reduce((s, f) => s + Math.round((Date.parse(f.to) - Date.parse(f.from)) / 86400000) + 1, 0);
  const days = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
  return (
    <Modal title={tr('Freeze the membership')} onClose={onClose}
           footer={<><Button variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button loading={busy} disabled={!from || !to || days < 1} onClick={() => run(async () => { setError(''); try { onDone(await api(`/gym/memberships/${membership.membership_id}/freeze`, { method: 'POST', body: { from, to, reason } })); } catch (e) { setError(e.message); } }, null)}>Freeze for {days} day{days === 1 ? '' : 's'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="f-from" label={tr('First day frozen')}><Input id="f-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field id="f-to" label={tr('Last day frozen')}><Input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="mt-4"><Field id="f-reason" label={tr('Reason (optional)')}><Input id="f-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
      <p className="mt-3 text-small text-ink-500">The membership ends {days || 'N'} day{days === 1 ? '' : 's'} later than it does now. This plan allows {membership.max_freeze_days} frozen days in all{used ? `, ${used} already used` : ''}.</p>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Modal>
  );
}

export function ExtendDialog({ membership, onClose, onDone }) {
  const tr = useT();
  const [days, setDays] = useState('7');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  return (
    <Modal title={tr('Add days to the membership')} onClose={onClose}
           footer={<><Button variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button loading={busy} disabled={!(Number(days) >= 1)} onClick={() => run(async () => { setError(''); try { onDone(await api(`/gym/memberships/${membership.membership_id}/extend`, { method: 'POST', body: { days: Number(days), reason } })); } catch (e) { setError(e.message); } }, null)}>Add {days || 'N'} days</Button></>}>
      <p className="mb-3 text-small text-ink-500">{tr('It now ends on {{longDate}}.', { longDate: longDate(membership.end_date) })}</p>
      <NumberField id="e-days" label={tr('Days to add')} value={days} onChange={setDays} min={1} step={1} />
      <div className="mt-4"><Field id="e-reason" label={tr('Reason')} hint={tr('Kept on the membership\'s history.')}><Input id="e-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('The gym was shut for repairs')} /></Field></div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Modal>
  );
}

export function CancelDialog({ membership, onClose, onDone }) {
  const tr = useT();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  return (
    <Modal title={tr('Cancel the membership')} onClose={onClose}
           footer={<><Button variant="secondary" onClick={onClose}>{tr('Keep it')}</Button><Button variant="danger" loading={busy} onClick={() => run(async () => { setError(''); try { onDone(await api(`/gym/memberships/${membership.membership_id}/cancel`, { method: 'POST', body: { reason } })); } catch (e) { setError(e.message); } }, null)}>{tr('Cancel membership')}</Button></>}>
      <p className="text-small text-ink-700">{membership.plan_name} stops working now. This does not move any money. To refund, issue a credit note on its bill{membership.invoice_id ? tr('(Invoices)') : ''}: a full refund also ends the membership by itself.</p>
      <div className="mt-4"><Field id="c-reason" label={tr('Reason')}><Textarea id="c-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Modal>
  );
}

export function TransferDialog({ membership, member, onClose, onDone }) {
  const tr = useT();
  const [text, setText] = useState('');
  const q = useDebounced(text, 250);
  const found = useLoad(q.trim().length >= 2 ? `/gym/members${qs({ q: q.trim(), limit: 6 })}` : null, { paged: true });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  return (
    <Modal title={tr('Transfer {{plan_name}}', { plan_name: membership.plan_name })} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>{tr('Close')}</Button>}>
      <p className="mb-3 text-small text-ink-500">{tr('What is left of {{member_name}}\'s membership (to {{longDate}}) goes to the member you choose. It is not billed again.', { member_name: member.name, longDate: longDate(membership.end_date) })}</p>
      <Input aria-label={tr('Find the member to transfer to')} autoFocus placeholder={tr('Name, phone or member number')} value={text} onChange={(e) => setText(e.target.value)} />
      <ul className="mt-2 divide-y divide-line rounded-(--radius-card) border border-line">
        {(found.data || []).filter((m) => m.member_id !== member.member_id).map((m) => (
          <li key={m.member_id} className="flex items-center gap-3 px-3 py-2.5">
            <Avatar name={m.name} /><span className="min-w-0 flex-1 truncate text-small font-medium">{m.name}<span className="ml-2 text-caption font-normal text-ink-500">{m.member_code}</span></span>
            <Button size="sm" loading={busy} onClick={() => run(async () => { setError(''); try { onDone(await api(`/gym/memberships/${membership.membership_id}/transfer`, { method: 'POST', body: { to_member_id: m.member_id } })); } catch (e) { setError(e.message); } }, null)}>{tr('Transfer')}</Button>
          </li>
        ))}
        {q.trim().length < 2 && <li className="px-3 py-4 text-center text-small text-ink-500">{tr('Type at least two letters or digits.')}</li>}
      </ul>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Modal>
  );
}

const EVENT_TEXT = {
  SOLD: 'Sold', RENEWED: 'Renewed', FROZEN: 'Frozen', UNFROZEN: 'Freeze ended', EXTENDED: 'Days added', CANCELLED: 'Cancelled', REFUNDED: 'Refunded in full',
  TRANSFERRED: 'Transferred away', TRANSFERRED_IN: 'Received by transfer', PLAN_CHANGED: 'Plan changed'
};
const eventDetail = (e) => {
  const d = e.detail || {};
  switch (e.kind) {
    case 'FROZEN': return `${longDate(d.from)} to ${longDate(d.to)} (${d.days} days)${d.reason ? `: ${d.reason}` : ''}`;
    case 'EXTENDED': return `${d.days} days, now ends ${longDate(d.new_end)}${d.reason ? `: ${d.reason}` : ''}`;
    case 'UNFROZEN': return `${d.days_returned} days given back`;
    case 'CANCELLED': return d.reason || '';
    case 'SOLD': case 'RENEWED': return `${longDate(d.start)} to ${longDate(d.end)}${d.complimentary ? ', free' : ''}`;
    case 'PLAN_CHANGED': return `${d.unused_days} unused days credited (${rs((d.credit_paise || 0) / 100)})`;
    default: return '';
  }
};

export function HistoryDialog({ membership, onClose }) {
  const tr = useT();
  const h = useLoad(`/gym/memberships/${membership.membership_id}/history`);
  return (
    <Modal title={tr('{{plan_name}}: history', { plan_name: membership.plan_name })} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>{tr('Close')}</Button>}>
      <ListState loading={h.loading} error={h.error} empty={!h.loading && !(h.data || []).length} emptyLabel={tr('Nothing recorded.')} />
      <ol className="space-y-3">
        {(h.data || []).map((e) => (
          <li key={e.event_id} className="border-l-2 border-line pl-3">
            <p className="text-small font-medium text-ink-900">{EVENT_TEXT[e.kind] || e.kind}</p>
            {eventDetail(e) && <p className="text-small text-ink-700">{eventDetail(e)}</p>}
            <p className="text-caption text-ink-500">{dayTime(e.created_at)}{e.actor ? ` · ${e.actor}` : ''}</p>
          </li>
        ))}
      </ol>
    </Modal>
  );
}
