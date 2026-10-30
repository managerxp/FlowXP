/* Recurring invoices and bills: a template makes a draft each time it falls due. Nothing is issued by itself. */
import { useState } from 'react';
import { Link } from '../router.jsx';
import { useLoad } from '../api.js';
import { addDays, showDate, today } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Badge, Btn, Card, Empty, Err, Field, Note, Page, Table, useAction } from '../ui.jsx';

const EVERY = { WEEK: 'Every week', MONTH: 'Every month', QUARTER: 'Every 3 months', YEAR: 'Every year' };
const blank = () => ({ kind: 'INVOICE', partyId: '', every: 'MONTH', startDate: addDays(today(), 1), endDate: '', memo: '', lines: [{ itemId: '', description: '', quantity: '1', unitPrice: '', taxCode: 'GST18' }] });

export default () => {
  const { o, org } = useSession();
  const [f, setF] = useState(null);
  const a = useAction();
  const load = useLoad(() => o('/recurring'), [org.id]);
  const parties = useLoad(() => o('/parties?limit=500'), [org.id]);
  const items = useLoad(() => o('/items'), [org.id]);
  const rates = useLoad(() => o('/tax-rates'), [org.id]);
  const codes = [...new Set((rates.data || []).map((r) => r.code))];
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setLine = (i, patch) => setF({ ...f, lines: f.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) });
  const pickItem = (i, itemId) => {
    const it = (items.data || []).find((x) => String(x.id) === itemId);
    setLine(i, it ? { itemId, description: '', taxCode: it.tax_code || 'GST18', unitPrice: '' } : { itemId: '' });
  };
  const who = f?.kind === 'BILL' ? ['VENDOR', 'BOTH'] : ['CUSTOMER', 'BOTH'];
  const choices = (parties.data || []).filter((p) => who.includes(p.kind));

  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      const lines = f.lines.map((l) => ({ itemId: l.itemId || undefined, description: l.description || undefined, quantity: String(l.quantity), unitPrice: l.unitPrice ? String(l.unitPrice) : undefined, taxCode: l.taxCode || undefined }));
      await o('/recurring', { method: 'POST', body: { kind: f.kind, partyId: f.partyId, every: f.every, startDate: f.startDate, endDate: f.endDate || undefined, memo: f.memo || undefined, lines } });
      setF(null); await load.reload();
    }, 'Saved. A draft appears on each due date.');
  };
  const runNow = () => a.run(async () => {
    const r = await o('/recurring/run', { method: 'POST', body: {} });
    await load.reload();
    if (r.failed.length) throw new Error(`${r.failed.length} could not be made: ${r.failed[0].reason}`);
    return r;
  }, 'Drafts made for everything that was due. Open the lists to check and issue them.');
  const toggle = (t) => a.run(async () => { await o(`/recurring/${t.id}/active`, { method: 'POST', body: { active: !t.active } }); await load.reload(); });
  const remove = (t) => a.run(async () => { await o(`/recurring/${t.id}`, { method: 'DELETE' }); await load.reload(); });
  const name = (l) => l.description || (items.data || []).find((x) => String(x.id) === String(l.itemId))?.name || 'Line';

  return (
    <Page title="Recurring" lead="Rent, retainers, subscriptions: set it once and a draft is made each time it falls due. You check and issue it."
      actions={<><Btn busy={a.busy} onClick={runNow}>Make due drafts now</Btn><Btn kind="primary" onClick={() => { a.setError(''); a.setDone(''); setF(blank()); }}>New recurring</Btn></>}>
      <Err>{a.error}</Err><Note>{a.done}</Note>
      {f && (
        <Card title="New recurring document">
          <form className="form" onSubmit={save}>
            <Field label="Kind"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, partyId: '' })}><option value="INVOICE">Sales invoice</option><option value="BILL">Purchase bill</option></select></Field>
            <Field label={f.kind === 'BILL' ? 'Vendor' : 'Customer'}><select value={f.partyId} onChange={set('partyId')} required><option value="">Choose…</option>{choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Repeats"><select value={f.every} onChange={set('every')}>{Object.entries(EVERY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="First date"><input type="date" value={f.startDate} onChange={set('startDate')} required /></Field>
            <Field label="Last date" hint="Optional. It stops after this."><input type="date" value={f.endDate} onChange={set('endDate')} /></Field>
            <Field label="Note"><input value={f.memo} onChange={set('memo')} maxLength={500} /></Field>
            <div className="wide lines">
              {f.lines.map((l, i) => (
                <div className="line" key={i}>
                  <Field label="Item"><select value={l.itemId} onChange={(e) => pickItem(i, e.target.value)}><option value="">Not from the list</option>{(items.data || []).map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}</select></Field>
                  <Field label="Description"><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} required={!l.itemId} /></Field>
                  <Field label="Qty"><input inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} required /></Field>
                  <Field label="Price (₹)" hint={l.itemId ? 'Empty uses the item price' : undefined}><input inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} required={!l.itemId} /></Field>
                  <Field label="GST"><select value={l.taxCode} onChange={(e) => setLine(i, { taxCode: e.target.value })}>{codes.length ? codes.map((c) => <option key={c}>{c}</option>) : <option>{l.taxCode}</option>}</select></Field>
                  <Btn type="button" className="btn small danger" disabled={f.lines.length === 1} onClick={() => setF({ ...f, lines: f.lines.filter((_, n) => n !== i) })}>Remove</Btn>
                </div>
              ))}
              <p><Btn type="button" className="btn small" onClick={() => setF({ ...f, lines: [...f.lines, { itemId: '', description: '', quantity: '1', unitPrice: '', taxCode: 'GST18' }] })}>Add line</Btn></p>
            </div>
            <div className="wide actions"><Btn kind="primary" busy={a.busy}>Save</Btn><Btn type="button" onClick={() => setF(null)}>Cancel</Btn></div>
          </form>
        </Card>
      )}
      <Card><Async load={load}>{(rows) => (
        <Table head={['Who', 'What', 'Repeats', 'Next', 'Made', 'Status', '']} empty={!rows.length && <Empty>Nothing recurring yet.</Empty>}>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{t.party_name}<div className="muted">{t.kind === 'BILL' ? 'Bill' : 'Invoice'}</div></td>
              <td>{t.lines.map(name).join(', ')}</td><td>{EVERY[t.every]}</td>
              <td>{t.active ? showDate(t.next_date) : ''}{t.end_date ? <div className="muted">until {showDate(t.end_date)}</div> : null}</td>
              <td>{t.runs}{t.last_document_id ? <> · <Link to={`/${t.kind === 'BILL' ? 'purchases' : 'sales'}/${t.last_document_id}`}>latest</Link></> : null}</td>
              <td><Badge status={t.active ? 'OPEN' : 'DRAFT'}>{t.active ? 'running' : 'paused'}</Badge></td>
              <td className="r"><Btn className="btn small" onClick={() => toggle(t)}>{t.active ? 'Pause' : 'Resume'}</Btn> <Btn className="btn small danger" onClick={() => remove(t)}>Delete</Btn></td>
            </tr>
          ))}
        </Table>
      )}</Async></Card>
    </Page>
  );
};
