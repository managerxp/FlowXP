/* Stock: what is on hand for the goods you count, its value, a low-stock flag, adjustments, and the history of each item. */
import { useState } from 'react';
import { useLoad } from '../api.js';
import { inr, showDate, today } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Badge, Btn, Card, Empty, Err, Field, Money, Note, Page, Table, useAction } from '../ui.jsx';

const SOURCE = { BILL: 'Bought', INVOICE: 'Sold', CREDIT_NOTE: 'Sale returned', DEBIT_NOTE: 'Returned to vendor', ADJUSTMENT: 'Adjusted', VOID: 'Cancelled' };

const History = ({ item, onClose }) => {
  const { o } = useSession();
  const load = useLoad(() => o(`/stock/items/${item.id}`), [item.id]);
  return (
    <Card title={`History of ${item.name}`}>
      <Async load={load}>{(rows) => (
        <Table head={['Date', 'What', '>Quantity', '>Value', 'Note']} empty={!rows.length && <Empty>No movement yet.</Empty>}>
          {rows.map((m) => <tr key={m.id}><td>{showDate(m.date)}</td><td>{SOURCE[m.source_type]}</td><td className="r num">{Number(m.quantity) > 0 ? '+' : ''}{m.quantity}</td><td className="r num">{Number(m.value_minor) < 0 ? '−' : ''}₹{inr(Math.abs(Number(m.value_minor)))}</td><td>{m.memo}</td></tr>)}
        </Table>
      )}</Async>
      <p className="actions"><Btn onClick={onClose}>Close</Btn></p>
    </Card>
  );
};

const Adjust = ({ items, accounts, onDone, onClose }) => {
  const { o } = useSession();
  const a = useAction();
  const [f, setF] = useState({ itemId: items[0]?.id || '', direction: 'IN', quantity: '', unitCost: '', counterAccount: 'OPENING_BALANCE', date: today(), reason: 'Opening stock' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const dir = (e) => setF({ ...f, direction: e.target.value, counterAccount: e.target.value === 'IN' ? 'OPENING_BALANCE' : 'COGS', reason: e.target.value === 'IN' ? 'Opening stock' : 'Damaged or lost' });
  const save = (e) => { e.preventDefault(); a.run(async () => { await o('/stock/adjustments', { method: 'POST', body: { itemId: String(f.itemId), date: f.date, direction: f.direction, quantity: f.quantity, counterAccount: f.counterAccount, reason: f.reason, ...(f.direction === 'IN' && { unitCost: f.unitCost }) } }); onDone(); onClose(); }, 'Stock adjusted.'); };
  return (
    <Card title="Adjust stock"><Err>{a.error}</Err>
      <form className="form" onSubmit={save}>
        <Field label="Item"><select value={f.itemId} onChange={set('itemId')}>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} required /></Field>
        <Field label="What happened"><select value={f.direction} onChange={dir}><option value="IN">Add stock (opening stock, found)</option><option value="OUT">Remove stock (damaged, lost, used)</option></select></Field>
        <Field label="Quantity"><input inputMode="decimal" value={f.quantity} onChange={set('quantity')} required /></Field>
        {f.direction === 'IN' && <Field label="Cost of each (₹)"><input inputMode="decimal" value={f.unitCost} onChange={set('unitCost')} required /></Field>}
        <Field label="Other side in the books" hint={f.direction === 'IN' ? 'Opening stock goes against opening balance' : 'A write-off is a cost'}>
          <select value={f.counterAccount} onChange={set('counterAccount')}>
            {f.direction === 'IN' && <option value="OPENING_BALANCE">Opening balance equity</option>}
            {(accounts || []).filter((x) => x.active !== false && x.system_key !== 'INVENTORY').map((x) => <option key={x.id} value={x.code}>{x.code} · {x.name}</option>)}
          </select>
        </Field>
        <Field label="Reason" wide><input value={f.reason} onChange={set('reason')} required maxLength={200} /></Field>
        <div className="wide actions"><Btn kind="primary" busy={a.busy}>Save</Btn><Btn type="button" onClick={onClose}>Cancel</Btn></div>
      </form>
    </Card>
  );
};

export default () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/stock'), [org.id]);
  const accounts = useLoad(() => o('/accounts'), [org.id]);
  const [adjust, setAdjust] = useState(false);
  const [view, setView] = useState(null);
  return (
    <Page title="Stock" lead="Goods you count. Buying adds to it, selling takes from it, at the average cost." actions={<Btn kind="primary" onClick={() => setAdjust(true)}>Adjust stock</Btn>}>
      <Async load={load}>{(rows) => (<>
        {adjust && rows.length > 0 && <Adjust items={rows} accounts={accounts.data} onDone={load.reload} onClose={() => setAdjust(false)} />}
        {view && <History item={view} onClose={() => setView(null)} />}
        <Card>
          <Table head={['Item', '>On hand', '>Average cost', '>Value', '']} empty={!rows.length && <Empty>No item is counted yet. Open Items, add a goods item and tick "Count its stock".</Empty>}>
            {rows.map((r) => <tr key={r.id}><td>{r.name} <span className="muted">{r.sku}</span></td><td className="r num">{r.quantity}{r.low && <> <Badge status="NEEDS_ATTENTION">low</Badge></>}</td>
              <td className="r">{Number(r.quantity) > 0 ? <Money v={String(Number(r.value_minor) / Number(r.quantity))} /> : '–'}</td><td className="r"><Money v={r.value_minor} /></td>
              <td><button className="linkish" onClick={() => setView(r)}>History</button></td></tr>)}
          </Table>
        </Card>
        {rows.length > 0 && <Note>{`Stock is worth ₹${inr(rows.reduce((a, r) => a + Number(r.value_minor), 0))} in total, the same as Inventory in your books.`}</Note>}
      </>)}</Async>
    </Page>
  );
};
