/* Currencies: the exchange rates a business uses when it writes an invoice or bill in a foreign currency. */
import { useState } from 'react';
import { useLoad } from '../api.js';
import { showDate, today } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Btn, Card, Empty, Err, Field, Note, Table, useAction } from '../ui.jsx';

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
    <Card title="What is and is not covered">
      <p className="muted">Invoices, bills, quotes and orders can be in a foreign currency. A payment settles one such document at a time and any difference between the rupees booked and the rupees that arrived is posted as an exchange gain or loss. Credit and debit notes are in rupees. Open foreign balances are not revalued at period end, and GSTR-1 does not yet have a separate export table.</p>
    </Card>
  </>)}</Async>;
};
