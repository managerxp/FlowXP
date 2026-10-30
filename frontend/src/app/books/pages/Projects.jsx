/* Projects: hours logged against a customer, invoiced from the log, with the bills and expenses tagged to the project and its profit. */
import { useState } from 'react';
import { Link, useParams } from '../router.jsx';
import { useLoad } from '../api.js';
import { inr, showDate, today } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Badge, Btn, Card, Confirm, Empty, Err, Field, Money, Note, Page, Table, useAction } from '../ui.jsx';

const hours = (m) => `${Math.floor(Number(m) / 60)}:${String(Number(m) % 60).padStart(2, '0')}`;
const PATH = { INVOICE: 'sales', BILL: 'purchases', CREDIT_NOTE: 'credit-notes', DEBIT_NOTE: 'debit-notes', QUOTE: 'quotes', SALES_ORDER: 'sales-orders', PURCHASE_ORDER: 'purchase-orders' };
const KIND = { INVOICE: 'Invoice', BILL: 'Bill', CREDIT_NOTE: 'Credit note', DEBIT_NOTE: 'Debit note', QUOTE: 'Quote', SALES_ORDER: 'Sales order', PURCHASE_ORDER: 'Purchase order' };

const NewProject = ({ onDone, onClose }) => {
  const { o, org } = useSession();
  const a = useAction();
  const customers = useLoad(() => o('/parties?kind=CUSTOMER&limit=500'), [org.id]);
  const [f, setF] = useState({ name: '', code: '', customerId: '', hourlyRate: '', budget: '', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      await o('/projects', { method: 'POST', body: { name: f.name, ...Object.fromEntries(Object.entries(f).filter(([k, v]) => k !== 'name' && v)) } });
      onDone(); onClose();
    }, 'Project added.');
  };
  return (
    <Card title="New project"><Err>{a.error}</Err>
      <form className="form" onSubmit={save}>
        <Field label="Name"><input value={f.name} onChange={set('name')} required maxLength={160} /></Field>
        <Field label="Code (optional)"><input value={f.code} onChange={set('code')} maxLength={30} /></Field>
        <Field label="Customer" hint="Needed to invoice the hours"><select value={f.customerId} onChange={set('customerId')}><option value="">None</option>{(customers.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Hourly rate (₹)"><input inputMode="decimal" value={f.hourlyRate} onChange={set('hourlyRate')} /></Field>
        <Field label="Budget (₹)" hint="Costs (bills and expenses) are compared with this"><input inputMode="decimal" value={f.budget} onChange={set('budget')} /></Field>
        <Field label="Notes" wide><input value={f.notes} onChange={set('notes')} maxLength={1000} /></Field>
        <div className="wide actions"><Btn kind="primary" busy={a.busy}>Save</Btn><Btn type="button" onClick={onClose}>Cancel</Btn></div>
      </form>
    </Card>
  );
};

export default () => {
  const { o, org } = useSession();
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState('ACTIVE');
  const load = useLoad(() => o(`/projects?status=${status}`), [org.id, status]);
  return (
    <Page title="Projects" lead="Log hours for a customer, bill them in one go, and see what each project earns." actions={<Btn kind="primary" onClick={() => setAdding(true)}>New project</Btn>}>
      {adding && <NewProject onDone={load.reload} onClose={() => setAdding(false)} />}
      <Card>
        <p className="actions">{['ACTIVE', 'COMPLETED', 'ARCHIVED'].map((s) => <Btn key={s} kind={status === s ? 'primary' : undefined} onClick={() => setStatus(s)}>{s.charAt(0) + s.slice(1).toLowerCase()}</Btn>)}</p>
        <Async load={load}>{(rows) => (
          <Table head={['Project', 'Customer', '>Hours', '>To bill', '>Invoiced', '>Costs', '>Profit']} empty={!rows.length && <Empty>No {status.toLowerCase()} projects.</Empty>}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/projects/${r.id}`}>{r.name}</Link>{r.code && <span className="muted"> · {r.code}</span>}</td>
                <td>{r.customer || <span className="muted">none</span>}</td>
                <td className="r num">{hours(r.minutes)}</td><td className="r"><Money v={r.unbilled_minor} /></td><td className="r"><Money v={r.invoiced_minor} /></td>
                <td className="r"><Money v={r.cost_minor} /></td><td className="r"><Money v={r.profit_minor} strong /></td>
              </tr>
            ))}
          </Table>
        )}</Async>
      </Card>
    </Page>
  );
};

const LogTime = ({ id, onDone }) => {
  const { o } = useSession();
  const a = useAction();
  const [f, setF] = useState({ date: today(), hours: '', notes: '', billable: true, rate: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      await o(`/projects/${id}/time`, { method: 'POST', body: { date: f.date, hours: f.hours, billable: f.billable, ...(f.notes && { notes: f.notes }), ...(f.rate && { rate: f.rate }) } });
      setF({ ...f, hours: '', notes: '', rate: '' }); await onDone();
    }, 'Time logged.');
  };
  return (
    <Card title="Log time"><Err>{a.error}</Err><Note>{a.done}</Note>
      <form className="form" onSubmit={save}>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} required /></Field>
        <Field label="Hours" hint="Like 1.5 or 1:30"><input value={f.hours} onChange={set('hours')} required maxLength={8} /></Field>
        <Field label="What was done"><input value={f.notes} onChange={set('notes')} maxLength={300} /></Field>
        <Field label="Rate per hour (₹)" hint="Empty uses the project rate"><input inputMode="decimal" value={f.rate} onChange={set('rate')} /></Field>
        <p className="check"><input id="bill" type="checkbox" checked={f.billable} onChange={set('billable')} /><label htmlFor="bill">Billable</label></p>
        <div className="wide actions"><Btn kind="primary" busy={a.busy}>Add</Btn></div>
      </form>
    </Card>
  );
};

const InvoiceHours = ({ id, onDone, onClose }) => {
  const { o, org } = useSession();
  const a = useAction();
  const rates = useLoad(() => o('/tax-rates'), [org.id]);
  const [f, setF] = useState({ date: today(), taxCode: 'GST18' });
  const codes = [...new Set((rates.data || []).map((r) => r.code))];
  return (
    <Confirm><p>All unbilled billable time becomes lines on a draft invoice to the project's customer. You can review it before issuing.</p>
      <Err>{a.error}</Err>
      <div className="form">
        <Field label="Invoice date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
        <Field label="GST on the work"><select value={f.taxCode} onChange={(e) => setF({ ...f, taxCode: e.target.value })}>{(codes.length ? codes : ['GST18']).map((c) => <option key={c}>{c}</option>)}</select></Field>
      </div>
      <p className="actions"><Btn kind="primary" busy={a.busy} onClick={() => a.run(async () => { await o(`/projects/${id}/invoice`, { method: 'POST', body: f }); await onDone(); onClose(); }, 'Draft invoice created.')}>Create draft invoice</Btn><Btn onClick={onClose}>Cancel</Btn></p>
    </Confirm>
  );
};

export const ProjectView = () => {
  const { id } = useParams();
  const { o, org } = useSession();
  const load = useLoad(() => o(`/projects/${id}`), [org.id, id]);
  const a = useAction();
  const [billing, setBilling] = useState(false);
  const setStatus = (status) => a.run(async () => { await o(`/projects/${id}`, { method: 'PATCH', body: { status } }); await load.reload(); });
  return (
    <Async load={load}>{(p) => (
      <Page title={p.name} lead={`${p.customer || 'No customer yet'}${p.hourly_rate_minor > 0 ? ` · ₹${inr(p.hourly_rate_minor)} an hour` : ''}`}
        actions={<><Btn kind="primary" onClick={() => setBilling(true)}>Invoice the hours</Btn>{p.status === 'ACTIVE' ? <Btn onClick={() => setStatus('COMPLETED')}>Mark complete</Btn> : <Btn onClick={() => setStatus('ACTIVE')}>Reopen</Btn>}{p.status !== 'ARCHIVED' && <Btn onClick={() => setStatus('ARCHIVED')}>Archive</Btn>}</>}>
        <Err>{a.error}</Err>
        {billing && <InvoiceHours id={id} onDone={load.reload} onClose={() => setBilling(false)} />}
        <Card title="How it is going"><dl className="facts">
          <dt>Hours logged</dt><dd>{hours(p.minutes)} ({hours(p.unbilled_minutes)} still to bill, worth ₹{inr(p.unbilled_minor)})</dd>
          <dt>Invoiced</dt><dd>₹{inr(p.invoiced_minor)}</dd>
          <dt>Bills and expenses</dt><dd>₹{inr(p.cost_minor)}</dd>
          <dt>Profit so far</dt><dd><Money v={p.profit_minor} strong /></dd>
          {p.budget_left_minor !== null && <><dt>Budget left</dt><dd><Money v={p.budget_left_minor} /> of ₹{inr(p.budget_minor)}</dd></>}
        </dl></Card>
        <LogTime id={id} onDone={load.reload} />
        <Card title="Time">
          <Table head={['Date', 'Work', '>Hours', '>Amount', '', '']} empty={!p.time.length && <Empty>No time logged.</Empty>}>
            {p.time.map((t) => (
              <tr key={t.id}><td>{showDate(t.date)}</td><td>{t.notes}{!t.billable && <> <Badge status="VOID">not billable</Badge></>}</td>
                <td className="r num">{hours(t.minutes)}</td><td className="r">{t.billable ? <Money v={t.amount_minor} /> : ''}</td>
                <td>{t.invoice_id && <Link to={`/sales/${t.invoice_id}`}>billed</Link>}</td>
                <td>{!t.invoice_id && <button className="linkish" onClick={() => a.run(async () => { await o(`/time/${t.id}`, { method: 'DELETE' }); await load.reload(); })}>Delete</button>}</td></tr>
            ))}
          </Table>
        </Card>
        <Card title="Invoices, bills and expenses tagged to this project">
          <Table head={['What', 'Date', 'Status', '>Amount']} empty={!p.documents.length && !p.expenses.length && <Empty>Nothing tagged yet. Pick this project when you write an invoice, bill or expense.</Empty>}>
            {p.documents.map((d) => <tr key={`d${d.id}`}><td><Link to={`/${PATH[d.kind]}/${d.id}`}>{KIND[d.kind]} {d.number || '(draft)'}</Link></td><td>{showDate(d.date)}</td><td><Badge status={d.status} /></td><td className="r"><Money v={d.subtotal_minor} /></td></tr>)}
            {p.expenses.map((e) => <tr key={`e${e.id}`} className={e.reversed ? 'muted' : ''}><td>Expense {e.entry_no}{e.memo && <span className="muted"> · {e.memo}</span>}</td><td>{showDate(e.date)}</td><td>{e.reversed ? <Badge status="VOID">cancelled</Badge> : ''}</td><td className="r"><Money v={e.amount_minor} /></td></tr>)}
          </Table>
        </Card>
      </Page>
    )}</Async>
  );
};
