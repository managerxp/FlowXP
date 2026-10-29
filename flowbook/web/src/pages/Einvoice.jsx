/* E-invoicing. FlowBook makes the file the IRP reads; you upload it there (or through your GSP) and enter the IRN it answers with. Not checked on the portal. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoad } from '../api.js';
import { inr, showDate, today } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Badge, Btn, Card, Confirm, Empty, Err, Field, Note, Table, useAction } from '../ui.jsx';

const save = (name, json) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click(); URL.revokeObjectURL(url);
};
const PATH = { INVOICE: 'sales', CREDIT_NOTE: 'credit-notes' };
const REASONS = [['1', 'Duplicate'], ['2', 'Data entry mistake'], ['3', 'Order cancelled'], ['4', 'Other']];

/** The IRN form and the cancel form for one document. */
const Answer = ({ id, einvoice, onDone }) => {
  const { o } = useSession();
  const [f, setF] = useState({ irn: '', ackNo: '', ackDate: '', signedQr: '' });
  const [c, setC] = useState({ reason: '2', remark: '' });
  const a = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (einvoice?.status === 'GENERATED') {
    return (<>
      <p>Registered. IRN <code>{einvoice.irn}</code>, acknowledgement {einvoice.ack_no} on {new Date(einvoice.ack_date).toLocaleString()}.</p>
      <Err>{a.error}</Err>
      <form className="form" onSubmit={(e) => { e.preventDefault(); a.run(async () => { await o(`/einvoice/${id}/cancel`, { method: 'POST', body: { reason: Number(c.reason), remark: c.remark } }); onDone(); }); }}>
        <Field label="Cancelled on the IRP because"><select value={c.reason} onChange={(e) => setC({ ...c, reason: e.target.value })}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Remark"><input value={c.remark} onChange={(e) => setC({ ...c, remark: e.target.value })} maxLength={100} /></Field>
        <div className="wide"><Btn kind="danger" busy={a.busy}>Record the cancellation</Btn> <span className="muted">Cancel it on the IRP first (allowed within 24 hours). This only records it here.</span></div>
      </form>
    </>);
  }
  return (<>
    {einvoice?.status === 'CANCELLED' && <p className="muted">An earlier IRN was cancelled on {new Date(einvoice.cancelled_at).toLocaleString()}.</p>}
    <Err>{a.error}</Err>
    <form className="form" onSubmit={(e) => { e.preventDefault(); a.run(async () => { await o(`/einvoice/${id}/irn`, { method: 'POST', body: { irn: f.irn, ackNo: f.ackNo, ackDate: new Date(f.ackDate).toISOString(), ...(f.signedQr && { signedQr: f.signedQr }) } }); onDone(); }); }}>
      <Field label="IRN" hint="64 letters and digits from the IRP acknowledgement" wide><input value={f.irn} onChange={set('irn')} required maxLength={64} /></Field>
      <Field label="Acknowledgement number"><input value={f.ackNo} onChange={set('ackNo')} required maxLength={30} /></Field>
      <Field label="Acknowledgement date and time"><input type="datetime-local" value={f.ackDate} onChange={set('ackDate')} required /></Field>
      <Field label="Signed QR code text" hint="Optional" wide><input value={f.signedQr} onChange={set('signedQr')} /></Field>
      <div className="wide"><Btn kind="primary" busy={a.busy}>Save the IRN</Btn></div>
    </form>
  </>);
};

/** On an invoice or credit note: download the IRP file, then record the answer. */
export const EinvoicePanel = ({ id, number, einvoice, onClose, onDone }) => {
  const { o, org } = useSession();
  const load = useLoad(() => o(`/einvoice/${id}/file`), [org.id, id, einvoice?.status]);
  return (
    <Confirm>
      <p>E-invoice for {number}. FlowBook makes the file; you upload it on the IRP (e-invoice portal or your GSP), then enter the IRN it gives back. The file has not been checked on the portal.</p>
      <Async load={load}>{(b) => (<>
        {b.problems.map((p) => <p key={p} className="notice warn">{p}</p>)}
        {b.warnings.map((p) => <p key={p} className="notice warn">{p}</p>)}
        {b.file && !b.problems.length && !einvoice?.status && <p><Btn kind="primary" onClick={() => save(`einvoice_${number}.json`, b.file)}>Download file</Btn></p>}
        {(b.file || einvoice) && <Answer id={id} einvoice={einvoice} onDone={onDone} />}
      </>)}</Async>
      <p><Btn type="button" onClick={onClose}>Close</Btn></p>
    </Confirm>
  );
};

/** GST returns > E-invoices: what is registered, what is ready, what needs fixing; one file for all that is ready. */
export const Einvoices = ({ month }) => {
  const { o, org } = useSession();
  const [from, to] = [`${month}-01`, `${month}-31`];
  const load = useLoad(() => o(`/einvoice?from=${from}&to=${to}`), [org.id, month]);
  const a = useAction();
  return (
    <Async load={load}>{(rows) => {
      const n = (s) => rows.filter((r) => r.state === s).length;
      return (<>
        <Card title="E-invoices this month" actions={<Btn kind="primary" busy={a.busy} onClick={() => a.run(async () => { const r = await o(`/einvoice/bulk?from=${from}&to=${to}`); if (!r.count) throw new Error('Nothing is ready to send this month.'); save(`einvoices_${month}.json`, r.file); }, 'File downloaded. Upload it on the IRP under bulk generation, then enter each IRN on its invoice.')}>Download file for all ready</Btn>}>
          <Err>{a.error}</Err><Note>{a.done}</Note>
          <p className="muted">{n('REGISTERED')} registered, {n('READY')} ready to send, {n('NEEDS_FIXING')} need fixing, {n('NOT_REQUIRED')} not required (no customer GSTIN). Whether e-invoicing is compulsory for you depends on your turnover; ask your accountant.</p>
          <Table head={['Number', 'Date', 'Customer', '>Total', 'Status', '']} empty={!rows.length && <Empty>No invoices or credit notes this month.</Empty>}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/${PATH[r.kind]}/${r.id}`}>{r.number}</Link></td><td>{showDate(r.date)}</td><td>{r.party}</td><td className="r">₹{inr(r.total_minor)}</td>
                <td><Badge status={r.state === 'NEEDS_FIXING' ? 'overdue' : r.state === 'REGISTERED' ? 'paid' : 'draft'}>{r.state.replaceAll('_', ' ').toLowerCase()}</Badge></td>
                <td className="muted">{r.problems[0] ?? (r.irn ? `${r.irn.slice(0, 12)}…` : '')}{r.problems.length > 1 ? ` (+${r.problems.length - 1})` : ''}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </>);
    }}</Async>
  );
};
