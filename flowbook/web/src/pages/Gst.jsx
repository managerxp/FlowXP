/* GST return drafts and the party statement. The return files are drafts to check; they have not been uploaded to the GST portal. */
import { useState } from 'react';
import { useLoad } from '../api.js';
import { inr, showDate, today } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Card, Empty, Field, Table, Tabs } from '../ui.jsx';

const rupees = (n) => inr(n);
const download = (name, data) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click(); URL.revokeObjectURL(url);
};

const Problems = ({ list }) => (list.length ? (
  <ul className="problems">{list.map((p, i) => <li key={i} className={p.level === 'block' ? 'bad' : 'warn'}><strong>{p.level === 'block' ? 'Fix first: ' : 'Check: '}</strong>{p.message}</li>)}</ul>
) : <p className="notice ok">Nothing the portal is known to reject.</p>);

const Gstr1 = ({ month }) => {
  const { o, org } = useSession();
  const [digits, setDigits] = useState('4');
  const load = useLoad(() => o(`/gst/gstr1?month=${month}&hsnDigits=${digits}`), [org.id, month, digits]);
  return <Async load={load}>{({ file, counts, problems }) => {
    const blocked = problems.some((p) => p.level === 'block');
    const sections = [['Registered buyers (B2B)', counts.b2b], ['Large unregistered, other state (B2CL)', counts.b2cl], ['Exports', counts.exports], ['Small unregistered (B2CS)', counts.b2cs], ['Credit notes', counts.creditNotes], ['Cancelled', counts.cancelled]];
    return (<>
      <Card title="Checks before you file" actions={<Field label="HSN digits"><select value={digits} onChange={(e) => setDigits(e.target.value)}><option value="4">4 (turnover up to ₹5 crore)</option><option value="6">6 (above ₹5 crore)</option></select></Field>}>
        <Problems list={problems} />
        <p className="actions no-print"><button className="btn primary" disabled={blocked || !counts.invoices && !counts.creditNotes} onClick={() => download(`GSTR1_${file.gstin || 'draft'}_${file.fp}.json`, file)}>Download GSTR-1 JSON</button></p>
        <p className="muted">Open it in the GST offline tool or upload it on the portal and let the portal check it. This draft has not been verified there.</p>
      </Card>
      <Card title={`Documents in the month (${counts.invoices} invoices)`}>
        <Table head={['Section', '>Count']}>{sections.map(([k, v]) => <tr key={k}><td>{k}</td><td className="r">{v}</td></tr>)}</Table>
      </Card>
      {file.b2b.length > 0 && <Card title="B2B, by buyer"><Table head={['GSTIN', '>Invoices', '>Taxable', '>Tax']}>
        {file.b2b.map((b) => { const items = b.inv.flatMap((i) => i.itms.map((m) => m.itm_det)); return (
          <tr key={b.ctin}><td>{b.ctin}</td><td className="r">{b.inv.length}</td><td className="r num">{rupees(items.reduce((a, m) => a + m.txval, 0))}</td><td className="r num">{rupees(items.reduce((a, m) => a + m.iamt + m.camt + m.samt, 0))}</td></tr>); })}
      </Table></Card>}
      {file.exp?.length > 0 && <Card title="Exports"><Table head={['Invoice', 'Date', 'Tax', 'Shipping bill', '>Taxable', '>IGST']}>
        {file.exp.flatMap((g) => g.inv.map((i) => <tr key={i.inum}><td>{i.inum}</td><td>{i.idt}</td><td>{g.exp_typ === 'WPAY' ? 'With IGST' : 'Without tax (LUT)'}</td><td>{i.sbnum ? `${i.sbnum} · ${i.sbdt || ''} · ${i.sbpcode || ''}` : <span className="muted">not added</span>}</td><td className="r num">{rupees(i.itms.reduce((a, m) => a + m.txval, 0))}</td><td className="r num">{rupees(i.itms.reduce((a, m) => a + m.iamt, 0))}</td></tr>))}
      </Table></Card>}
      {file.b2cs.length > 0 && <Card title="Small sales to unregistered buyers"><Table head={['Supply', 'State', '>Rate', '>Taxable', '>IGST', '>CGST', '>SGST']}>
        {file.b2cs.map((e) => <tr key={`${e.sply_ty}${e.pos}${e.rt}`}><td>{e.sply_ty === 'INTER' ? 'Other state' : 'Same state'}</td><td>{e.pos}</td><td className="r">{e.rt}%</td><td className="r num">{rupees(e.txval)}</td><td className="r num">{rupees(e.iamt)}</td><td className="r num">{rupees(e.camt)}</td><td className="r num">{rupees(e.samt)}</td></tr>)}
      </Table></Card>}
      <Card title="HSN summary"><Table head={['HSN/SAC', 'Description', 'Unit', '>Qty', '>Rate', '>Taxable', '>Tax']} empty={!file.hsn.data.length && <Empty>No lines with an HSN or SAC yet.</Empty>}>
        {file.hsn.data.map((h) => <tr key={h.num}><td>{h.hsn_sc}</td><td>{h.desc}</td><td>{h.uqc}</td><td className="r">{h.qty}</td><td className="r">{h.rt}%</td><td className="r num">{rupees(h.txval)}</td><td className="r num">{rupees(h.iamt + h.camt + h.samt)}</td></tr>)}
      </Table></Card>
      <Card title="Documents issued"><Table head={['Kind', 'From', 'To', '>Total', '>Cancelled']} empty={!file.doc_issue.doc_det.length && <Empty>None this month.</Empty>}>
        {file.doc_issue.doc_det.flatMap((n) => n.docs.map((d) => <tr key={`${n.doc_num}${d.num}`}><td>{n.doc_num === 1 ? 'Invoices' : 'Credit notes'}</td><td>{d.from}</td><td>{d.to}</td><td className="r">{d.totnum}</td><td className="r">{d.cancel}</td></tr>))}
      </Table></Card>
    </>);
  }}</Async>;
};

const Gstr3b = ({ month }) => {
  const { o, org } = useSession();
  const load = useLoad(() => o(`/gst/gstr3b?month=${month}`), [org.id, month]);
  return <Async load={load}>{({ file, problems }) => {
    const out = file.sup_details.osup_det; const itc = file.itc_elg.itc_avl.find((x) => x.ty === 'OTH');
    const rows = [['Integrated tax (IGST)', out.iamt, itc.iamt], ['Central tax (CGST)', out.camt, itc.camt], ['State tax (SGST)', out.samt, itc.samt]];
    return (<>
      <Card title="Checks before you file"><Problems list={problems} />
        <p className="actions no-print"><button className="btn primary" disabled={problems.some((p) => p.level === 'block')} onClick={() => download(`GSTR3B_${file.gstin || 'draft'}_${file.ret_period}.json`, file)}>Download GSTR-3B JSON</button></p>
      </Card>
      <Card title="Tax on sales, less credit on purchases">
        <Table head={['', '>Tax on sales', '>Credit from bills', '>To pay']}>
          {rows.map(([k, a, b]) => <tr key={k}><td>{k}</td><td className="r num">{rupees(a)}</td><td className="r num">{rupees(b)}</td><td className="r num strong">{rupees(Math.max(0, a - b))}</td></tr>)}
        </Table>
        <p className="muted">Taxable value of sales ₹{rupees(out.txval)}; nil-rated or exempt ₹{rupees(file.sup_details.osup_nil_exmp.txval)}. Credit is set off across heads on the portal (IGST first), so the "to pay" column is only a guide.</p>
      </Card>
    </>);
  }}</Async>;
};

export const GstReturns = () => {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [form, setForm] = useState('1');
  return (<>
    <Card className="no-print"><div className="form">
      <Field label="Month"><input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
    </div></Card>
    <Tabs value={form} onChange={setForm} tabs={[['1', 'GSTR-1 (sales)'], ['3b', 'GSTR-3B (summary)']]} />
    {form === '1' ? <Gstr1 month={month} /> : <Gstr3b month={month} />}
  </>);
};

export const Statement = ({ r }) => {
  const { o, org } = useSession();
  const [party, setParty] = useState('');
  const parties = useLoad(() => o('/parties?limit=500'), [org.id]);
  const load = useLoad(() => (party ? o(`/parties/${party}/statement?from=${r.from}&to=${r.to}`) : Promise.resolve(null)), [org.id, party, r.from, r.to]);
  return (<>
    <Card className="no-print"><div className="form">
      <Field label="Customer or vendor"><select value={party} onChange={(e) => setParty(e.target.value)}><option value="">Choose…</option>{(parties.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    </div></Card>
    {load.data && (
      <Card title={`${load.data.party.name} · ${showDate(r.from)} to ${showDate(r.to)}`}>
        <Table head={['Date', 'What', 'Number', '>Debit', '>Credit', '>Balance']}>
          <tr><td>{showDate(r.from)}</td><td>Opening balance</td><td /><td /><td /><td className="r num">{rupees(load.data.opening)}</td></tr>
          {load.data.lines.map((l, i) => <tr key={i}><td>{showDate(l.date)}</td><td>{l.type}</td><td>{l.number}</td><td className="r num">{Number(l.debit) ? rupees(l.debit) : ''}</td><td className="r num">{Number(l.credit) ? rupees(l.credit) : ''}</td><td className="r num">{rupees(l.balance)}</td></tr>)}
          <tr className="total"><td colSpan={5}>Closing balance</td><td className="r num">{rupees(load.data.closing)}</td></tr>
        </Table>
        <p className="muted">A positive balance means {load.data.party.name} owes you; a negative one means you owe them. Voided documents are not shown.</p>
      </Card>
    )}
    {!party && <Card><Empty>Choose a customer or vendor to see their statement.</Empty></Card>}
  </>);
};
