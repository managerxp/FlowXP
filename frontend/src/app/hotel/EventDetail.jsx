/*
 * One banquet event: its functions (hall, date, guests, menu, set-up), what the organiser is charged, what has been paid, and the next step for the event: hold the hall,
 * confirm it, take an advance, print the event order (BEO) or the proforma, then complete it into the final GST invoice.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarCheck, CreditCard, FileText, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { CHARGE_CATEGORIES, EVENT_STATUS, METHODS, addDays, chargeCategory, eventTypeName, hhmm, longDate, methodName, setupName, useLoad } from '../../lib/hotel.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, Select, Table, Td, Textarea, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Panel, useAction } from '../salon/parts.jsx';
import { FunctionFields, blankFunction, functionBody } from './EventForm.jsx';

const rs = (p) => formatCurrency((p || 0) / 100);

const FunctionDialog = ({ event, fn, halls, packages, onClose, onDone }) => {
  const edit = Boolean(fn);
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [f, setF] = useState(() => (edit ? { ...fn, per_plate: String(Number(fn.per_plate_paise) / 100), rent: String(Number(fn.rent_paise) / 100), package_id: fn.package_id || '', guaranteed_guests: fn.guaranteed_guests ?? '', start_time: hhmm(fn.start_time), end_time: hhmm(fn.end_time), event_date: String(fn.event_date).slice(0, 10) } : blankFunction(halls[0], addDays(String(event.functions.at(-1)?.event_date || '').slice(0, 10), 0))));
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api(edit ? `/hotel/banquet/functions/${fn.function_id}` : `/hotel/banquet/events/${event.event_id}/functions`, { method: edit ? 'PUT' : 'POST', body: functionBody(f) }).catch((c) => { setError(c.message); throw c; }), 'Saved');
    if (out) onDone();
  };
  return (
    <Modal title={edit ? `Edit ${fn.name}` : 'Add a function'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4"><Alert>{error}</Alert>
        <FunctionFields f={f} set={(patch) => setF((x) => ({ ...x, ...patch }))} halls={halls} packages={packages} idPrefix="fd" excludeFunctionId={edit ? fn.function_id : undefined} />
        <p className="text-caption text-ink-500">Saving works out the hall rent and the food again from these figures. Charges you added by hand are not touched.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
      </form>
    </Modal>
  );
};

const ChargeDialog = ({ event, onClose, onDone }) => {
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [f, setF] = useState({ category: 'DECOR', description: '', quantity: '1', price: '', tax_rate: '18', function_id: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const total = (Number(f.quantity) || 0) * (Number(f.price) || 0) * (1 + (Number(f.tax_rate) || 0) / 100);
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api(`/hotel/banquet/events/${event.event_id}/charges`, { method: 'POST', body: { category: f.category, description: f.description, quantity: Number(f.quantity), price: Number(f.price), tax_rate: Number(f.tax_rate) || 0, function_id: f.function_id ? Number(f.function_id) : undefined } }).catch((c) => { setError(c.message); throw c; }), 'Charge added');
    if (out) onDone();
  };
  return (
    <Modal title="Add a charge" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><Alert>{error}</Alert>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="bc-c" label="For"><Select id="bc-c" value={f.category} onChange={set('category')}>{CHARGE_CATEGORIES.filter(([c]) => c !== 'HALL' && c !== 'FOOD').concat(CHARGE_CATEGORIES.filter(([c]) => c === 'FOOD')).map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>
          {event.functions.length > 1 && <Field id="bc-f" label="Function"><Select id="bc-f" value={f.function_id} onChange={set('function_id')}><option value="">Whole event</option>{event.functions.map((x) => <option key={x.function_id} value={x.function_id}>{x.name}</option>)}</Select></Field>}
        </div>
        <Field id="bc-d" label="What is it"><Input id="bc-d" value={f.description} onChange={set('description')} required autoFocus placeholder="Stage and floral decor, DJ and sound, extra rooms…" /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="bc-q" label="Quantity"><Input id="bc-q" type="number" min="0.001" step="any" value={f.quantity} onChange={set('quantity')} required /></Field>
          <Field id="bc-p" label="Price each, before GST"><Input id="bc-p" type="number" min="0" step="any" value={f.price} onChange={set('price')} required /></Field>
          <Field id="bc-t" label="GST %"><Input id="bc-t" type="number" min="0" max="100" step="any" value={f.tax_rate} onChange={set('tax_rate')} /></Field>
        </div>
        <p className="text-small text-ink-500">Goes on the bill as <span className="tabular font-semibold text-ink-900">{formatCurrency(total)}</span> with GST.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Add</Button></div>
      </form>
    </Modal>
  );
};

const PayDialog = ({ event, kind, due, onClose, onDone }) => {
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [f, setF] = useState({ amount: kind === 'PAYMENT' && due > 0 ? String(due / 100) : '', method: 'BANK_TRANSFER', reference: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api(`/hotel/banquet/events/${event.event_id}/payments`, { method: 'POST', body: { kind, amount: Number(f.amount), method: f.method, reference: f.reference || undefined } }).catch((c) => { setError(c.message); throw c; }), 'Recorded');
    if (out) onDone();
  };
  return (
    <Modal title={kind === 'REFUND' ? 'Refund' : kind === 'ADVANCE' ? 'Take an advance' : 'Take a payment'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><Alert>{error}</Alert>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="bp-a" label="Amount"><Input id="bp-a" type="number" min="0.01" step="any" value={f.amount} onChange={set('amount')} required autoFocus /></Field>
          <Field id="bp-m" label="Paid by"><Select id="bp-m" value={f.method} onChange={set('method')}>{METHODS.filter(([c]) => c !== 'CREDIT').map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>
        </div>
        <Field id="bp-r" label="Reference"><Input id="bp-r" value={f.reference} onChange={set('reference')} placeholder="NEFT or UPI reference, cheque number…" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Record it</Button></div>
      </form>
    </Modal>
  );
};

const CompleteDialog = ({ event, balance, onClose, onDone }) => {
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const owes = balance > 0; const credit = balance < 0;
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const body = owes ? { settlement: { method, reference: reference || undefined } } : credit ? { refund_method: method } : {};
    const out = await run(() => api(`/hotel/banquet/events/${event.event_id}/complete`, { method: 'POST', body }).catch((c) => { setError(c.message); throw c; }), 'Invoice made');
    if (out) onDone(out);
  };
  return (
    <Modal title="Complete the event" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><Alert>{error}</Alert>
        <p className="text-small text-ink-700">{owes ? <>The organiser still owes <span className="tabular font-semibold text-ink-900">{rs(balance)}</span>. Take it to make the GST invoice.</> : credit ? <>The organiser has paid <span className="tabular font-semibold text-ink-900">{rs(-balance)}</span> more than the bill. Refund it to complete the event.</> : <>The bill is settled. This makes the GST invoice and closes the event.</>}</p>
        {(owes || credit) && <div className="grid gap-3 sm:grid-cols-2"><Field id="cp-m" label={owes ? 'Paid by' : 'Refunded by'}><Select id="cp-m" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.filter(([c]) => owes || c !== 'CREDIT').map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>{owes && <Field id="cp-r" label="Reference"><Input id="cp-r" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}</div>}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{owes ? `Take ${rs(balance)} and make the invoice` : 'Make the invoice'}</Button></div>
      </form>
    </Modal>
  );
};

const EditDialog = ({ event, onClose, onDone }) => {
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [f, setF] = useState({ title: event.title, notes: event.notes || '', instructions: event.instructions || '', company: event.company || '', hold_until: event.hold_until || '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api(`/hotel/banquet/events/${event.event_id}`, { method: 'PUT', body: { title: f.title, notes: f.notes, instructions: f.instructions, company: f.company, ...(event.status === 'TENTATIVE' ? { hold_until: f.hold_until } : {}) } }).catch((c) => { setError(c.message); throw c; }), 'Saved');
    if (out) onDone();
  };
  return (
    <Modal title="Edit the event" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><Alert>{error}</Alert>
        <Field id="ee-t" label="Title"><Input id="ee-t" value={f.title} onChange={set('title')} required /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field id="ee-c" label="Company"><Input id="ee-c" value={f.company} onChange={set('company')} /></Field>{event.status === 'TENTATIVE' && <Field id="ee-h" label="Hold until"><Input id="ee-h" type="date" value={f.hold_until} onChange={set('hold_until')} /></Field>}</div>
        <Field id="ee-i" label="Instructions for the team" hint="Printed on the event order: arrival of the family, special diets, timings, anything the kitchen and floor must know."><Textarea id="ee-i" rows={4} value={f.instructions} onChange={set('instructions')} /></Field>
        <Field id="ee-n" label="Notes"><Textarea id="ee-n" rows={2} value={f.notes} onChange={set('notes')} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
      </form>
    </Modal>
  );
};

export default function EventDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { can } = useAuth();
  const canEdit = can('banquet');
  const ev = useLoad(`/hotel/banquet/events/${id}`);
  const halls = useLoad('/hotel/banquet/halls');
  const packages = useLoad('/hotel/banquet/packages');
  const [open, setOpen] = useState(null);
  const e = ev.data;
  const refresh = () => { ev.reload(); setOpen(null); };
  if (!e) return <ListState loading={ev.loading} error={ev.error} />;
  const s = EVENT_STATUS[e.status];
  const closed = ['COMPLETED', 'CANCELLED'].includes(e.status);
  const guests = e.functions.reduce((n, f) => n + (f.guaranteed_guests ?? f.expected_guests), 0);
  const post = async (path, body, done) => { try { await api(`/hotel/banquet/events/${id}/${path}`, { method: 'POST', body }); toast.success(done); refresh(); } catch (err) { toast.error(err.message); } };
  const hold = async () => {
    const until = await dialog.prompt({ title: 'Hold the hall', body: 'The hall is kept for this event until the date you give, then it is free again by itself.', label: 'Hold until', type: 'date', defaultValue: addDays(new Date().toISOString().slice(0, 10), 7), confirmLabel: 'Hold the hall' });
    if (until) post('status', { status: 'TENTATIVE', hold_until: until }, 'Hall held');
  };
  const confirm = () => post('status', { status: 'CONFIRMED' }, 'Confirmed');
  const cancel = async () => { const reason = await dialog.prompt({ title: 'Cancel this event?', body: e.totals.paid_paise > 0 ? `${rs(e.totals.paid_paise)} has been paid. Refund it afterwards if it is owed.` : 'The hall goes back on sale.', label: 'Reason', confirmLabel: 'Cancel the event', danger: true }); if (reason) post('cancel', { reason }, 'Event cancelled'); };
  const removeFn = async (f) => { if (!(await dialog.confirm({ title: `Remove ${f.name}?`, body: 'Its hall rent and food lines go with it.', confirmLabel: 'Remove', danger: true }))) return; try { await api(`/hotel/banquet/functions/${f.function_id}`, { method: 'DELETE' }); toast.success('Removed'); refresh(); } catch (err) { toast.error(err.message); } };
  const voidCharge = async (c) => { const reason = await dialog.prompt({ title: `Void “${c.description}”?`, label: 'Reason', confirmLabel: 'Void', danger: true }); if (!reason) return; try { await api(`/hotel/banquet/charges/${c.charge_id}/void`, { method: 'POST', body: { reason } }); toast.success('Voided'); refresh(); } catch (err) { toast.error(err.message); } };

  return (
    <div className="space-y-6">
      <Link to="/app/hotel/banquet" className="inline-flex items-center gap-1.5 text-small font-medium text-ink-500 hover:text-ink-900"><ArrowLeft aria-hidden="true" className="h-4 w-4" />Banquet events</Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight text-ink-900">{e.title}</h1><Badge tone={s.tone}>{s.label}</Badge>{e.status === 'TENTATIVE' && e.hold_until && <Badge tone="warning">Held until {longDate(e.hold_until)}</Badge>}</div>
          <p className="mt-1 text-small text-ink-500">{e.event_no} · {eventTypeName(e.event_type)} · {e.guest.name}{e.guest.phone ? `, ${e.guest.phone}` : ''} · {guests} guests</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && e.status === 'ENQUIRY' && <Button variant="secondary" onClick={hold}>Hold the hall</Button>}
          {canEdit && ['ENQUIRY', 'TENTATIVE'].includes(e.status) && <Button onClick={confirm}><CalendarCheck aria-hidden="true" className="h-4 w-4" />Confirm</Button>}
          {canEdit && e.status === 'TENTATIVE' && <Button variant="secondary" onClick={hold}>Change the hold</Button>}
          {canEdit && !closed && <Button variant="secondary" onClick={() => setOpen('advance')}><CreditCard aria-hidden="true" className="h-4 w-4" />Take an advance</Button>}
          {canEdit && e.status === 'CONFIRMED' && <Button onClick={() => setOpen('complete')}><FileText aria-hidden="true" className="h-4 w-4" />Complete and invoice</Button>}
          {canEdit && e.status === 'CANCELLED' && e.totals.paid_paise > 0 && <Button variant="secondary" onClick={() => setOpen('refund')}>Refund {rs(e.totals.paid_paise)}</Button>}
          {canEdit && !closed && <Button variant="secondary" onClick={() => setOpen('edit')}><Pencil aria-hidden="true" className="h-4 w-4" />Edit</Button>}
          {canEdit && !closed && <Button variant="secondary" onClick={cancel}>Cancel</Button>}
          <Button to={`/app/hotel/banquet/events/${id}/print?doc=beo`} variant="secondary"><Printer aria-hidden="true" className="h-4 w-4" />Event order</Button>
          <Button to={`/app/hotel/banquet/events/${id}/print?doc=proforma`} variant="secondary"><Printer aria-hidden="true" className="h-4 w-4" />Proforma</Button>
          {e.invoice_id && <Button to={`/app/billing/invoices/${e.invoice_id}`} variant="secondary"><FileText aria-hidden="true" className="h-4 w-4" />GST invoice</Button>}
        </div>
      </header>
      {e.cancel_reason && <Alert>{`Cancelled: ${e.cancel_reason}`}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Functions" action={canEdit && !closed && <Button size="sm" variant="secondary" onClick={() => setOpen('function')} disabled={!halls.data}><Plus aria-hidden="true" className="h-4 w-4" />Add a function</Button>}>
            <ul className="divide-y divide-line">{e.functions.map((f) => (
              <li key={f.function_id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="text-small font-semibold text-ink-900">{f.name} <span className="font-normal text-ink-500">· {f.hall_name}</span></p>
                    <p className="text-caption text-ink-500">{longDate(String(f.event_date).slice(0, 10))}, {hhmm(f.start_time)} to {hhmm(f.end_time)} · {f.guaranteed_guests ?? f.expected_guests} guests{f.guaranteed_guests != null && f.guaranteed_guests !== f.expected_guests ? ` (${f.expected_guests} expected)` : ''} · {setupName(f.setup_style)}</p>
                    {f.package_name && <p className="mt-1 text-caption text-ink-700">{f.package_name}, {rs(f.per_plate_paise)} a plate</p>}
                    {f.menu && <p className="mt-1 whitespace-pre-line text-caption text-ink-500">{f.menu}</p>}</div>
                  {canEdit && !closed && <div className="flex gap-3 text-caption"><button type="button" onClick={() => setOpen({ edit: f })} className="font-medium text-brand-600 hover:underline">Edit</button><button type="button" aria-label={`Remove ${f.name}`} onClick={() => removeFn(f)} className="text-ink-500 hover:text-danger"><Trash2 aria-hidden="true" className="h-4 w-4" /></button></div>}
                </div>
              </li>))}</ul>
          </Panel>

          <Panel title="Charges" lead="Hall rent and food are worked out from each function. Add anything else by hand." action={canEdit && !closed && <Button size="sm" variant="secondary" onClick={() => setOpen('charge')}><Plus aria-hidden="true" className="h-4 w-4" />Add a charge</Button>}>
            <div className="overflow-x-auto"><Table><Thead><Th>What</Th><Th className="text-right">Qty</Th><Th className="text-right">Amount</Th><Th className="text-right">GST</Th><Th className="text-right">Total</Th><Th></Th></Thead>
              <tbody>{e.charges.map((c) => (
                <Tr key={c.charge_id} className={c.voided_at ? 'opacity-50' : ''}>
                  <Td className={c.voided_at ? 'line-through' : ''}>{c.description}{c.auto && <span className="ml-2 no-underline"><Badge>From the function</Badge></span>}{c.voided_at && <span className="ml-2"><Badge>Voided</Badge></span>}<span className="block text-caption text-ink-500">{chargeCategory(c.category)}</span></Td>
                  <Td className="tabular text-right">{Number(c.quantity)}</Td><Td className="tabular text-right">{rs(c.amount_paise)}</Td>
                  <Td className="tabular text-right text-ink-500">{rs(c.tax_paise)} <span className="text-caption">({Number(c.tax_rate)}%)</span></Td><Td className="tabular text-right font-medium">{rs(Number(c.amount_paise) + Number(c.tax_paise))}</Td>
                  <Td className="text-right">{canEdit && !closed && !c.auto && !c.voided_at && <button type="button" onClick={() => voidCharge(c)} className="text-caption font-medium text-danger hover:underline">Void</button>}</Td>
                </Tr>))}</tbody></Table></div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Balance">
            <dl className="space-y-2 text-small">
              <div className="flex justify-between"><dt className="text-ink-500">Before GST</dt><dd className="tabular text-ink-900">{rs(e.totals.net_paise)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">GST</dt><dd className="tabular text-ink-700">{rs(e.totals.tax_paise)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Total</dt><dd className="tabular font-medium text-ink-900">{rs(e.totals.charges_paise)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Paid</dt><dd className="tabular font-medium text-ink-900">{rs(e.totals.paid_paise)}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 text-body"><dt className="font-semibold text-ink-900">{e.totals.balance_paise < 0 ? 'Owed back' : 'To pay'}</dt><dd className={`tabular font-semibold ${e.totals.balance_paise > 0 ? 'text-danger' : 'text-success'}`}>{rs(Math.abs(e.totals.balance_paise))}</dd></div>
            </dl>
            {canEdit && e.status === 'CONFIRMED' && e.totals.balance_paise > 0 && <Button className="mt-4 w-full" variant="secondary" size="sm" onClick={() => setOpen('payment')}>Take a payment</Button>}
          </Panel>
          <Panel title="Payments">
            {e.payments.length === 0 ? <p className="text-small text-ink-500">Nothing paid yet.</p> : <ul className="space-y-1.5 text-small">{e.payments.map((p) => <li key={p.bp_id} className="flex justify-between gap-2"><span className="text-ink-700">{p.kind === 'ADVANCE' ? 'Advance' : p.kind === 'REFUND' ? 'Refund' : 'Payment'} · {methodName(p.method)}{p.reference ? ` · ${p.reference}` : ''} <span className="text-ink-400">{String(p.pay_date).slice(0, 10)}</span></span><span className={`tabular font-medium ${p.kind === 'REFUND' ? 'text-danger' : 'text-ink-900'}`}>{p.kind === 'REFUND' ? '−' : ''}{rs(p.amount_paise)}</span></li>)}</ul>}
          </Panel>
          <Panel title="Organiser">
            <dl className="space-y-1.5 text-small">{[['Name', e.guest.name], ['Phone', e.guest.phone], ['Email', e.guest.email], ['Company', e.company || e.guest.company], ['GSTIN', e.guest.gstin]].filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-ink-500">{k}</dt><dd className="text-right text-ink-900">{v}</dd></div>)}</dl>
            {e.instructions && <div className="mt-3 border-t border-line pt-3"><p className="text-caption font-medium text-ink-500">Instructions for the team</p><p className="mt-1 whitespace-pre-line text-small text-ink-700">{e.instructions}</p></div>}
            {e.notes && <p className="mt-3 text-caption text-ink-500">{e.notes}</p>}
          </Panel>
        </div>
      </div>

      {open === 'function' && halls.data && packages.data && <FunctionDialog event={e} halls={halls.data} packages={packages.data} onClose={() => setOpen(null)} onDone={refresh} />}
      {open?.edit && halls.data && packages.data && <FunctionDialog event={e} fn={open.edit} halls={halls.data} packages={packages.data} onClose={() => setOpen(null)} onDone={refresh} />}
      {open === 'charge' && <ChargeDialog event={e} onClose={() => setOpen(null)} onDone={refresh} />}
      {open === 'advance' && <PayDialog event={e} kind="ADVANCE" due={0} onClose={() => setOpen(null)} onDone={refresh} />}
      {open === 'payment' && <PayDialog event={e} kind="PAYMENT" due={e.totals.balance_paise} onClose={() => setOpen(null)} onDone={refresh} />}
      {open === 'refund' && <PayDialog event={e} kind="REFUND" due={0} onClose={() => setOpen(null)} onDone={refresh} />}
      {open === 'edit' && <EditDialog event={e} onClose={() => setOpen(null)} onDone={refresh} />}
      {open === 'complete' && <CompleteDialog event={e} balance={e.totals.balance_paise} onClose={() => setOpen(null)} onDone={(out) => { refresh(); if (out?.invoice_id) nav(`/app/billing/invoices/${out.invoice_id}`); }} />}
    </div>
  );
}
