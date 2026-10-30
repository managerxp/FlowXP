/* Currencies: the exchange rates a business uses when it writes an invoice or bill in a foreign currency. */
import { useState } from 'react';
import { useLoad } from '../api.js';
import { showDate, today } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Btn, Card, Empty, Err, Field, Note, Table, useAction } from '../ui.jsx';

const Revalue = () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/fx/revaluations'), [org.id]);
  const a = useAction();
  const [date, setDate] = useState(today());
  const run = (e) => { e.preventDefault(); a.run(async () => { const r = await o('/fx/revalue', { method: 'POST', body: { date } }); await load.reload(); return r; }, 'Revalued. It is reversed the next day.'); };
  return (
    <Card title="Revalue open foreign balances">
      <p className="muted">At a period end, restate unpaid foreign invoices and bills at that day's rate (save the rate first). The difference is posted as an exchange gain or loss on that date and reversed the next day, so settling the document later is not affected.</p>
      <Err>{a.error}</Err><Note>{a.done}</Note>
      <form className="form" onSubmit={run}><Field label="As of"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <div className="wide actions"><Btn kind="primary" busy={a.busy}>Revalue</Btn></div></form>
      <Async load={load}>{(rows) => (rows.length ? <Table head={['As of', '>Net difference', 'Reversed']}>{rows.map((r) => <tr key={r.id}><td>{showDate(r.as_of)}</td><td className="r num">₹{r.net_minor}</td><td>{r.reversed ? 'yes' : 'pending'}</td></tr>)}</Table> : null)}</Async>
    </Card>
  );
};

export const CurrencySettings = () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/exchange-rates'), [org.id]);
  const a = useAction();
  const [f, setF] = useState({ currency: 'USD', date: today(), rate: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (e) => { e.preventDefault(); a.run(async () => { await o('/exchange-rates', { method: 'PUT', body: f }); setF({ ...f, rate: '' }); await load.reload(); }, 'Rate saved.'); };
  return <Async load={load}>{(d) => (<>
    <Err>{a.error}</Err><Note>{a.done}</Note>
    <Card title="Exchange rates">
      <p className="muted">Your books and GST are in rupees. An invoice or bill in another currency is converted at the rate for its date: the latest one saved on or before it, which you can change on the document. Use the rate your bank or the government's notified rate gives you.</p>
      <form className="form" onSubmit={save}>
        <Field label="Currency"><select value={f.currency} onChange={set('currency')}>{Object.entries(d.currencies).map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select></Field>
        <Field label="From date"><input type="date" value={f.date} onChange={set('date')} required /></Field>
        <Field label={`Rupees for 1 ${f.currency}`}><input inputMode="decimal" value={f.rate} onChange={set('rate')} required /></Field>
        <div className="wide actions"><Btn kind="primary" busy={a.busy}>Save rate</Btn></div>
      </form>
    </Card>
    <Card title="Saved rates">
      <Table head={['Currency', 'From', '>Rupees for 1']} empty={!d.rates.length && <Empty>No rates yet. You can also type the rate on each document.</Empty>}>
        {d.rates.map((r) => <tr key={r.currency + r.date}><td>{r.currency}</td><td>{showDate(r.date)}</td><td className="r num">{r.rate.replace(/0+$/, '').replace(/\.$/, '')}</td></tr>)}
      </Table>
    </Card>
    <Revalue />
    <Card title="What is and is not covered">
      <p className="muted">Invoices, bills, quotes and orders can be in a foreign currency. A payment settles one such document at a time and any difference between the rupees booked and the rupees that arrived is posted as an exchange gain or loss. Credit and debit notes are in rupees.  An invoice in a foreign currency is listed in GSTR-1 as an export, and in GSTR-3B as a zero-rated supply.</p>
    </Card>
  </>)}</Async>;
};
