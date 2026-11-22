/* On a member's Payments tab: their credit limit (a manager sets it) and the date they promised to pay (the desk notes it). */
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { longDate, rs } from '../../lib/gym.js';
import { Alert, Badge, Button, Field, Input, Modal, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, useAction } from '../salon/parts.jsx';
import { useT } from '../../i18n/useT.js';

export default function MemberDues({ memberId, dues, owed, canLimit, canPromise, onChanged }) {
  const tr = useT();
  const toast = useToast();
  const [dialog, setDialog] = useState(null);   // 'limit' | 'promise'
  const [limit, setLimit] = useState('');
  const [on, setOn] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const d = dues || {};
  const over = d.credit_limit_paise != null && owed * 100 > d.credit_limit_paise;
  const open = (which) => { setLimit(d.credit_limit_paise == null ? '' : String(d.credit_limit)); setOn(d.promise_on || ''); setAmount(d.promise_paise ? String(d.promise) : ''); setNote(d.promise_note || ''); setError(''); setDialog(which); };
  const save = (path, body, done) => run(async () => {
    try { await api(`/gym/members/${memberId}/${path}`, { method: 'PUT', body }); setDialog(null); toast.success(done); onChanged?.(); } catch (e) { setError(e.message); }
  }, null);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Panel title={tr('Dues control')} lead={tr('Over their credit limit the door stops them, unless they have promised a date.')}
      action={<div className="flex gap-2">{canLimit && <Button size="sm" variant="secondary" onClick={() => open('limit')}>{tr('Credit limit')}</Button>}{canPromise && <Button size="sm" variant="secondary" onClick={() => open('promise')}>{tr('Payment promise')}</Button>}</div>}>
      <dl className="grid gap-2 text-small sm:grid-cols-3">
        <div><dt className="text-ink-500">{tr('Credit limit')}</dt><dd className="font-medium">{d.credit_limit_paise == null ? tr('No limit') : rs(d.credit_limit)} {over && <Badge tone="warning">{tr('Over the limit')}</Badge>}</dd></div>
        <div><dt className="text-ink-500">{tr('Owes now')}</dt><dd className="font-medium">{rs(owed)}</dd></div>
        <div><dt className="text-ink-500">{tr('Promised to pay')}</dt><dd className="font-medium">{d.promise_on ? `${longDate(d.promise_on)}${d.promise_paise ? ` · ${rs(d.promise)}` : ''}` : '-'} {d.promise_on && d.promise_on < today && owed > 0 && <Badge tone="danger">{tr('Missed')}</Badge>}</dd>{d.promise_note && <dd className="text-ink-500">{d.promise_note}</dd>}</div>
      </dl>
      {dialog === 'limit' && (
        <Modal title={tr('Credit limit')} onClose={() => setDialog(null)} footer={<><Button variant="secondary" onClick={() => setDialog(null)}>{tr('Cancel')}</Button><Button loading={busy} onClick={() => save('credit-limit', { credit_limit: limit === '' ? null : Number(limit) }, tr('Limit saved'))}>{tr('Save')}</Button></>}>
          <NumberField id="cl-amt" label={tr('Most they may owe (Rs)')} hint={tr('Leave empty for no limit. 0 means nothing may be owed.')} value={limit} onChange={setLimit} min={0} step={1} />
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        </Modal>
      )}
      {dialog === 'promise' && (
        <Modal title={tr('Payment promise')} onClose={() => setDialog(null)} footer={<><Button variant="secondary" onClick={() => setDialog(null)}>{tr('Cancel')}</Button><Button loading={busy} onClick={() => save('promise', { promise_on: on || null, amount: amount === '' ? null : Number(amount), note }, tr('Promise saved'))}>{tr('Save')}</Button></>}>
          <Field id="pp-on" label={tr('They will pay by')} hint={tr('Leave empty to clear the promise.')}><Input id="pp-on" type="date" min={today} value={on} onChange={(e) => setOn(e.target.value)} /></Field>
          <div className="mt-3"><NumberField id="pp-amt" label={tr('How much (Rs), if said')} value={amount} onChange={setAmount} min={1} step={1} /></div>
          <div className="mt-3"><Field id="pp-note" label={tr('Note')}><Input id="pp-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        </Modal>
      )}
    </Panel>
  );
}
