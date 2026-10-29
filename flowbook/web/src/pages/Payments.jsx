import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLoad } from '../api.js';
import { TDS_SECTIONS, inr, showDate, today, uuid } from '../lib.js';
import { useSession } from '../session.jsx';
import { WhatsappButton } from './Whatsapp.jsx';
import { Async, Badge, Btn, Card, Confirm, Empty, Err, Field, Money, Note, Page, Table, Tabs, useAction } from '../ui.jsx';

export const Payments = () => {
  const { o, org } = useSession();
  const nav = useNavigate();
  const [dir, setDir] = useState('');
  const load = useLoad(() => o(`/payments?limit=100${dir ? `&direction=${dir}` : ''}`), [org.id, dir]);
  return (
    <Page title="Payments" lead="Money received from customers and paid to vendors." actions={<><Link className="btn primary" to="/payments/new?direction=IN">Money received</Link><Link className="btn" to="/payments/new?direction=OUT">Money paid</Link></>}>
      <Tabs value={dir} onChange={setDir} tabs={[['', 'All'], ['IN', 'Received'], ['OUT', 'Paid']]} />
      <Async load={load}>{(d) => (
        <Card>
          <Table head={['Number', 'Party', 'Date', 'Mode', '>Amount', '>Not yet matched', 'Status']} empty={!d.payments.length && <Empty>No payments yet.</Empty>}>
            {d.payments.map((p) => (
              <tr key={p.id} className="click" onClick={() => nav(`/payments/${p.id}`)}>
                <td><Link to={`/payments/${p.id}`}>{p.number}</Link> <span className="muted">{p.direction === 'IN' ? 'in' : 'out'}</span></td><td>{p.party_name}</td><td>{showDate(p.pay_date)}</td><td>{p.mode}</td>
                <td className="r"><Money v={p.amount_minor} /></td><td className="r">{Number(p.unallocated_minor) ? <Money v={p.unallocated_minor} /> : ''}</td><td><Badge status={p.status} /></td>
              </tr>
            ))}
          </Table>
          {d.next && <p className="muted">Showing the latest 100.</p>}
        </Card>
      )}</Async>
    </Page>
  );
};

export const PaymentForm = () => {
  const { o, org } = useSession();
  const [q] = useSearchParams();
  const nav = useNavigate();
  const a = useAction();
  const [key] = useState(uuid);   // one key per form, so a double click or a retry cannot record the payment twice
  const [f, setF] = useState({ direction: q.get('direction') === 'OUT' ? 'OUT' : 'IN', partyId: q.get('partyId') || '', date: today(), mode: 'BANK', amount: '', reference: '', tds: '', tdsSection: '' });
  const [alloc, setAlloc] = useState({});
  const [fxd, setFxd] = useState({ docId: '', foreign: '' });   // settling one foreign-currency document
  const parties = useLoad(() => o('/parties?limit=500'), [org.id]);
  const docKind = f.direction === 'IN' ? 'invoices' : 'bills';
  const docs = useLoad(() => (f.partyId ? o(`/${docKind}?status=ISSUED&partyId=${f.partyId}&limit=200`) : Promise.resolve(null)), [org.id, f.partyId, docKind]);
  const allOpen = useMemo(() => (docs.data?.documents || []).filter((d) => Number(d.balance_minor) > 0).reverse(), [docs.data]);   // oldest first
  const openDocs = useMemo(() => allOpen.filter((d) => !d.currency || d.currency === 'INR'), [allOpen]);
  const foreignDocs = useMemo(() => allOpen.filter((d) => d.currency && d.currency !== 'INR'), [allOpen]);
  const fxDoc = foreignDocs.find((d) => String(d.id) === fxd.docId);
  const fxShare = fxDoc && Number(fxd.foreign) > 0 ? (Number(fxd.foreign) >= Number(fxDoc.foreign_balance_minor) ? Number(fxDoc.balance_minor) : Math.round(Number(fxDoc.balance_minor) * 100 * Number(fxd.foreign) / Number(fxDoc.foreign_balance_minor)) / 100) : 0;
  const fxDiff = fxShare ? (f.direction === 'IN' ? Number(f.amount || 0) - fxShare : fxShare - Number(f.amount || 0)) : 0;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {   // arriving from a document: pre-fill its balance
    const docId = q.get('documentId');
    const d = openDocs.find((x) => String(x.id) === docId);
    if (d && !f.amount) { setF((x) => ({ ...x, amount: d.balance_minor })); setAlloc({ [d.id]: d.balance_minor }); }
    const fd = foreignDocs.find((x) => String(x.id) === docId);
    if (fd && !fxd.docId) setFxd({ docId: String(fd.id), foreign: fd.foreign_balance_minor });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDocs, foreignDocs]);

  const allocated = Object.values(alloc).reduce((s, v) => s + Math.round(Number(v || 0) * 100), 0);
  const total = Math.round((Number(f.amount || 0) + Number(f.tds || 0)) * 100);   // cash plus the tax deducted settles the documents
  const autoFill = () => {
    let left = total; const next = {};
    for (const d of openDocs) { if (left <= 0) break; const take = Math.min(left, Math.round(Number(d.balance_minor) * 100)); next[d.id] = (take / 100).toFixed(2); left -= take; }
    setAlloc(next);
  };
  const submit = (e) => {
    e.preventDefault();
    a.run(async () => {
      if (fxd.docId) {
        const out = await o('/payments', { method: 'POST', headers: { 'idempotency-key': key }, body: { direction: f.direction, partyId: f.partyId, date: f.date, mode: f.mode, amount: f.amount, reference: f.reference || undefined, fx: { documentId: fxd.docId, foreignAmount: String(fxd.foreign) } } });
        nav(`/payments/${out.id}`);
        return;
      }
      const allocations = Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([documentId, amount]) => ({ documentId, amount: String(amount) }));
      const out = await o('/payments', { method: 'POST', headers: { 'idempotency-key': key }, body: { ...f, tds: Number(f.tds) > 0 ? f.tds : undefined, tdsSection: Number(f.tds) > 0 && f.tdsSection ? f.tdsSection : undefined, reference: f.reference || undefined, allocations: allocations.length ? allocations : undefined } });
      nav(`/payments/${out.id}`);
    });
  };
  const list = (parties.data || []).filter((p) => (f.direction === 'IN' ? p.kind !== 'VENDOR' : p.kind !== 'CUSTOMER'));

  return (
    <Page title={f.direction === 'IN' ? 'Money received' : 'Money paid'} lead="Match it to the invoices or bills it settles. Anything left over stays on account for the party.">
      <Err>{a.error}</Err>
      <form onSubmit={submit}>
        <Card><div className="form">
          <Field label="Type"><select value={f.direction} onChange={(e) => { setF({ ...f, direction: e.target.value, partyId: '' }); setAlloc({}); }}><option value="IN">Received from a customer</option><option value="OUT">Paid to a vendor</option></select></Field>
          <Field label={f.direction === 'IN' ? 'Customer' : 'Vendor'}><select value={f.partyId} onChange={(e) => { setF({ ...f, partyId: e.target.value }); setAlloc({}); }} required><option value="">Choose…</option>{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Date"><input type="date" value={f.date} onChange={set('date')} required /></Field>
          <Field label="How"><select value={f.mode} onChange={set('mode')}><option value="BANK">Bank transfer</option><option value="UPI">UPI</option><option value="CASH">Cash</option><option value="CARD">Card</option></select></Field>
          <Field label={fxd.docId ? 'Rupees that actually moved (₹)' : 'Amount (₹)'}><input inputMode="decimal" value={f.amount} onChange={set('amount')} required /></Field>
          <Field label={f.direction === 'IN' ? 'TDS the customer deducted (₹)' : 'TDS you deducted (₹)'} hint="Optional. The amount above is what actually moved; this is tax held back"><input inputMode="decimal" value={f.tds} onChange={set('tds')} /></Field>
          {Number(f.tds) > 0 && !fxd.docId && <Field label="TDS section"><select value={f.tdsSection} onChange={set('tdsSection')}><option value="">Not stated</option>{TDS_SECTIONS.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select></Field>}
          <Field label="Reference" hint="Cheque, UTR or note (optional)"><input value={f.reference} onChange={set('reference')} maxLength={80} /></Field>
        </div></Card>

        {f.partyId && foreignDocs.length > 0 && (
          <Card title="Or settle a foreign-currency document">
            <div className="form">
              <Field label="Document"><select value={fxd.docId} onChange={(e) => { const d = foreignDocs.find((x) => String(x.id) === e.target.value); setFxd({ docId: e.target.value, foreign: d ? d.foreign_balance_minor : '' }); setAlloc({}); }}>
                <option value="">None, use the list below</option>{foreignDocs.map((d) => <option key={d.id} value={d.id}>{d.number} · {d.currency} {inr(d.foreign_balance_minor)} open</option>)}</select></Field>
              {fxDoc && <Field label={`Part of it you are settling (${fxDoc.currency})`}><input inputMode="decimal" value={fxd.foreign} onChange={(e) => setFxd({ ...fxd, foreign: e.target.value })} required /></Field>}
            </div>
            {fxDoc && fxShare > 0 && <p className={fxDiff < 0 ? 'notice warn' : 'muted'}>That part is in your books at ₹{inr(fxShare)}. {Number(f.amount) > 0 ? (fxDiff === 0 ? 'No exchange difference.' : `Exchange ${fxDiff > 0 ? 'gain' : 'loss'}: ₹${inr(Math.abs(fxDiff))}, posted to Exchange gain or loss.`) : 'Type the rupees that moved above to see the exchange gain or loss.'}</p>}
          </Card>
        )}

        {f.partyId && !fxd.docId && (
          <Card title={f.direction === 'IN' ? 'Settle these invoices' : 'Settle these bills'} actions={<Btn type="button" className="btn small" onClick={autoFill} disabled={!total}>Fill oldest first</Btn>}>
            {docs.loading ? <p className="muted">Loading…</p> : !openDocs.length ? <Empty>Nothing is open for this party. The money will stay on account.</Empty> : (
              <Table head={['Number', 'Date', '>Open', '>Settle now']}>
                {openDocs.map((d) => (<tr key={d.id}><td>{d.number}</td><td>{showDate(d.issue_date)}</td><td className="r"><Money v={d.balance_minor} /></td>
                  <td className="r"><input aria-label={`Amount for ${d.number}`} style={{ maxWidth: '8rem' }} inputMode="decimal" value={alloc[d.id] || ''} onChange={(e) => setAlloc({ ...alloc, [d.id]: e.target.value })} /></td></tr>))}
              </Table>
            )}
            <p className={allocated > total ? 'notice bad' : 'muted'}>Matched ₹{inr(allocated / 100)} of ₹{inr(total / 100)}{Number(f.tds) > 0 ? ' (with TDS)' : ''}{allocated > total ? ' — more than the payment' : allocated < total ? ` · ₹${inr((total - allocated) / 100)} stays on account` : ''}</p>
          </Card>
        )}
        <div className="actions"><Btn kind="primary" busy={a.busy} disabled={!fxd.docId && allocated > total}>Record payment</Btn><Btn type="button" onClick={() => nav(-1)}>Cancel</Btn></div>
      </form>
    </Page>
  );
};

import { ReceiptSheet } from './Print.jsx';
import { EmailForm, EmailLog, useEmailOn } from './Email.jsx';

export const PaymentView = () => {
  const { id } = useParams();
  const { o, org } = useSession();
  const load = useLoad(() => o(`/payments/${id}`), [org.id, id]);
  const a = useAction();
  const [panel, setPanel] = useState(false);
  const [mail, setMail] = useState(false);
  const [sent, setSent] = useState(0);
  const emailOn = useEmailOn();
  const [v, setV] = useState({ date: today(), reason: '' });
  return (
    <Page title={load.data ? `Payment ${load.data.number}` : 'Payment'} lead={load.data && `${load.data.direction === 'IN' ? 'Received from' : 'Paid to'} ${load.data.party_name}`}
      actions={load.data?.status === 'POSTED' && <>{load.data.direction === 'IN' && <WhatsappButton kind="RECEIPT" paymentId={id} label="Send receipt on WhatsApp" />}{emailOn && load.data.direction === 'IN' && <Btn onClick={() => setMail(!mail)}>Send email</Btn>}<Btn onClick={() => window.print()}>Print receipt</Btn><Btn kind="danger" onClick={() => setPanel(!panel)}>Void</Btn></>}>
      <Async load={load}>{(p) => (<>
        <Err>{a.error}</Err><Note>{a.done}</Note>
        {mail && <EmailForm paymentId={id} onDone={() => setSent((n) => n + 1)} onClose={() => setMail(false)} />}
        {p.status === 'POSTED' && <ReceiptSheet pay={p} />}
        {panel && (<Confirm><p>Voiding reverses the entries and frees the invoices or bills it settled.</p>
          <div className="form"><Field label="Date of reversal"><input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field><Field label="Reason"><input value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field></div>
          <p><Btn kind="danger" busy={a.busy} disabled={!v.reason} onClick={() => a.run(async () => { await o(`/payments/${id}/void`, { method: 'POST', body: v }); await load.reload(); setPanel(false); }, 'Payment voided.')}>Void payment</Btn></p></Confirm>)}
        <Card>
          <Badge status={p.status} />
          <dl className="kv" style={{ marginTop: '.75rem' }}><dt>Date</dt><dd>{showDate(p.pay_date)}</dd><dt>How</dt><dd>{p.mode}</dd>{p.reference && <><dt>Reference</dt><dd>{p.reference}</dd></>}
            <dt>Amount</dt><dd><Money v={p.amount_minor} strong /></dd>{Number(p.tds_minor) > 0 && <><dt>TDS deducted</dt><dd><Money v={p.tds_minor} />{p.tds_section ? ` · ${p.tds_section}` : ''}</dd></>}<dt>Not yet matched</dt><dd><Money v={p.unallocated_minor} /></dd>
            {p.journal_entry_id && <><dt>Books</dt><dd><Link to={`/journals/${p.journal_entry_id}`}>See the entry</Link></dd></>}</dl>
        </Card>
        <EmailLog paymentId={id} refresh={sent} />
        {p.allocations.length > 0 && <Card title="Settles"><Table head={['Document', '>Amount', 'State']}>{p.allocations.map((x, i) => (<tr key={i}><td>#{x.document_id}</td><td className="r"><Money v={x.amount_minor} /></td><td>{x.voided ? <Badge status="VOID" /> : 'Counted'}</td></tr>))}</Table></Card>}
      </>)}</Async>
    </Page>
  );
};
