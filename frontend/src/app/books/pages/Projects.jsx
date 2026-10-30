/* Projects: hours logged against a customer, invoiced from the log, with the bills and expenses tagged to the project and its profit. */
import { useState } from 'react';
import { Link, useParams } from '../router.jsx';
import { useLoad } from '../api.js';
import { UNITS, inr, showDate, today } from '../lib.js';
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
          <Table head={['Project', 'Customer', '>Budget', '>Spent', '>Budget left', '>Received', '>Profit']} empty={!rows.length && <Empty>No {status.toLowerCase()} projects.</Empty>}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/projects/${r.id}`}>{r.name}</Link>{r.code && <span className="muted"> · {r.code}</span>}</td>
                <td>{r.customer || <span className="muted">none</span>}</td>
                <td className="r">{r.budget_minor > 0 ? <Money v={r.budget_minor} /> : <span className="muted">not set</span>}</td><td className="r"><Money v={r.cost_minor} /></td>
                <td className="r">{r.budget_left_minor === null ? <span className="muted">-</span> : <Money v={r.budget_left_minor} />}</td><td className="r"><Money v={r.receipts_minor} /></td><td className="r"><Money v={r.profit_minor} strong /></td>
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

/** The money picture of a project: budget, what was spent and on what, what the customer has paid. Spent and the breakdown are before GST. */
const Dashboard = ({ p }) => {
  const budget = p.budget_minor > 0 ? Number(p.budget_minor) : 0;
  const used = budget ? Math.round((Number(p.cost_minor) / budget) * 100) : 0;
  const left = p.budget_left_minor === null ? null : Number(p.budget_left_minor);
  return (<>
    <div className="fb-kpis">
      <div className="fb-kpi"><span>Total budget</span><strong>{budget ? `₹${inr(p.budget_minor)}` : 'Not set'}</strong></div>
      <div className="fb-kpi"><span>Total spent</span><strong>₹{inr(p.cost_minor)}</strong></div>
      <div className="fb-kpi"><span>Customer receipts</span><strong className="pos">₹{inr(p.receipts_minor)}</strong></div>
      <div className="fb-kpi"><span>Budget remaining</span><strong className={left !== null && left < 0 ? 'neg' : ''}>{left === null ? 'Set a budget' : `${left < 0 ? '-' : ''}₹${inr(Math.abs(left))}`}</strong></div>
    </div>
    {budget > 0 && <div className="fb-budget"><div className="fb-bar-line"><i className={used > 100 ? 'bad' : used > 80 ? 'warn' : ''} style={{ width: `${Math.min(used, 100)}%` }} /></div><p className="muted">{used}% of the budget used</p></div>}
    <Card title="Expense breakdown">
      {p.breakdown.length === 0
        ? <Empty>No costs yet. Pick this project on a bill or expense, or when you take goods out of stock, and choose the kind of cost.</Empty>
        : p.breakdown.map((b) => (
          <div className="fb-split" key={b.category}>
            <div><span>{b.category}</span><span className="muted">₹{inr(b.amount_minor)} · {Math.round(b.share_bp / 100)}%</span></div>
            <div className="fb-track"><i style={{ width: `${Math.max(b.share_bp / 100, 1)}%` }} /></div>
          </div>))}
      <p className="muted">Before GST. Goods you count in stock reach the project when you take them out of stock for it, not when you buy them.</p>
    </Card>
  </>);
};

const PLAN = [['Booking', '10'], ['Foundation', '20'], ['Slab', '40'], ['Possession', '30']];

/* Flats and plots: a price, a buyer and stage instalments. Raising a stage invoices the buyer for that share. */
const Units = ({ id }) => {
  const { o, org } = useSession();
  const load = useLoad(() => o(`/projects/${id}/units`), [org.id, id]);
  const buyers = useLoad(() => o('/parties?kind=CUSTOMER&limit=500'), [org.id]);
  const a = useAction();
  const [add, setAdd] = useState({ name: '', price: '' });
  const [sell, setSell] = useState(null);
  const total = sell ? sell.stages.reduce((n, x) => n + (Number(x.percent) || 0), 0) : 0;
  const setStage = (i, k, v) => setSell({ ...sell, stages: sell.stages.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const doSell = () => a.run(async () => {
    await o(`/units/${sell.unit}/sell`, { method: 'POST', body: { partyId: sell.partyId, date: today(), stages: sell.stages.map((x) => ({ name: x.name, percent: Number(x.percent), ...(x.dueDate ? { dueDate: x.dueDate } : {}) })) } });
    setSell(null); await load.reload();
  });
  return (
    <Card title="Flats and plots"><p className="muted">Add each unit with its price. When it is sold, choose the buyer and the stages; raise a stage when it falls due and the buyer is invoiced for that share.</p>
      <Err>{a.error}</Err>
      <Async load={load}>{(units) => (
        <>
          <Table head={['Unit', 'Buyer', '>Price', '>Asked for', '>Received', '']} empty={!units.length && <Empty>No units yet.</Empty>}>
            {units.flatMap((u) => [
              <tr key={u.id}><td><strong>{u.name}</strong></td><td>{u.buyer || <Badge status="DRAFT">for sale</Badge>}</td><td className="r"><Money v={u.price_minor} /></td>
                <td className="r"><Money v={u.invoiced_minor} /></td><td className="r"><Money v={u.received_minor} /></td>
                <td>{!u.party_id && <button className="linkish" onClick={() => setSell({ unit: u.id, name: u.name, partyId: '', stages: PLAN.map(([name, percent]) => ({ name, percent, dueDate: '' })) })}>Sell</button>}</td></tr>,
              ...u.stages.map((s) => (
                <tr key={`s${s.id}`} className="muted"><td>&nbsp;&nbsp;{s.name} ({s.share_bp / 100}%)</td><td>{s.due_date ? `due ${showDate(s.due_date)}` : ''}</td><td className="r"><Money v={s.amount_minor} /></td>
                  <td className="r">{s.invoice_id ? <Link to={`/sales/${s.invoice_id}`}>{s.invoice_number}</Link> : ''}</td><td className="r">{s.invoice_id ? <Money v={s.received_minor} /> : ''}</td>
                  <td>{!s.invoice_id && <button className="linkish" onClick={() => a.run(async () => { await o(`/unit-stages/${s.id}/raise`, { method: 'POST', body: { date: today() } }); await load.reload(); })}>Raise</button>}</td></tr>))
            ])}
          </Table>
          {sell && (
            <Confirm><p>Sell {sell.name}. The stages must add up to 100% (now {total}%).</p>
              <div className="form">
                <Field label="Buyer"><select value={sell.partyId} onChange={(e) => setSell({ ...sell, partyId: e.target.value })}><option value="">Choose a customer</option>{(buyers.data?.parties || buyers.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
              </div>
              <div style={{ display: 'grid', gap: '.5rem', margin: '.5rem 0 1rem' }}>
                {sell.stages.map((x, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(7rem, 2fr) 5rem minmax(9rem, 1.2fr)', gap: '.5rem' }}>
                    <input aria-label="Stage" value={x.name} onChange={(e) => setStage(i, 'name', e.target.value)} />
                    <input aria-label="Percent" inputMode="decimal" style={{ width: '5rem' }} value={x.percent} onChange={(e) => setStage(i, 'percent', e.target.value)} />
                    <input aria-label="Due date" type="date" value={x.dueDate} onChange={(e) => setStage(i, 'dueDate', e.target.value)} />
                  </div>))}
              </div>
              <Btn kind="primary" busy={a.busy} onClick={doSell}>Sell</Btn> <Btn onClick={() => setSell(null)}>Cancel</Btn></Confirm>
          )}
        </>)}</Async>
      <form className="form" onSubmit={(e) => { e.preventDefault(); a.run(async () => { await o(`/projects/${id}/units`, { method: 'POST', body: add }); setAdd({ name: '', price: '' }); await load.reload(); }); }}>
        <Field label="New unit (e.g. A-101)"><input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
        <Field label="Price (₹)"><input inputMode="decimal" value={add.price} onChange={(e) => setAdd({ ...add, price: e.target.value })} /></Field>
        <Btn type="submit" busy={a.busy}>Add unit</Btn>
      </form>
    </Card>
  );
};

const qty = (t) => String(Number(t));   // "12.500" -> "12.5"

/* Work orders and running-account bills: the work agreed with a subcontractor or a client, billed stage by stage by measuring what is done to date. */
const WorkOrders = ({ id }) => {
  const { o, org } = useSession();
  const load = useLoad(() => o(`/projects/${id}/work-orders`), [org.id, id]);
  const parties = useLoad(() => o('/parties?limit=500'), [org.id]);
  const a = useAction();
  const blank = { side: 'PAYABLE', partyId: '', title: '', retention: '5', items: [{ description: '', unit: 'SQM', quantity: '', rate: '' }] };
  const [form, setForm] = useState(null);
  const [ra, setRa] = useState(null);
  const setItem = (i, k, v) => setForm({ ...form, items: form.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const who = (parties.data || []).filter((x) => (form?.side === 'PAYABLE' ? x.kind !== 'CUSTOMER' : x.kind !== 'VENDOR'));
  const create = () => a.run(async () => {
    await o(`/projects/${id}/work-orders`, { method: 'POST', body: { side: form.side, partyId: form.partyId, title: form.title, retentionPercent: Number(form.retention) || 0, items: form.items.filter((x) => x.description.trim()).map((x) => ({ description: x.description, unit: x.unit, quantity: x.quantity, rate: x.rate })) } });
    setForm(null); await load.reload();
  });
  const raise = () => a.run(async () => {
    await o(`/work-orders/${ra.id}/ra-bills`, { method: 'POST', body: { date: today(), measured: ra.items.filter((x) => x.value !== '').map((x) => ({ itemId: x.id, quantity: x.value })) } });
    setRa(null); await load.reload();
  });
  return (
    <Card title="Work orders and running bills" actions={<Btn onClick={() => setForm(form ? null : blank)}>New work order</Btn>}>
      <p className="muted">List the work agreed with a subcontractor (you pay) or a client (they pay). Each running bill takes the total work done to date, bills only what is new, and holds back the retention.</p>
      <Err>{a.error}</Err>
      {form && (
        <Confirm><div className="form">
          <Field label="Who is it with"><select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value, partyId: '' })}><option value="PAYABLE">A subcontractor or vendor (I pay)</option><option value="RECEIVABLE">A client (they pay me)</option></select></Field>
          <Field label="Name"><select value={form.partyId} onChange={(e) => setForm({ ...form, partyId: e.target.value })}><option value="">Choose</option>{who.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label="Work (e.g. Plastering, Block A)"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Retention held back (%)"><input inputMode="decimal" value={form.retention} onChange={(e) => setForm({ ...form, retention: e.target.value })} /></Field>
        </div>
        <div style={{ display: 'grid', gap: '.5rem', margin: '.5rem 0' }}>
          {form.items.map((x, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(8rem, 3fr) minmax(6rem, 1.2fr) minmax(5rem, 1fr) minmax(5rem, 1fr)', gap: '.5rem' }}>
              <input aria-label="Work item" placeholder="Item of work" value={x.description} onChange={(e) => setItem(i, 'description', e.target.value)} />
              <select aria-label="Unit" value={x.unit} onChange={(e) => setItem(i, 'unit', e.target.value)}>{UNITS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
              <input aria-label="Quantity" placeholder="Quantity" inputMode="decimal" value={x.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} />
              <input aria-label="Rate" placeholder="Rate ₹" inputMode="decimal" value={x.rate} onChange={(e) => setItem(i, 'rate', e.target.value)} />
            </div>))}
          <button type="button" className="linkish" style={{ justifySelf: 'start' }} onClick={() => setForm({ ...form, items: [...form.items, { description: '', unit: 'SQM', quantity: '', rate: '' }] })}>+ Add another item</button>
        </div><Btn kind="primary" busy={a.busy} onClick={create}>Save work order</Btn></Confirm>
      )}
      <Async load={load}>{(orders) => (<>
        {!orders.length && !form && <Empty>No work orders yet.</Empty>}
        {orders.map((w) => (
          <div key={w.id} style={{ marginTop: '1rem' }}>
            <p><strong>{w.title}</strong> <span className="muted">{w.side === 'PAYABLE' ? 'you pay' : 'client pays'} {w.party_name} · retention {w.retention_bp / 100}%</span></p>
            <Table head={['Work', '>Agreed', '>Rate', '>Done to date', '>Value done']}>
              {w.items.map((i) => <tr key={i.id}><td>{i.description}</td><td className="r num">{qty(i.quantity)} {i.unit || ''}</td><td className="r"><Money v={i.rate_minor} /></td><td className="r num">{qty(i.done_quantity)}</td><td className="r"><Money v={i.done_minor} /></td></tr>)}
            </Table>
            <p className="muted">Work done so far: <Money v={w.done_minor} /> of <Money v={w.contract_minor} /> agreed.</p>
            {w.bills.length > 0 && <Table head={['Running bill', 'Date', 'Status', '>Amount', '>Held back']}>
              {w.bills.map((b) => <tr key={b.id}><td><Link to={`/${w.side === 'PAYABLE' ? 'purchases' : 'sales'}/${b.document_id}`}>RA {b.seq} · {b.number}</Link></td><td>{showDate(b.bill_date)}</td><td><Badge status={b.status} /></td><td className="r"><Money v={b.total_minor} /></td><td className="r">{Number(b.retention_minor) ? <Money v={b.retention_minor} /> : ''}</td></tr>)}
            </Table>}
            {ra?.id === w.id ? (
              <Confirm><p>Type the total work done to date for each item. Only the new work since the last bill is billed.</p>
                <div className="form">{ra.items.map((x, k) => <Field key={x.id} label={`${x.description} (agreed ${x.max}, billed so far ${x.was})`}><input inputMode="decimal" placeholder={x.was} value={x.value} onChange={(e) => setRa({ ...ra, items: ra.items.map((y, j) => (j === k ? { ...y, value: e.target.value } : y)) })} /></Field>)}</div>
                <Btn kind="primary" busy={a.busy} onClick={raise}>Make running bill</Btn> <Btn onClick={() => setRa(null)}>Cancel</Btn></Confirm>
            ) : <Btn onClick={() => setRa({ id: w.id, items: w.items.map((i) => ({ id: i.id, description: i.description, max: qty(i.quantity), was: qty(i.done_quantity), value: '' })) })}>Next running bill</Btn>}
          </div>))}
      </>)}</Async>
    </Card>
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
        <Dashboard p={p} />
        <Units id={id} />
        <WorkOrders id={id} />
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
