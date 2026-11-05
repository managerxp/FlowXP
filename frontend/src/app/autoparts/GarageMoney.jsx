/*
 * Money In and Money Out for a garage: two plain lists for the day (or week, or month) and one big button for each. Money In is a customer payment or any other money
 * received; Money Out is something the garage spent or a payment to a supplier. Entries are saved through the usual payments, other-income and expenses records,
 * so reports, the day card and FlowBook all see them. Categories are picked, not typed.
 */
import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { api } from '../../lib/api.js';
import { localISO } from '../../lib/dates.js';
import { qs, rsPaise, useLoad } from '../../lib/autoparts.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select } from '../../components/ui.jsx';
import { Chips, NumberField, useAction } from '../salon/parts.jsx';
import { useT, T } from '../../i18n/useT.js';

const METHODS = [['CASH', T('Cash')], ['UPI', 'UPI'], ['CARD', T('Card')], ['BANK_TRANSFER', T('Bank')]];
const OUT_KINDS = [T('Tea and food'), T('Spare parts bought'), T('Tools'), T('Rent'), T('Electricity'), T('Salary'), T('Staff advance'), T('Transport'), T('Other')];
const IN_KINDS = [T('Scrap sale'), T('Commission'), T('Other')];
const KIND_LABEL = { CUSTOMER: T('Customer payment'), OTHER_IN: T('Other money in'), EXPENSE: T('Spent'), SUPPLIER: T('Paid to supplier') };

const range = (key) => {
  const now = new Date(); const to = localISO(now);
  if (key === 'week') { const f = new Date(now); f.setDate(f.getDate() - 6); return { from: localISO(f), to }; }
  if (key === 'month') return { from: localISO(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  return { from: to, to };
};

const Add = ({ dir, onClose, onDone }) => {
  const tr = useT();
  const [busy, run] = useAction();
  const [customers, setCustomers] = useState([]);
  const [f, setF] = useState({ kind: dir === 'in' ? 'CUSTOMER' : 'EXPENSE', customer: '', category: dir === 'in' ? IN_KINDS[0] : OUT_KINDS[0], amount: '', method: 'CASH', note: '' });
  const [error, setError] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (dir === 'in') api('/customers').then((r) => setCustomers(r?.rows || r || [])).catch(() => {});
  }, [dir]);
  const ready = Number(f.amount) > 0 && (f.kind === 'CUSTOMER' ? f.customer : true);
  const save = () => run(async () => {
    setError('');
    try {
      const note = f.note.trim() || undefined;
      if (f.kind === 'CUSTOMER') await api('/payments', { method: 'POST', body: { customer_id: Number(f.customer), amount: Number(f.amount), method: f.method, notes: note } });
      else if (f.kind === 'OTHER_IN') await api('/other-income', { method: 'POST', body: { category: tr(f.category), amount: Number(f.amount), payment_method: f.method, description: note } });
      else await api('/expenses', { method: 'POST', body: { category: tr(f.category), amount: Number(f.amount), payment_method: f.method, description: note } });
      onDone();
    } catch (e) { setError(e.message); }
  }, null);
  return (
    <Modal title={dir === 'in' ? tr('Money In') : tr('Money Out')} onClose={onClose}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="mm-kind" label={dir === 'in' ? tr('What came in?') : tr('What went out?')}>
          <Select id="mm-kind" value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            {(dir === 'in' ? ['CUSTOMER', 'OTHER_IN'] : ['EXPENSE']).map((k) => <option key={k} value={k}>{tr(KIND_LABEL[k])}</option>)}
          </Select>
        </Field>
        {f.kind === 'CUSTOMER' && (
          <Field id="mm-cust" label={tr('Customer')}>
            <Select id="mm-cust" value={f.customer} onChange={(e) => set('customer', e.target.value)}>
              <option value="">{tr('Choose a customer')}</option>
              {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
            </Select>
          </Field>
        )}
        {(f.kind === 'EXPENSE' || f.kind === 'OTHER_IN') && (
          <Field id="mm-cat" label={tr('For what?')}>
            <Select id="mm-cat" value={f.category} onChange={(e) => set('category', e.target.value)}>
              {(f.kind === 'EXPENSE' ? OUT_KINDS : IN_KINDS).map((c) => <option key={c} value={c}>{tr(c)}</option>)}
            </Select>
          </Field>
        )}
        <NumberField id="mm-amt" label={tr('Amount')} prefix="₹" value={f.amount} onChange={(v) => set('amount', v)} />
        <Field id="mm-method" label={tr('How was it paid?')}>
          <Chips label={tr('How was it paid?')} value={f.method} onChange={(v) => set('method', v)} options={METHODS.map(([value, label]) => ({ value, label: tr(label) }))} />
        </Field>
        <Field id="mm-note" label={tr('Note (if you like)')}><Input id="mm-note" value={f.note} onChange={(e) => set('note', e.target.value)} maxLength={200} /></Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button><Button loading={busy} disabled={!ready} onClick={save}>{tr('Save')}</Button></div>
      </div>
    </Modal>
  );
};

const Column = ({ title, total, entries, tone }) => {
  const tr = useT();
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between"><h2 className="text-title font-semibold text-ink-900">{title}</h2><p className={`tabular text-h3 font-semibold ${tone}`}>{rsPaise(total)}</p></div>
      {entries.length === 0 ? <p className="mt-4 text-small text-ink-500">{tr('Nothing yet.')}</p> : (
        <ul className="mt-3 divide-y divide-line">
          {entries.map((e) => (
            <li key={`${e.kind}${e.ref_id}`} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-body text-ink-900">{e.who}</p>
                <p className="text-caption text-ink-500">{[tr(KIND_LABEL[e.kind]), e.day, e.method === 'BANK_TRANSFER' ? tr('Bank') : e.method, e.note].filter(Boolean).join(' · ')}</p>
              </div>
              <p className="tabular shrink-0 text-body font-semibold text-ink-900">{rsPaise(e.amount_paise)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default function GarageMoney() {
  const tr = useT();
  const [period, setPeriod] = useState('today');
  const [adding, setAdding] = useState(null);
  const r = range(period);
  const l = useLoad(`/autoparts/garage/money${qs(r)}`);
  const d = l.data;
  return (
    <div>
      <PageHeader title={tr('Money In and Out')} lead={tr('Every rupee that came in and went out.')} />
      <div className="mb-5 flex flex-wrap gap-3">
        <button type="button" onClick={() => setAdding('in')} className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-success px-4 py-3 text-body font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"><ArrowDownLeft aria-hidden="true" className="h-5 w-5" />{tr('Money In')}</button>
        <button type="button" onClick={() => setAdding('out')} className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-4 py-3 text-body font-semibold text-ink-900 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"><ArrowUpRight aria-hidden="true" className="h-5 w-5" />{tr('Money Out')}</button>
      </div>
      <div className="mb-4"><Chips label={tr('Show')} value={period} onChange={setPeriod} options={[{ value: 'today', label: tr('Today') }, { value: 'week', label: tr('Last 7 days') }, { value: 'month', label: tr('This month') }]} /></div>
      <ListState loading={l.loading && !d} error={l.error} />
      {d && (
        <>
          <p className="mb-4 flex flex-wrap items-center gap-2 text-small text-ink-700">
            <Badge tone={d.net_paise >= 0 ? 'success' : 'warning'}>{tr('Left over')}: {rsPaise(d.net_paise)}</Badge>
            <span>{tr('Cash left over')}: <span className="tabular font-medium">{rsPaise(d.cash_net_paise)}</span></span>
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <Column title={tr('Money In')} total={d.in.total_paise} entries={d.in.entries} tone="text-success" />
            <Column title={tr('Money Out')} total={d.out.total_paise} entries={d.out.entries} tone="text-ink-900" />
          </div>
        </>
      )}
      {adding && <Add dir={adding} onClose={() => setAdding(null)} onDone={() => { setAdding(null); l.reload(); }} />}
    </div>
  );
}
