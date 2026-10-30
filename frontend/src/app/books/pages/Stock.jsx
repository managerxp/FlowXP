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

const Units = ({ rows }) => {
  const { o, org } = useSession();
  const counted = rows.filter((r) => r.tracking && r.tracking !== 'NONE');
  const [pick, setPick] = useState('');
  const item = counted.find((r) => String(r.id) === pick) || counted[0];
  const load = useLoad(() => (item ? o(item.tracking === 'BATCH' ? `/stock/batches?itemId=${item.id}` : `/stock/serials/${item.id}`) : Promise.resolve([])), [org.id, item?.id]);
  if (!counted.length) return null;
  const soon = (d) => d && d <= new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  return (
    <Card title="Batches and serial numbers">
      <p className="actions"><select value={item.id} onChange={(e) => setPick(e.target.value)}>{counted.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.tracking === 'BATCH' ? 'by batch' : 'by serial'})</option>)}</select></p>
      <Async load={load}>{(list) => (item.tracking === 'BATCH'
        ? <Table head={['Batch', 'Expires', 'Warehouse', '>Quantity']} empty={!list.length && <Empty>No batch in stock.</Empty>}>
          {list.map((b) => <tr key={b.batch + b.warehouse_id}><td>{b.batch}</td><td>{b.expiry ? showDate(b.expiry) : <span className="muted">none</span>}{soon(b.expiry) && <> <Badge status="NEEDS_ATTENTION">{b.expiry < today() ? 'expired' : 'expires soon'}</Badge></>}</td><td>{b.warehouse}</td><td className="r num">{b.quantity}</td></tr>)}
        </Table>
        : <Table head={['Serial number', 'Warehouse', 'In since']} empty={!list.length && <Empty>No unit in stock.</Empty>}>
          {list.map((s) => <tr key={s.serial + s.warehouse_id}><td>{s.serial}</td><td>{s.warehouse}</td><td>{showDate(s.since)}</td></tr>)}
        </Table>)}</Async>
    </Card>
  );
};

const Transfer = ({ items, warehouses, onDone, onClose }) => {
  const { o } = useSession();
  const a = useAction();
  const [f, setF] = useState({ itemId: items[0]?.id || '', from: warehouses[0]?.id || '', to: warehouses[1]?.id || '', quantity: '', date: today(), memo: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (e) => { e.preventDefault(); a.run(async () => { await o('/stock/transfers', { method: 'POST', body: { itemId: String(f.itemId), from: String(f.from), to: String(f.to), quantity: f.quantity, date: f.date, ...(f.memo && { memo: f.memo }) } }); onDone(); onClose(); }, 'Stock moved.'); };
  return (
    <Card title="Move stock between warehouses"><Err>{a.error}</Err>
      <form className="form" onSubmit={save}>
        <Field label="Item"><select value={f.itemId} onChange={set('itemId')}>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
        <Field label="From"><select value={f.from} onChange={set('from')}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="To"><select value={f.to} onChange={set('to')}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Quantity"><input inputMode="decimal" value={f.quantity} onChange={set('quantity')} required /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} required /></Field>
        <Field label="Note"><input value={f.memo} onChange={set('memo')} maxLength={200} /></Field>
        <div className="wide actions"><Btn kind="primary" busy={a.busy}>Move</Btn><Btn type="button" onClick={onClose}>Cancel</Btn></div>
      </form>
    </Card>
  );
};

const Warehouses = ({ rows, onDone }) => {
  const { o } = useSession();
  const a = useAction();
  const [name, setName] = useState('');
  const patch = (w, body) => a.run(async () => { await o(`/warehouses/${w.id}`, { method: 'PATCH', body }); await onDone(); });
  return (
    <Card title="Warehouses"><Err>{a.error}</Err>
      <Table head={['Warehouse', '>Units held', '']}>
        {rows.map((w) => <tr key={w.id} className={w.active ? '' : 'muted'}><td>{w.name}{w.is_default && <> <Badge status="ISSUED">default</Badge></>}{!w.active && <> <Badge status="VOID">off</Badge></>}</td><td className="r num">{w.quantity}</td>
          <td>{w.active && !w.is_default && <button className="linkish" onClick={() => patch(w, { makeDefault: true })}>Make default</button>}{' '}
            {w.active && !w.is_default && <button className="linkish" onClick={() => patch(w, { active: false })}>Switch off</button>}{!w.active && <button className="linkish" onClick={() => patch(w, { active: true })}>Switch on</button>}</td></tr>)}
      </Table>
      <form className="form" style={{ marginTop: '1rem' }} onSubmit={(e) => { e.preventDefault(); a.run(async () => { await o('/warehouses', { method: 'POST', body: { name } }); setName(''); await onDone(); }, 'Warehouse added.'); }}>
        <Field label="New warehouse"><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></Field>
        <div className="wide actions"><Btn busy={a.busy}>Add</Btn></div>
      </form>
    </Card>
  );
};

const Adjust = ({ items, accounts, warehouses, onDone, onClose }) => {
  const { o, org, on } = useSession();
  const projects = useLoad(() => (on('flowbook_projects') ? o('/projects?status=ACTIVE') : Promise.resolve([])), [org.id]);
  const a = useAction();
  const [f, setF] = useState({ itemId: items[0]?.id || '', direction: 'IN', quantity: '', unitCost: '', counterAccount: 'OPENING_BALANCE', date: today(), reason: 'Opening stock', warehouseId: '', projectId: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const dir = (e) => setF({ ...f, direction: e.target.value, counterAccount: e.target.value === 'IN' ? 'OPENING_BALANCE' : 'COGS', reason: e.target.value === 'IN' ? 'Opening stock' : 'Damaged or lost', projectId: '' });
  const save = (e) => { e.preventDefault(); a.run(async () => { await o('/stock/adjustments', { method: 'POST', body: { itemId: String(f.itemId), date: f.date, direction: f.direction, quantity: f.quantity, counterAccount: f.counterAccount, reason: f.reason, ...(f.warehouseId && { warehouseId: f.warehouseId }), ...(f.direction === 'OUT' && f.projectId && { projectId: f.projectId }), ...(f.direction === 'IN' && { unitCost: f.unitCost }) } }); onDone(); onClose(); }, 'Stock adjusted.'); };
  return (
    <Card title="Adjust stock"><Err>{a.error}</Err>
      <form className="form" onSubmit={save}>
        <Field label="Item"><select value={f.itemId} onChange={set('itemId')}>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
        {warehouses.length > 1 && <Field label="Warehouse"><select value={f.warehouseId} onChange={set('warehouseId')}><option value="">Default</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>}
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} required /></Field>
        <Field label="What happened"><select value={f.direction} onChange={dir}><option value="IN">Add stock (opening stock, found)</option><option value="OUT">Remove stock (used on a job, damaged, lost)</option></select></Field>
        <Field label="Quantity"><input inputMode="decimal" value={f.quantity} onChange={set('quantity')} required /></Field>
        {f.direction === 'IN' && <Field label="Cost of each (₹)"><input inputMode="decimal" value={f.unitCost} onChange={set('unitCost')} required /></Field>}
        {f.direction === 'OUT' && !!projects.data?.length && <Field label="Used on project" hint="Optional: the cost counts towards that project"><select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value, ...(e.target.value && { counterAccount: 'COGS', reason: 'Used on project' }) })}><option value="">None</option>{projects.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
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
  const [wh, setWh] = useState('');
  const load = useLoad(() => o(`/stock${wh ? `?warehouseId=${wh}` : ''}`), [org.id, wh]);
  const whs = useLoad(() => o('/warehouses'), [org.id]);
  const warehouses = (whs.data || []).filter((w) => w.active);
  const [moving, setMoving] = useState(false);
  const accounts = useLoad(() => o('/accounts'), [org.id]);
  const [adjust, setAdjust] = useState(false);
  const [view, setView] = useState(null);
  return (
    <Page title="Stock" lead="Goods you count. Buying adds to it, selling takes from it, at the average cost." actions={<>{warehouses.length > 1 && <Btn onClick={() => setMoving(true)}>Move stock</Btn>}<Btn kind="primary" onClick={() => setAdjust(true)}>Adjust stock</Btn></>}>
      <Async load={load}>{(rows) => (<>
        {moving && rows.length > 0 && <Transfer items={rows} warehouses={warehouses} onDone={() => { load.reload(); whs.reload(); }} onClose={() => setMoving(false)} />}
        {adjust && rows.length > 0 && <Adjust items={rows} accounts={accounts.data} warehouses={warehouses} onDone={load.reload} onClose={() => setAdjust(false)} />}
        {view && <History item={view} onClose={() => setView(null)} />}
        {warehouses.length > 1 && <p className="actions"><label className="muted">Showing </label><select value={wh} onChange={(e) => setWh(e.target.value)}><option value="">All warehouses</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></p>}
        <Card>
          <Table head={['Item', '>On hand', '>Average cost', '>Value', '']} empty={!rows.length && <Empty>No item is counted yet. Open Items, add a goods item and tick "Count its stock".</Empty>}>
            {rows.map((r) => <tr key={r.id}><td>{r.name} <span className="muted">{r.sku}</span></td><td className="r num">{r.quantity}{r.low && <> <Badge status="NEEDS_ATTENTION">low</Badge></>}</td>
              <td className="r">{Number(r.quantity) > 0 ? <Money v={String(Number(r.value_minor) / Number(r.quantity))} /> : '–'}</td><td className="r"><Money v={r.value_minor} /></td>
              <td><button className="linkish" onClick={() => setView(r)}>History</button></td></tr>)}
          </Table>
        </Card>
        <Units rows={rows} />
        {whs.data && <Warehouses rows={whs.data} onDone={() => { whs.reload(); load.reload(); }} />}
        {rows.length > 0 && !wh && <Note>{`Stock is worth ₹${inr(rows.reduce((a, r) => a + Number(r.value_minor), 0))} in total, the same as Inventory in your books.`}</Note>}
      </>)}</Async>
    </Page>
  );
};
