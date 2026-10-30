import { useEffect, useState } from 'react';
import { useLoad } from '../api.js';
import { ROLE_HELP, STATES, showDate, showTime, today } from '../lib.js';
import { useSession } from '../session.jsx';
import { api as xp } from '../../../lib/api.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { Async, Badge, Btn, Card, Empty, Err, Field, Note, Page, Table, Tabs, useAction } from '../ui.jsx';

const XB = { addressLine: '', city: '', pincode: '', phone: '', email: '', bankName: '', bankAccount: '', bankIfsc: '', upiId: '', terms: '' };
const XCOL = { addressLine: 'address_line', city: 'city', pincode: 'pincode', phone: 'phone', email: 'email', bankName: 'bank_name', bankAccount: 'bank_account', bankIfsc: 'bank_ifsc', upiId: 'upi_id', terms: 'terms' };

const Business = () => {
  const { o, org } = useSession();
  const a = useAction();
  const [f, setF] = useState({ legalName: '', gstin: '', stateCode: '', pan: '', invoicePrefix: '', ...XB });
  const load = useLoad(() => o('/profile'), [org.id]);
  useEffect(() => { const p = load.data; if (p) setF({ legalName: p.legal_name || '', gstin: p.gstin || '', stateCode: p.state_code || '', pan: p.pan || '', invoicePrefix: p.invoice_prefix || '', ...Object.fromEntries(Object.entries(XCOL).map(([k, c]) => [k, p[c] || ''])) }); }, [load.data]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      const body = { ...Object.fromEntries(Object.entries({ legalName: f.legalName, gstin: f.gstin.toUpperCase(), stateCode: f.stateCode, pan: f.pan.toUpperCase(), invoicePrefix: f.invoicePrefix.toUpperCase() }).filter(([, v]) => v)), ...Object.fromEntries(Object.keys(XCOL).map((k) => [k, f[k]])) };
      await o('/profile', { method: 'PUT', body });
    }, 'Saved. The GSTIN is checked, and the state decides CGST + SGST versus IGST on every new document.');
  };
  return (
    <Card title="Business details"><p className="muted">Your GSTIN and state decide whether a sale gets CGST + SGST or IGST.</p>
      <Err>{a.error}</Err><Note>{a.done}</Note>
      <form className="form" onSubmit={save}>
        <Field label="Legal name"><input value={f.legalName} onChange={set('legalName')} maxLength={200} /></Field>
        <Field label="GSTIN" hint="The state is taken from it"><input value={f.gstin} onChange={set('gstin')} maxLength={15} /></Field>
        <Field label="State" hint="Needed for GST if you have no GSTIN"><select value={f.stateCode} onChange={set('stateCode')}><option value="">Leave as is</option>{Object.entries(STATES).map(([c, n]) => <option key={c} value={String(c).padStart(2, '0')}>{String(c).padStart(2, '0')} · {n}</option>)}</select></Field>
        <Field label="PAN"><input value={f.pan} onChange={set('pan')} maxLength={10} /></Field>
        <Field label="Invoice number prefix" hint={`Numbers look like ${f.invoicePrefix || 'INV'}-26-27-000001 and start again each financial year`}><input value={f.invoicePrefix} onChange={set('invoicePrefix')} maxLength={3} pattern="[A-Za-z0-9]{1,3}" title="One to three letters or digits" /></Field>
        <h3 className="wide">Address and contact <span className="muted">· printed on invoices and used for e-way bills</span></h3>
        <Field label="Address" wide><input value={f.addressLine} onChange={set('addressLine')} maxLength={200} /></Field>
        <Field label="City"><input value={f.city} onChange={set('city')} maxLength={80} /></Field>
        <Field label="PIN code"><input value={f.pincode} onChange={set('pincode')} maxLength={6} inputMode="numeric" /></Field>
        <Field label="Phone"><input value={f.phone} onChange={set('phone')} maxLength={20} inputMode="tel" /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} maxLength={200} /></Field>
        <h3 className="wide">Bank, UPI and terms <span className="muted">· printed so customers know how to pay</span></h3>
        <Field label="Bank name"><input value={f.bankName} onChange={set('bankName')} maxLength={80} /></Field>
        <Field label="Account number"><input value={f.bankAccount} onChange={set('bankAccount')} maxLength={30} inputMode="numeric" /></Field>
        <Field label="IFSC"><input value={f.bankIfsc} onChange={set('bankIfsc')} maxLength={11} /></Field>
        <Field label="UPI ID"><input value={f.upiId} onChange={set('upiId')} maxLength={80} placeholder="name@bank" /></Field>
        <Field label="Terms and conditions" wide><textarea rows={3} value={f.terms} onChange={set('terms')} maxLength={1000} /></Field>
        <div className="wide"><Btn kind="primary" busy={a.busy}>Save</Btn></div>
      </form>
    </Card>
  );
};

const PRINT_DEFAULT = { paper: 'A4', accent: '#1a56db', title: '', showHsn: true, showBank: true, showTerms: true, showUnit: true };
const Printing = () => {
  const { o, org } = useSession();
  const a = useAction();
  const [f, setF] = useState(PRINT_DEFAULT);
  const load = useLoad(() => o('/profile'), [org.id]);
  useEffect(() => { if (load.data) setF({ ...PRINT_DEFAULT, ...load.data.print_settings }); }, [load.data]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = (e) => { e.preventDefault(); a.run(() => o('/profile', { method: 'PUT', body: { printSettings: f } }), 'Saved. New prints use these choices.'); };
  return (
    <Card title="Printing"><p className="muted">How invoices, bills, credit notes and receipts look on paper. Open a document and press Print to see it.</p>
      <Err>{a.error}</Err><Note>{a.done}</Note>
      <form className="form" onSubmit={save}>
        <Field label="Paper"><select value={f.paper} onChange={set('paper')}><option value="A4">A4</option><option value="A5">A5 (half page)</option><option value="THERMAL">Thermal roll (80 mm)</option></select></Field>
        <Field label="Colour"><input type="color" value={f.accent} onChange={set('accent')} /></Field>
        <Field label="Heading" hint="Leave empty for Tax Invoice / Bill of Supply as the document needs" wide><input value={f.title} onChange={set('title')} maxLength={40} /></Field>
        {[['showHsn', 'Show HSN / SAC on each line'], ['showUnit', 'Show the unit on each line'], ['showBank', 'Show bank details and UPI'], ['showTerms', 'Show terms and conditions']].map(([k, t]) => (
          <p className="check wide" key={k}><input id={k} type="checkbox" checked={f[k]} onChange={set(k)} /><label htmlFor={k}>{t}</label></p>))}
        <div className="wide"><Btn kind="primary" busy={a.busy}>Save</Btn></div>
      </form>
    </Card>
  );
};

const OpeningBalances = () => {
  const { o, org } = useSession();
  const a = useAction();
  const [f, setF] = useState({ kind: 'INVOICE', partyId: '', date: today(), amount: '', dueDate: '' });
  const parties = useLoad(() => o('/parties?limit=500'), [org.id]);
  const list = (parties.data || []).filter((p) => (f.kind === 'INVOICE' ? p.kind !== 'VENDOR' : p.kind !== 'CUSTOMER'));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, ...(k === 'kind' && { partyId: '' }) });
  const save = (e) => {
    e.preventDefault();
    a.run(async () => { await o('/opening-balances', { method: 'POST', body: { kind: f.kind, partyId: f.partyId, date: f.date, amount: f.amount, ...(f.dueDate && { dueDate: f.dueDate }) } }); setF({ ...f, partyId: '', amount: '', dueDate: '' }); },
      'Added. It shows on their statement and can be paid like any invoice or bill.');
  };
  return (
    <Card title="Opening balances"><p className="muted">What customers owed you, and what you owed vendors, on the day you started using these books. Enter one per customer or vendor, dated the day before you started. These are not sales or purchases: they stay out of GST returns and sales reports.</p>
      <Err>{a.error}</Err><Note>{a.done}</Note>
      <form className="form" onSubmit={save}>
        <Field label="Type"><select value={f.kind} onChange={set('kind')}><option value="INVOICE">A customer owes me</option><option value="BILL">I owe a vendor</option></select></Field>
        <Field label={f.kind === 'INVOICE' ? 'Customer' : 'Vendor'}><select value={f.partyId} onChange={set('partyId')} required><option value="">Choose…</option>{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Amount (₹)"><input inputMode="decimal" value={f.amount} onChange={set('amount')} required /></Field>
        <Field label="As of"><input type="date" value={f.date} onChange={set('date')} required /></Field>
        <Field label="Due date" hint="Optional"><input type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>
        <div className="wide"><Btn kind="primary" busy={a.busy}>Add opening balance</Btn></div>
      </form>
    </Card>
  );
};

const TaxRates = () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/tax-rates'), [org.id]);
  const a = useAction();
  const [f, setF] = useState({ code: '', name: '', percent: '', effectiveFrom: today() });
  const save = (e) => {
    e.preventDefault();
    a.run(async () => { await o('/tax-rates', { method: 'POST', body: { code: f.code.toUpperCase(), name: f.name, rateBp: Math.round(Number(f.percent) * 100), effectiveFrom: f.effectiveFrom } }); setF({ ...f, code: '', name: '', percent: '' }); await load.reload(); }, 'Rate added.');
  };
  return (<>
    <Card title="GST rates"><p className="muted">A document uses the latest rate that started on or before its date, so changing a rate never changes old invoices.</p>
      <Async load={load}>{(rows) => <Table head={['Code', 'Name', '>Rate', 'From']}>{rows.map((r, i) => <tr key={i}><td>{r.code}</td><td>{r.name}</td><td className="r">{r.rate_bp / 100}%</td><td>{showDate(r.effective_from)}</td></tr>)}</Table>}</Async></Card>
    <Card title="Add or change a rate"><Err>{a.error}</Err><Note>{a.done}</Note>
      <form className="form" onSubmit={save}>
        <Field label="Code" hint="Capitals, digits or underscore. Reuse a code to change its rate from a date."><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required pattern="[A-Za-z0-9_]{2,20}" /></Field>
        <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} /></Field>
        <Field label="Rate (%)"><input inputMode="decimal" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} required /></Field>
        <Field label="Applies from"><input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} required /></Field>
        <div className="wide"><Btn kind="primary" busy={a.busy}>Add rate</Btn></div>
      </form></Card>
  </>);
};

const Periods = () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/periods'), [org.id]);
  const a = useAction();
  const set = (p, status) => a.run(async () => { await o('/periods', { method: 'PUT', body: { date: p.start_date, status } }); await load.reload(); });
  return (
    <Card title="Closing the books"><p className="muted">An <strong>open</strong> month takes any entry. <strong>Soft locked</strong> stops everyday entries but a senior person can still post with a reason. <strong>Closed</strong> is final until an owner or accountant reopens it.</p>
      <Err>{a.error}</Err>
      <Async load={load}>{(rows) => <Table head={['Period', 'State', '']}>{rows.map((p) => (
        <tr key={p.id}><td>{showDate(p.start_date)} – {showDate(p.end_date)}</td><td><Badge status={p.status} /></td>
          <td className="r"><select aria-label="Change state" value={p.status} disabled={a.busy} onChange={(e) => set(p, e.target.value)}><option value="OPEN">Open</option><option value="SOFT_LOCKED">Soft locked</option><option value="CLOSED">Closed</option></select></td></tr>))}</Table>}</Async></Card>
  );
};

const Team = () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/members'), [org.id]);
  const a = useAction();
  const [f, setF] = useState({ email: '', role: 'accountant' });
  const add = (e) => { e.preventDefault(); a.run(async () => { await o('/members', { method: 'POST', body: f }); setF({ ...f, email: '' }); await load.reload(); }, 'Done.'); };
  return (<>
    <Card title="People with access"><Async load={load}>{(rows) => <Table head={['Name', 'Email', 'Can']}>{rows.map((m) => <tr key={m.id}><td>{m.name}</td><td>{m.email}</td><td><strong>{m.role}</strong> <span className="muted">· {ROLE_HELP[m.role]}</span></td></tr>)}</Table>}</Async></Card>
    <Card title="Add someone"><p className="muted">Everyone on your FlowXP team who opens FlowBook appears here, as a viewer. Choose their role to let them do more. Add or remove people in FlowXP (Staff).</p>
      <Err>{a.error}</Err><Note>{a.done}</Note>
      <form className="form" onSubmit={add}>
        <Field label="Their email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="Role" hint={ROLE_HELP[f.role]}><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.keys(ROLE_HELP).map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
        <div className="wide"><Btn kind="primary" busy={a.busy}>Add</Btn></div>
      </form></Card>
  </>);
};

/** Sales made in FlowXP reach these books by themselves, from the day the books were opened. Here: whether it is on, and anything that could not be sent. */
const Feed = () => {
  const load = useLoad(() => xp('/flowbook'), []);
  const a = useAction();
  const set = (enabled) => a.run(async () => { await xp('/flowbook', { method: 'PUT', body: { enabled } }); await load.reload(); }, enabled ? 'Sales are being sent to your books.' : 'Sales are not being sent.');
  const retry = () => a.run(async () => { await xp('/flowbook/retry', { method: 'POST' }); await load.reload(); }, 'Put back in the queue.');
  return (
    <Card title="Sales from FlowXP"><p className="muted">Every sale, return and payment you make in FlowXP is written into these books by itself, a minute or so later. Only what you bill after this was switched on is sent.</p>
      <Err>{a.error}</Err><Note>{a.done}</Note>
      <Async load={load}>{(d) => (<>
        <div className="grid">
          <div className="stat ok"><div className="k">Sent</div><div className="v">{d.counts.sent}</div></div>
          <div className="stat"><div className="k">Waiting</div><div className="v">{d.counts.pending}</div></div>
          <div className={`stat ${d.counts.skipped + d.counts.dead ? 'bad' : ''}`}><div className="k">Needs a look</div><div className="v">{d.counts.skipped + d.counts.dead}</div></div>
        </div>
        {d.link?.last_error && <Err>{d.link.last_error}</Err>}
        {d.problems.length > 0 && <Table head={['What', 'Why']}>{d.problems.map((p) => <tr key={p.outbox_id}><td>{String(p.event_type).replace('.', ' ')} <span className="muted">#{p.source_id}</span></td><td>{p.last_error || p.status}</td></tr>)}</Table>}
        <div className="actions">
          {d.link?.enabled ? <Btn busy={a.busy} onClick={() => set(false)}>Stop sending</Btn> : <Btn kind="primary" busy={a.busy} onClick={() => set(true)}>Start sending</Btn>}
          {d.counts.dead > 0 && <Btn busy={a.busy} onClick={retry}>Try the stuck ones again</Btn>}
        </div>
      </>)}</Async></Card>
  );
};

const Activity = () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/audit?limit=100'), [org.id]);
  return <Card title="Activity log"><p className="muted">Who changed what, newest first. It cannot be edited.</p>
    <Async load={load}>{(rows) => <Table head={['When', 'Who', 'What']} empty={!rows.length && <Empty>Nothing yet.</Empty>}>{rows.map((r) => <tr key={r.id}><td>{showTime(r.created_at)}</td><td>{String(r.actor).replace('user:', 'user ')}</td><td>{String(r.action).replaceAll('.', ' ').replaceAll('_', ' ')} <span className="muted">{r.entity_type}</span></td></tr>)}</Table>}</Async></Card>;
};

import { WhatsappSettings } from './Whatsapp.jsx';
import { EmailSettings } from './Email.jsx';
import { CurrencySettings } from './Currency.jsx';

export default () => {
  const { on } = useSession();
  const till = useAuth().business?.business_type !== 'FLOWBOOK';   // a business that signed up for FlowBook alone has no till to send from
  const [tab, setTab] = useState('biz');
  return (
    <Page title="Settings">
      <Tabs value={tab} onChange={setTab} tabs={[['biz', 'Business'], ['print', 'Printing'], ['open', 'Opening balances'], ['tax', 'GST rates'], ['periods', 'Closing'], ['team', 'Team'], ['wa', 'WhatsApp'], ['email', 'Email'], ['fx', 'Currencies'], ['feed', 'Sales from FlowXP'], ['log', 'Activity']].filter(([k]) => (k !== 'feed' || till) && on({ wa: 'flowbook_whatsapp', email: 'flowbook_email', fx: 'flowbook_currency' }[k] || 'flowbook_app'))} />
      {tab === 'biz' && <Business />}{tab === 'print' && <Printing />}{tab === 'open' && <OpeningBalances />}{tab === 'tax' && <TaxRates />}{tab === 'periods' && <Periods />}{tab === 'team' && <Team />}{tab === 'wa' && <WhatsappSettings />}{tab === 'email' && <EmailSettings />}{tab === 'fx' && <CurrencySettings />}{tab === 'feed' && <Feed />}{tab === 'log' && <Activity />}
    </Page>
  );
};
