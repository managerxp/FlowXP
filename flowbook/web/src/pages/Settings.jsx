import { useEffect, useState } from 'react';
import { useLoad } from '../api.js';
import { ROLE_HELP, STATES, showDate, showTime, today } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Badge, Btn, Card, Empty, Err, Field, Note, Page, Table, Tabs, useAction } from '../ui.jsx';

const Business = () => {
  const { o, org } = useSession();
  const a = useAction();
  const [f, setF] = useState({ legalName: '', gstin: '', stateCode: '', pan: '', invoicePrefix: '' });
  const load = useLoad(() => o('/profile'), [org.id]);
  useEffect(() => { const p = load.data; if (p) setF({ legalName: p.legal_name || '', gstin: p.gstin || '', stateCode: p.state_code || '', pan: p.pan || '', invoicePrefix: p.invoice_prefix || '' }); }, [load.data]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      const body = Object.fromEntries(Object.entries({ legalName: f.legalName, gstin: f.gstin.toUpperCase(), stateCode: f.stateCode, pan: f.pan.toUpperCase(), invoicePrefix: f.invoicePrefix.toUpperCase() }).filter(([, v]) => v));
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
        <div className="wide"><Btn kind="primary" busy={a.busy}>Save</Btn></div>
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
    <Card title="Add someone"><p className="muted">They must create a FlowBook account first. Adding someone who is already here changes their role.</p>
      <Err>{a.error}</Err><Note>{a.done}</Note>
      <form className="form" onSubmit={add}>
        <Field label="Their email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="Role" hint={ROLE_HELP[f.role]}><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.keys(ROLE_HELP).map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
        <div className="wide"><Btn kind="primary" busy={a.busy}>Add</Btn></div>
      </form></Card>
  </>);
};

const FlowXP = () => {
  const { o, org } = useSession();
  const conns = useLoad(() => o('/integrations/flowxp/connections'), [org.id]);
  const [status, setStatus] = useState('');
  const events = useLoad(() => o(`/integrations/events?limit=50${status ? `&status=${status}` : ''}`), [org.id, status]);
  const a = useAction();
  const [f, setF] = useState({ businessId: '', cutoverDate: '' });
  const [secret, setSecret] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [secret]);
  const connect = (e) => { e.preventDefault(); a.run(async () => { const r = await o('/integrations/flowxp/connections', { method: 'POST', body: { businessId: f.businessId, ...(f.cutoverDate && { cutoverDate: f.cutoverDate }) } }); setSecret(r.secret); setF({ businessId: '', cutoverDate: '' }); await conns.reload(); }); };
  const rotate = (c) => a.run(async () => { const r = await o(`/integrations/flowxp/connections/${c.id}/rotate-secret`, { method: 'POST', body: {} }); setSecret(r.secret); });
  const replay = (ev) => a.run(async () => { await o(`/integrations/events/${ev.id}/replay`, { method: 'POST', body: {} }); await events.reload(); }, 'Tried again.');
  const copy = async () => { try { await navigator.clipboard.writeText(secret); setCopied(true); } catch { /* the secret is on screen to copy by hand */ } };
  return (<>
    {secret && (
      <Card title="Your secret — shown only once"><p>Copy it now and paste it into FlowXP (Settings, FlowBook). It cannot be shown again; if you lose it, make a new one.</p>
        <p className="secret">{secret}</p><div className="actions"><Btn onClick={copy}>{copied ? 'Copied' : 'Copy'}</Btn><Btn onClick={() => setSecret(null)}>I have saved it</Btn></div></Card>
    )}
    <Err>{a.error}</Err><Note>{a.done}</Note>
    <Card title="Connected FlowXP businesses"><Async load={conns}>{(rows) => (
      <Table head={['FlowXP business number', 'Counts sales from', 'State', '']} empty={!rows.length && <Empty>Not connected. Add your FlowXP business below.</Empty>}>
        {rows.map((c) => <tr key={c.id}><td>{c.external_business_id}</td><td>{c.cutover_date ? showDate(c.cutover_date) : 'the start'}</td><td><Badge status={c.active ? 'OPEN' : 'CLOSED'}>{c.active ? 'active' : 'off'}</Badge></td><td className="r"><button className="linkish" onClick={() => rotate(c)}>New secret</button></td></tr>)}
      </Table>)}</Async></Card>
    <Card title="Connect a FlowXP business"><p className="muted">The business number is shown on FlowXP's FlowBook screen. Sales dated before the start date are ignored, so you can begin from a clean opening balance.</p>
      <form className="form" onSubmit={connect}>
        <Field label="FlowXP business number"><input value={f.businessId} onChange={(e) => setF({ ...f, businessId: e.target.value })} required inputMode="numeric" /></Field>
        <Field label="Count sales from" hint="Optional"><input type="date" value={f.cutoverDate} onChange={(e) => setF({ ...f, cutoverDate: e.target.value })} /></Field>
        <div className="wide"><Btn kind="primary" busy={a.busy}>Connect</Btn></div>
      </form></Card>
    <Card title="What arrived from FlowXP">
      <Tabs value={status} onChange={setStatus} tabs={[['', 'All'], ['NEEDS_ATTENTION', 'Needs a look'], ['FAILED_VALIDATION', 'Rejected'], ['POSTED', 'Posted']]} />
      <Async load={events}>{(rows) => (
        <Table head={['When', 'What', 'State', 'Detail', '']} empty={!rows.length && <Empty>Nothing yet.</Empty>}>
          {rows.map((e) => <tr key={e.id}><td>{showTime(e.received_at)}</td><td>{String(e.event_type).replaceAll('.', ' ')}</td><td><Badge status={e.status} /></td><td>{e.error}</td>
            <td className="r">{['NEEDS_ATTENTION', 'FAILED_VALIDATION', 'RECEIVED'].includes(e.status) && <button className="linkish" onClick={() => replay(e)}>Try again</button>}</td></tr>)}
        </Table>)}</Async></Card>
  </>);
};

const Activity = () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/audit?limit=100'), [org.id]);
  return <Card title="Activity log"><p className="muted">Who changed what, newest first. It cannot be edited.</p>
    <Async load={load}>{(rows) => <Table head={['When', 'Who', 'What']} empty={!rows.length && <Empty>Nothing yet.</Empty>}>{rows.map((r) => <tr key={r.id}><td>{showTime(r.created_at)}</td><td>{String(r.actor).replace('user:', 'user ')}</td><td>{String(r.action).replaceAll('.', ' ').replaceAll('_', ' ')} <span className="muted">{r.entity_type}</span></td></tr>)}</Table>}</Async></Card>;
};

export default ({ AddBusiness }) => {
  const [tab, setTab] = useState('biz');
  return (
    <Page title="Settings">
      <Tabs value={tab} onChange={setTab} tabs={[['biz', 'Business'], ['tax', 'GST rates'], ['periods', 'Closing'], ['team', 'Team'], ['flowxp', 'FlowXP'], ['log', 'Activity'], ['new', 'Add business']]} />
      {tab === 'biz' && <Business />}{tab === 'tax' && <TaxRates />}{tab === 'periods' && <Periods />}{tab === 'team' && <Team />}{tab === 'flowxp' && <FlowXP />}{tab === 'log' && <Activity />}{tab === 'new' && <AddBusiness />}
    </Page>
  );
};
