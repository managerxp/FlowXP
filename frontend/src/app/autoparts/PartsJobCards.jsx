/* Workshop job cards: a vehicle in for service, the spare parts fitted (held for the customer) and the labour, and one bill when the work is done. */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Wrench } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { FIT, VEHICLE_TYPES, n3, qs, rsPaise, useDebounced, useLoad } from '../../lib/autoparts.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr, useDialog } from '../../components/ui.jsx';
import { Chips, NumberField, Panel, Tabs, useAction } from '../salon/parts.jsx';

const STATUS = {
  OPEN: ['Waiting', 'neutral'], IN_PROGRESS: ['Being worked on', 'brand'], WAITING_PARTS: ['Waiting for parts', 'warning'], READY: ['Ready', 'success'], BILLED: ['Billed', 'neutral'], CANCELLED: ['Cancelled', 'danger']
};
const LIVE = ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'READY'];
const METHODS = [['CASH', 'Cash'], ['UPI', 'UPI'], ['CARD', 'Card'], ['BANK_TRANSFER', 'Bank transfer'], ['CREDIT', 'Pay later']];
const StatusBadge = ({ s }) => <Badge tone={STATUS[s]?.[1] || 'neutral'}>{STATUS[s]?.[0] || s}</Badge>;
const vehicleName = (j) => [j.make, j.model].filter(Boolean).join(' ');

/* ── new card ───────────────────────────────────────────────────────────── */
const CustomerFind = ({ value, onChange }) => {
  const [term, setTerm] = useState(''); const q = useDebounced(term, 250);
  const found = useLoad(q.trim().length >= 2 && !value ? `/customers${qs({ search: q, limit: 6 })}` : null);
  const [adding, setAdding] = useState(false); const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [busy, run] = useAction();
  if (value) return <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-small"><span><span className="font-medium">{value.name}</span> <span className="text-ink-500">{value.phone}</span></span><button type="button" className="text-caption text-brand-600" onClick={() => onChange(null)}>Change</button></div>;
  const rows = Array.isArray(found.data) ? found.data : [];
  return (
    <div className="space-y-2">
      <Input aria-label="Find the customer" placeholder="Customer name or phone" value={term} onChange={(e) => setTerm(e.target.value)} />
      {rows.map((c) => <button key={c.customer_id} type="button" onClick={() => onChange(c)} className="block w-full rounded-lg border border-line px-3 py-2 text-left text-small hover:bg-surface-2">{c.name} <span className="text-ink-500">{c.phone}</span></button>)}
      {!adding ? <button type="button" className="text-caption font-medium text-brand-700" onClick={() => { setAdding(true); setName(term); }}>New customer</button> : (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input aria-label="Customer name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} /><Input aria-label="Customer phone" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Button loading={busy} disabled={name.trim().length < 2} onClick={() => run(async () => { onChange(await api('/customers', { method: 'POST', body: { name: name.trim(), phone: phone.trim() || undefined } })); }, null)}>Add</Button>
        </div>
      )}
    </div>
  );
};

const NewJob = ({ onClose, onSaved }) => {
  const [customer, setCustomer] = useState(null);
  const [f, setF] = useState({ vehicle_reg: '', vehicle_type: 'CAR', model_id: '', odometer_km: '', complaint: '', mechanic_id: '', promised_on: '' });
  const veh = useLoad('/autoparts/vehicles'); const mech = useLoad('/autoparts/jobcards/mechanics');
  const [error, setError] = useState(''); const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const models = (veh.data || []).flatMap((mk) => mk.models.map((m) => ({ id: m.model_id, label: `${mk.name} ${m.name}` })));
  const save = () => run(async () => {
    setError('');
    try { onSaved(await api('/autoparts/jobcards', { method: 'POST', body: { customer_id: customer.customer_id, vehicle_reg: f.vehicle_reg, vehicle_type: f.vehicle_type, model_id: f.model_id ? Number(f.model_id) : undefined, odometer_km: f.odometer_km === '' ? undefined : Number(f.odometer_km), complaint: f.complaint || undefined, mechanic_id: f.mechanic_id ? Number(f.mechanic_id) : undefined, promised_on: f.promised_on || undefined } })); } catch (e) { setError(e.message); }
  }, null);
  return (
    <Modal wide title="New job card" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!customer || f.vehicle_reg.trim().length < 3}>Open the card</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="jc-cust" label="Customer"><CustomerFind value={customer} onChange={setCustomer} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="jc-reg" label="Registration number"><Input id="jc-reg" value={f.vehicle_reg} onChange={(e) => setF((x) => ({ ...x, vehicle_reg: e.target.value.toUpperCase() }))} placeholder="KA01AB1234" maxLength={20} /></Field>
          <Field id="jc-type" label="Vehicle"><Select id="jc-type" value={f.vehicle_type} onChange={set('vehicle_type')}>{VEHICLE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field id="jc-model" label="Make and model" hint="From your Vehicles list, so fitment can be checked"><Select id="jc-model" value={f.model_id} onChange={set('model_id')}><option value="">Not in the list</option>{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
          <NumberField id="jc-km" label="Odometer" suffix="km" step={1} value={f.odometer_km} onChange={(v) => setF((x) => ({ ...x, odometer_km: v }))} />
          <Field id="jc-mech" label="Mechanic"><Select id="jc-mech" value={f.mechanic_id} onChange={set('mechanic_id')}><option value="">Not assigned</option>{(mech.data || []).map((m) => <option key={m.employee_id} value={m.employee_id}>{m.name}</option>)}</Select></Field>
          <Field id="jc-due" label="Promised for"><Input id="jc-due" type="date" value={f.promised_on} onChange={set('promised_on')} /></Field>
        </div>
        <Field id="jc-complaint" label="What is wrong, or what to do"><Input id="jc-complaint" value={f.complaint} onChange={set('complaint')} placeholder="Brake noise, full service" maxLength={2000} /></Field>
      </div>
    </Modal>
  );
};

/* ── one card ───────────────────────────────────────────────────────────── */
const AddPart = ({ job, onDone }) => {
  const [term, setTerm] = useState(''); const q = useDebounced(term, 250);
  const found = useLoad(q.trim().length >= 2 ? `/autoparts/parts/lookup${qs({ q, limit: 6 })}` : null);
  const dialog = useDialog(); const [busy, run] = useAction();
  const add = (p, allow = false) => run(async () => {
    try { onDone(await api(`/autoparts/jobcards/${job.job_id}/lines`, { method: 'POST', body: { kind: 'PART', product_id: p.product_id, quantity: 1, allow_short: allow || undefined } })); setTerm(''); }
    catch (e) { if (/free to hold/.test(e.message) && await dialog.confirm({ title: 'Not enough in stock', body: `${e.message}. Add it to the card anyway, without holding it?`, confirmLabel: 'Add anyway' })) await add(p, true); else throw e; }
  }, null);
  return (
    <div className="space-y-2">
      <Input aria-label="Add a part" placeholder="Add a part: name, code or part number" value={term} onChange={(e) => setTerm(e.target.value)} />
      {Array.isArray(found.data) && found.data.map((p) => <button key={p.product_id} type="button" disabled={busy} onClick={() => add(p)} className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-small hover:bg-surface-2"><span>{p.name}<span className="block text-caption text-ink-500">{[p.sku, p.oem_part_no].filter(Boolean).join(' · ')}</span></span><span className="tabular text-ink-700">{rsPaise(p.selling_price_paise)} · {n3(p.stock)} in stock</span></button>)}
    </div>
  );
};

const JobDetail = ({ id, onClose, onChanged }) => {
  const navigate = useNavigate();
  const dialog = useDialog();
  const { can } = useAuth();
  const job = useLoad(`/autoparts/jobcards/${id}`);
  const mech = useLoad('/autoparts/jobcards/mechanics');
  const [labour, setLabour] = useState({ description: '', price: '' });
  const [pay, setPay] = useState({ method: 'CASH', amount: '' });
  const [error, setError] = useState(''); const [busy, run] = useAction();
  const j = job.data;
  if (!j) return <Modal wide title="Job card" onClose={onClose}><ListState loading={job.loading} error={job.error} /></Modal>;
  const live = LIVE.includes(j.status);
  const refresh = (next) => { job.reload(); onChanged(); return next; };
  const act = (fn) => run(async () => { setError(''); try { await fn(); refresh(); } catch (e) { setError(e.message); } }, null);
  const put = (patch) => act(() => api(`/autoparts/jobcards/${id}`, { method: 'PUT', body: patch }));
  const setStatus = (status) => act(() => api(`/autoparts/jobcards/${id}/status`, { method: 'POST', body: { status } }));
  const bill = () => run(async () => {
    setError('');
    const amount = pay.amount === '' ? 'FULL' : Number(pay.amount);
    try {
      const out = await api(`/autoparts/jobcards/${id}/bill`, { method: 'POST', body: { payment: pay.method === 'CREDIT' ? undefined : { amount, method: pay.method } } });
      onChanged(); navigate(`/app/billing/invoices/${out.invoice.invoice_id}`);
    } catch (e) { setError(e.message); }
  }, null);
  const est = j.estimate;
  return (
    <Modal wide title={`${j.job_no} · ${j.vehicle_reg}`} onClose={onClose}>
      <div className="space-y-5">
        <Alert>{error}</Alert>
        <div className="flex flex-wrap items-center gap-2 text-small"><StatusBadge s={j.status} /><span className="font-medium">{j.customer_name}</span><span className="text-ink-500">{j.customer_phone}</span><span className="text-ink-700">{vehicleName(j) || 'Vehicle not in the list'}{j.odometer_km != null ? ` · ${j.odometer_km} km` : ''}</span>{j.earlier_visits > 0 && <Badge tone="brand">{j.earlier_visits} earlier visit{j.earlier_visits === 1 ? '' : 's'}</Badge>}</div>
        {j.complaint && <p className="rounded-lg bg-surface-2 px-3 py-2 text-small text-ink-700">{j.complaint}</p>}
        {live && (
          <div className="flex flex-wrap gap-2">
            {j.status !== 'IN_PROGRESS' && <Button size="sm" variant="secondary" onClick={() => setStatus('IN_PROGRESS')}>Start work</Button>}
            {j.status !== 'WAITING_PARTS' && <Button size="sm" variant="secondary" onClick={() => setStatus('WAITING_PARTS')}>Waiting for parts</Button>}
            {j.status !== 'READY' && <Button size="sm" variant="secondary" onClick={() => setStatus('READY')}>Mark ready</Button>}
            <Button size="sm" variant="ghost" onClick={async () => { if (await dialog.confirm({ title: 'Cancel this job?', body: 'Every part held for it goes back on the shelf.', confirmLabel: 'Cancel the job', danger: true })) setStatus('CANCELLED'); }}>Cancel job</Button>
          </div>
        )}
        {live && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="jd-mech" label="Mechanic"><Select id="jd-mech" value={j.mechanic_id ?? ''} onChange={(e) => put({ mechanic_id: e.target.value ? Number(e.target.value) : null })}><option value="">Not assigned</option>{(mech.data || []).map((m) => <option key={m.employee_id} value={m.employee_id}>{m.name}</option>)}</Select></Field>
            <Field id="jd-prom" label="Promised for"><Input id="jd-prom" type="date" defaultValue={j.promised_on || ''} onBlur={(e) => e.target.value !== (j.promised_on || '') && put({ promised_on: e.target.value || null })} /></Field>
            <Field id="jd-next" label="Next service on"><Input id="jd-next" type="date" defaultValue={j.next_service_on || ''} onBlur={(e) => e.target.value !== (j.next_service_on || '') && put({ next_service_on: e.target.value || null })} /></Field>
          </div>
        )}

        <Panel title="Parts and labour">
          {j.lines.length === 0 ? <p className="text-small text-ink-500">Nothing on the card yet.</p> : (
            <Table>
              <Thead><Th>Item</Th><Th>Fits</Th><Th className="text-right">Qty</Th><Th className="text-right">Price</Th><Th className="text-right">Amount</Th><Th /></Thead>
              <tbody>{j.lines.map((l) => (
                <Tr key={l.line_id}>
                  <Td>{l.description}<span className="block text-caption text-ink-500">{l.kind === 'LABOUR' ? 'Labour' : [l.sku, l.held ? 'held for this customer' : 'not held'].filter(Boolean).join(' · ')}</span></Td>
                  <Td>{l.kind === 'PART' && l.fitment !== 'NO_VEHICLE' && <Badge tone={FIT[l.fitment]?.tone || 'neutral'}>{FIT[l.fitment]?.label || 'No fitment on record'}</Badge>}</Td>
                  <Td className="text-right tabular">{live ? <input aria-label={`Quantity of ${l.description}`} type="number" min="0" step="any" defaultValue={l.quantity} className="h-8 w-16 rounded border border-line bg-surface px-1 text-right" onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== l.quantity && act(() => api(`/autoparts/jobcards/lines/${l.line_id}`, { method: 'PUT', body: { quantity: Number(e.target.value) } }))} /> : n3(l.quantity)}</Td>
                  <Td className="text-right tabular">{rsPaise(l.unit_price_paise)}</Td><Td className="text-right tabular">{rsPaise(l.amount_paise)}</Td>
                  <Td className="text-right">{live && <Button size="sm" variant="ghost" onClick={() => act(() => api(`/autoparts/jobcards/lines/${l.line_id}`, { method: 'DELETE' }))}>Remove</Button>}</Td>
                </Tr>))}
              </tbody>
            </Table>
          )}
          {live && <div className="mt-4 space-y-4">
            <AddPart job={j} onDone={() => refresh()} />
            <form className="grid items-end gap-2 sm:grid-cols-[1fr_9rem_auto]" onSubmit={(e) => { e.preventDefault(); if (labour.description.trim() && labour.price !== '') act(async () => { await api(`/autoparts/jobcards/${id}/lines`, { method: 'POST', body: { kind: 'LABOUR', description: labour.description.trim(), unit_price: Number(labour.price) } }); setLabour({ description: '', price: '' }); }); }}>
              <Field id="jd-lab" label="Add labour"><Input id="jd-lab" value={labour.description} onChange={(e) => setLabour((x) => ({ ...x, description: e.target.value }))} placeholder="Fit brake pads, wheel alignment" /></Field>
              <NumberField id="jd-labp" label="Charge" prefix="₹" value={labour.price} onChange={(v) => setLabour((x) => ({ ...x, price: v }))} />
              <Button type="submit" variant="secondary" loading={busy} disabled={!labour.description.trim() || labour.price === ''}>Add</Button>
            </form>
          </div>}
          <dl className="mt-4 space-y-1 text-small">
            <div className="flex justify-between"><dt className="text-ink-500">Parts</dt><dd className="tabular">{rsPaise(est.parts_paise)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-500">Labour</dt><dd className="tabular">{rsPaise(est.labour_paise)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-500">GST</dt><dd className="tabular">{rsPaise(est.tax_paise)}</dd></div>
            <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>Estimate</dt><dd className="tabular">{rsPaise(est.total_paise)}</dd></div>
          </dl>
        </Panel>

        {live && can('billing') && j.lines.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
            <Field id="jd-method" label="Customer pays"><Select id="jd-method" value={pay.method} onChange={(e) => setPay((x) => ({ ...x, method: e.target.value }))}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            {pay.method !== 'CREDIT' && <div className="w-40"><NumberField id="jd-amt" label="Amount" prefix="₹" hint="Blank: the whole bill" value={pay.amount} onChange={(v) => setPay((x) => ({ ...x, amount: v }))} /></div>}
            <Button className="ml-auto" onClick={bill} loading={busy}>Make the bill</Button>
          </div>
        )}
        {j.status === 'BILLED' && j.invoice_id && <Button onClick={() => navigate(`/app/billing/invoices/${j.invoice_id}`)}>Open the bill</Button>}
      </div>
    </Modal>
  );
};

/* ── the list ───────────────────────────────────────────────────────────── */
const Due = () => {
  const due = useLoad('/autoparts/jobcards/due?days=30');
  return (
    <Panel title="Services due" lead="Vehicles whose last job said when the next service is due. Call them.">
      <ListState loading={due.loading && !due.data} error={due.error} empty={due.data && due.data.length === 0} emptyLabel="No service is due in the next 30 days." />
      {due.data?.length > 0 && <Table><Thead><Th>Vehicle</Th><Th>Customer</Th><Th>Due</Th></Thead><tbody>{due.data.map((d) => <Tr key={d.job_id}><Td>{d.vehicle_reg}<span className="block text-caption text-ink-500">{[d.make, d.model].filter(Boolean).join(' ')}</span></Td><Td>{d.customer_name}<span className="block text-caption text-ink-500">{d.customer_phone}</span></Td><Td>{d.next_service_on}{d.overdue && <Badge tone="danger"> overdue</Badge>}{d.next_service_km ? <span className="block text-caption text-ink-500">or {d.next_service_km} km</span> : null}</Td></Tr>)}</tbody></Table>}
    </Panel>
  );
};

export default function PartsJobCards() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'jobs';
  const [status, setStatus] = useState('LIVE'); const [term, setTerm] = useState(''); const q = useDebounced(term, 250);
  const [adding, setAdding] = useState(false); const [open, setOpen] = useState(null); const [stamp, setStamp] = useState(0);
  const list = useLoad(`/autoparts/jobcards${qs({ status, q, k: stamp })}`);
  useEffect(() => { setStamp((n) => n); }, []);
  const rows = Array.isArray(list.data) ? list.data : [];
  return (
    <div>
      <PageHeader title="Job cards" lead="Vehicles in for service: the parts fitted, the labour, and one bill."
        action={can('billing') && <Button onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" /> New job card</Button>} />
      <Tabs value={tab} onChange={(k) => setParams(k === 'jobs' ? {} : { tab: k })} tabs={[{ key: 'jobs', label: 'Jobs' }, { key: 'due', label: 'Services due' }]} />
      {tab === 'due' ? <Due /> : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="w-full max-w-xs"><Input aria-label="Search job cards" placeholder="Job number, registration, customer" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
            <Chips label="Show" value={status} onChange={setStatus} options={[{ value: 'LIVE', label: 'In the workshop' }, { value: 'READY', label: 'Ready' }, { value: 'BILLED', label: 'Billed' }, { value: 'ALL', label: 'All' }]} />
          </div>
          <ListState loading={list.loading && !list.data} error={list.error} empty={list.data && rows.length === 0} emptyIcon={Wrench} emptyLabel="No job cards here" emptyBody="Open a card when a vehicle comes in." />
          {rows.length > 0 && (
            <Table>
              <Thead><Th>Job</Th><Th>Vehicle</Th><Th>Customer</Th><Th>Mechanic</Th><Th>Status</Th><Th className="text-right">Estimate</Th></Thead>
              <tbody>{rows.map((j) => (
                <Tr key={j.job_id} onClick={() => setOpen(j.job_id)}>
                  <Td className="font-medium text-brand-700">{j.job_no}<span className="block text-caption text-ink-500">{String(j.opened_at).slice(0, 10)}</span></Td>
                  <Td>{j.vehicle_reg}<span className="block text-caption text-ink-500">{vehicleName(j)}</span></Td>
                  <Td>{j.customer_name}<span className="block text-caption text-ink-500">{j.customer_phone}</span></Td>
                  <Td>{j.mechanic_name || '—'}</Td><Td><StatusBadge s={j.status} /></Td><Td className="tabular text-right">{rsPaise(j.total_paise)}</Td>
                </Tr>))}
              </tbody>
            </Table>
          )}
        </>
      )}
      {adding && <NewJob onClose={() => setAdding(false)} onSaved={(j) => { setAdding(false); setStamp((n) => n + 1); setOpen(j.job_id); }} />}
      {open && <JobDetail id={open} onClose={() => setOpen(null)} onChanged={() => setStamp((n) => n + 1)} />}
    </div>
  );
}
