/* Expenses paid at the time: rent, fuel, repairs. Something you will pay later belongs in Purchases as a bill. */
import { useState } from 'react';
import { Link } from '../router.jsx';
import { useLoad } from '../api.js';
import { COST_TYPES, financialYear, inr, showDate, today, uuid } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Badge, Btn, Card, Empty, Err, Field, Money, Note, Page, Table, useAction } from '../ui.jsx';

const blank = () => ({ date: today(), accountId: '', amount: '', taxCode: '', interState: false, paidWith: 'CASH', description: '', paidTo: '', reference: '', projectId: '', projectCategory: 'Other', key: uuid() });
const MODES = { CASH: 'Cash', BANK: 'Bank', UPI: 'UPI', CARD: 'Card' };

export default () => {
  const { o, org } = useSession();
  const fy = financialYear();
  const [range, setRange] = useState({ from: fy.from, to: today() });
  const [f, setF] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState('');
  const a = useAction();
  const load = useLoad(() => o(`/expenses?from=${range.from}&to=${range.to}`), [org.id, range.from, range.to]);
  const accounts = useLoad(() => o('/accounts'), [org.id]);
  const rates = useLoad(() => o('/tax-rates'), [org.id]);
  const projects = useLoad(() => o('/projects?status=ACTIVE'), [org.id]);
  const spend = (accounts.data || []).filter((x) => x.type === 'EXPENSE' && x.active !== false && x.system_key !== 'ROUND_OFF');
  const codes = [...new Set((rates.data || []).map((r) => r.code))].filter((c) => c !== 'GST0');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const total = (load.data || []).filter((x) => !x.reversed).reduce((s, x) => s + Number(x.total_minor), 0);

  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      await o('/expenses', { method: 'POST', body: { date: f.date, accountId: f.accountId, amount: f.amount, paidWith: f.paidWith, description: f.description, idempotencyKey: f.key,
        ...(f.taxCode && { taxCode: f.taxCode, interState: f.interState }), ...(f.paidTo && { paidTo: f.paidTo }), ...(f.reference && { reference: f.reference }), ...(f.projectId && { projectId: f.projectId, projectCategory: f.projectCategory }) } });
      setF(blank()); await load.reload();
    }, 'Expense saved.');
  };
  const doVoid = () => a.run(async () => { await o(`/expenses/${voiding}/void`, { method: 'POST', body: { date: today(), reason } }); setVoiding(null); setReason(''); await load.reload(); }, 'Expense voided.');

  return (
    <Page title="Expenses" lead="Money you spent and paid at once. For something you will pay later, make a purchase bill instead." actions={<Btn kind="primary" onClick={() => { a.setError(''); a.setDone(''); setF(blank()); }}>Add expense</Btn>}>
      <Note>{a.done}</Note>
      {f && (
        <Card title="New expense"><Err>{a.error}</Err>
          <form className="form" onSubmit={save}>
            <Field label="Date"><input type="date" value={f.date} onChange={set('date')} required /></Field>
            <Field label="What for"><select value={f.accountId} onChange={set('accountId')} required><option value="">Choose…</option>{spend.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <span className="hint">Missing one? <Link to="/accounts">Add an expense account</Link>.</span></Field>
            <Field label="Amount before GST (₹)"><input inputMode="decimal" value={f.amount} onChange={set('amount')} required /></Field>
            <Field label="GST on it" hint="Only if the bill shows GST you can claim back"><select value={f.taxCode} onChange={set('taxCode')}><option value="">None</option>{codes.map((c) => <option key={c}>{c}</option>)}</select></Field>
            {f.taxCode && <p className="check wide"><input id="inter" type="checkbox" checked={f.interState} onChange={set('interState')} /><label htmlFor="inter">The seller is in another state (IGST)</label></p>}
            <Field label="Paid with"><select value={f.paidWith} onChange={set('paidWith')}>{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Note" hint="For example: June shop rent"><input value={f.description} onChange={set('description')} required maxLength={200} /></Field>
            {!!projects.data?.length && <Field label="Project" hint="Optional"><select value={f.projectId} onChange={set('projectId')}><option value="">None</option>{projects.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
            {f.projectId && <Field label="Kind of cost" hint="Shows in the project's cost breakdown"><select value={f.projectCategory} onChange={set('projectCategory')}>{COST_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>}
            <Field label="Paid to" hint="Optional"><input value={f.paidTo} onChange={set('paidTo')} maxLength={120} /></Field>
            <Field label="Bill or reference no." hint="Optional"><input value={f.reference} onChange={set('reference')} maxLength={60} /></Field>
            <div className="wide actions"><Btn kind="primary" busy={a.busy}>Save</Btn><Btn type="button" onClick={() => setF(null)}>Cancel</Btn></div>
          </form></Card>
      )}
      <Card className="no-print"><div className="form">
        <Field label="From"><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="To"><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
      </div></Card>
      {voiding && (
        <div className="confirm"><p>Voiding reverses the entry in the books, including the GST credit.</p>
          <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <p className="actions"><Btn kind="danger" busy={a.busy} disabled={!reason} onClick={doVoid}>Void expense</Btn><Btn onClick={() => setVoiding(null)}>Keep it</Btn></p></div>
      )}
      {!f && <Err>{a.error}</Err>}
      <Card title={`Spent in this period: ₹${inr(total)}`}><Async load={load}>{(rows) => (
        <Table head={['Date', 'What for', 'Note', 'Paid with', '>GST', '>Total', '']} empty={!rows.length && <Empty>No expenses in this period.</Empty>}>
          {rows.map((x) => (
            <tr key={x.id}><td>{showDate(x.date)}</td><td>{x.account}</td><td>{x.memo}</td><td>{x.paid_with}</td><td className="r">{Number(x.tax_minor) ? <Money v={x.tax_minor} /> : ''}</td><td className="r"><Money v={x.total_minor} /></td>
              <td className="r">{x.reversed ? <Badge status="VOID" /> : <Btn className="btn small danger" onClick={() => setVoiding(x.id)}>Void</Btn>}</td></tr>
          ))}
        </Table>
      )}</Async></Card>
    </Page>
  );
};
