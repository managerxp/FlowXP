/*
 * FlowXP's own invoices and quotations to its clients. One page for both (`kind`): a list, a builder, and the printable
 * document. A quotation can become an invoice in one step; an invoice is marked paid by hand when the money arrives.
 * Tax is worked out on the server (modules/adminDocs.js); the totals shown while typing are only a preview of the same sums.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../lib/adminApi.js';
import { PageHeader, Card, Field, Input, Select, Button, Alert, Badge, Table, Thead, Th, Td, Tr, ListState, useToast } from '../components/ui.jsx';

const rs = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const TONE = { DRAFT: 'neutral', SENT: 'info', PAID: 'success', ACCEPTED: 'success', DECLINED: 'danger', CONVERTED: 'success', CANCELLED: 'danger' };
const emptyLine = () => ({ description: '', hsn: '', qty: '1', rate_rupees: '', gst_rate: '18' });
const emptyClient = { name: '', gstin: '', address: '', state: '', email: '', phone: '' };

/* The same sums the server does, for the preview while typing. */
const preview = (lines, intra) => {
  let taxable = 0; let tax = 0;
  for (const l of lines) { const base = Math.round((Number(l.qty) || 0) * (Number(l.rate_rupees) || 0) * 100); taxable += base; tax += Math.round((base * Number(l.gst_rate)) / 100); }
  const gross = taxable + tax; const total = Math.round(gross / 100) * 100;
  return { taxable, tax, total, intra };
};
const sameState = (a, b) => { const n = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); return !n(a) || !n(b) || n(a) === n(b); };

/* ── FlowXP's own details, printed on every document ─────────────────────── */
const CompanyDetails = () => {
  const toast = useToast();
  const [c, setC] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { adminApi('/company').then(setC).catch((e) => setError(e.message)); }, []);
  if (!c) return <Alert>{error}</Alert>;
  const set = (k) => (e) => setC({ ...c, [k]: e.target.value });
  const save = async () => { setError(''); try { setC(await adminApi('/company', { method: 'PUT', body: c })); toast.success('Saved'); } catch (e) { setError(e.message); } };
  return (
    <details className="rounded-(--radius-card) border border-line bg-surface p-4" open={!c.name}>
      <summary className="cursor-pointer text-sm font-semibold text-ink-900">Your company details {c.name ? '' : '(fill these first: they print on every document)'}</summary>
      <Alert>{error}</Alert>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field id="co-name" label="Company name"><Input id="co-name" value={c.name || ''} onChange={set('name')} /></Field>
        <Field id="co-gstin" label="GSTIN"><Input id="co-gstin" value={c.gstin || ''} onChange={set('gstin')} /></Field>
        <Field id="co-state" label="State" hint="Decides CGST + SGST or IGST"><Input id="co-state" value={c.state || ''} onChange={set('state')} placeholder="Karnataka" /></Field>
        <Field id="co-phone" label="Phone"><Input id="co-phone" value={c.phone || ''} onChange={set('phone')} /></Field>
        <Field id="co-email" label="Email"><Input id="co-email" value={c.email || ''} onChange={set('email')} /></Field>
        <Field id="co-upi" label="UPI ID"><Input id="co-upi" value={c.upi || ''} onChange={set('upi')} /></Field>
        <Field id="co-addr" label="Address"><Input id="co-addr" value={c.address || ''} onChange={set('address')} /></Field>
        <Field id="co-bank" label="Bank details" hint="Account name, number, IFSC"><Input id="co-bank" value={c.bank || ''} onChange={set('bank')} /></Field>
        <Field id="co-terms" label="Terms printed at the bottom"><Input id="co-terms" value={c.terms || ''} onChange={set('terms')} placeholder="Payment due within 7 days." /></Field>
      </div>
      <div className="mt-3"><Button onClick={save}>Save details</Button></div>
    </details>
  );
};

/* ── the builder ─────────────────────────────────────────────────────────── */
const Builder = ({ kind, doc, onDone, onCancel }) => {
  const toast = useToast();
  const label = kind === 'QUOTE' ? 'quotation' : 'invoice';
  const [client, setClient] = useState(doc?.client || emptyClient);
  const [businessId, setBusinessId] = useState(doc?.business_id || null);
  const [prices, setPrices] = useState(null);
  useEffect(() => { if (businessId) adminApi(`/businesses/${businessId}/wallet`).then((w) => setPrices(w.prices_paise)).catch(() => setPrices(null)); }, [businessId]);
  const [lines, setLines] = useState(doc ? doc.items.map((i) => ({ description: i.description, hsn: i.hsn || '', qty: String(i.qty), rate_rupees: String(i.rate_paise / 100), gst_rate: String(i.gst_rate) })) : [emptyLine()]);
  const [due, setDue] = useState(doc?.due_date ? String(doc.due_date).slice(0, 10) : '');
  const [notes, setNotes] = useState(doc?.notes || '');
  const [credit, setCredit] = useState(doc && Number(doc.credit_paise) ? String(Number(doc.credit_paise) / 100) : '');
  const [seller, setSeller] = useState(null);
  const [find, setFind] = useState('');
  const [found, setFound] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  useEffect(() => { adminApi('/company').then(setSeller).catch(() => {}); }, []);
  useEffect(() => { const id = Number(params.get('client')); if (!doc && id) pick({ business_id: id }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (find.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => adminApi(`/businesses?search=${encodeURIComponent(find.trim())}&pageSize=6`).then((r) => setFound(r.businesses || [])).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [find]);
  const pick = async (b) => { setFind(''); setFound([]); try { const c = await adminApi(`/documents/client/${b.business_id}`); setBusinessId(c.business_id); setClient({ name: c.name, gstin: c.gstin, address: c.address, state: c.state, email: c.email, phone: c.phone }); } catch (e) { setError(e.message); } };
  const setLine = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const intra = sameState(seller?.state, client.state);
  const p = useMemo(() => preview(lines, intra), [lines, intra]);
  const setC = (k) => (e) => setClient({ ...client, [k]: e.target.value });

  const save = async () => {
    setError(''); setBusy(true);
    try {
      const body = { kind, business_id: businessId, client, items: lines.map((l) => ({ ...l, qty: Number(l.qty), gst_rate: Number(l.gst_rate) })), due_date: due || null, notes, credit_rupees: kind === 'INVOICE' ? Number(credit || 0) : 0 };
      const saved = await adminApi(doc ? `/documents/${doc.doc_id}` : '/documents', { method: doc ? 'PUT' : 'POST', body });
      toast.success(doc ? 'Saved' : `${saved.doc_number} created`); onDone(saved.doc_id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {seller && !seller.name && <Alert>Fill in your company details on the list page first, so they print on the {label}.</Alert>}
      <Card>
        <h2 className="font-semibold text-ink-900">Client</h2>
        <Field id="d-find" label="Pick an existing client" hint="Search by business or owner name; their details fill in"><Input id="d-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Start typing a business name" /></Field>
        {found.length > 0 && <ul className="mt-1 rounded-lg border border-line">{found.map((b) => <li key={b.business_id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => pick(b)}>{b.name} <span className="text-xs text-ink-500">{b.owner?.name}</span></button></li>)}</ul>}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field id="c-name" label="Name"><Input id="c-name" value={client.name} onChange={setC('name')} /></Field>
          <Field id="c-gstin" label="GSTIN (if any)"><Input id="c-gstin" value={client.gstin} onChange={setC('gstin')} /></Field>
          <Field id="c-state" label="State" hint={intra ? 'Same state: CGST + SGST' : 'Other state: IGST'}><Input id="c-state" value={client.state} onChange={setC('state')} /></Field>
          <Field id="c-phone" label="Phone"><Input id="c-phone" value={client.phone} onChange={setC('phone')} /></Field>
          <Field id="c-email" label="Email"><Input id="c-email" value={client.email} onChange={setC('email')} /></Field>
          <Field id="c-addr" label="Address"><Input id="c-addr" value={client.address} onChange={setC('address')} /></Field>
        </div>
      </Card>
      <Card>
        <h2 className="font-semibold text-ink-900">Lines</h2>
        <div className="mt-3 space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_6rem_5rem_8rem_5rem_auto]">
              <Input aria-label="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Pro plan, 1 year" />
              <Input aria-label="HSN / SAC" value={l.hsn} onChange={(e) => setLine(i, { hsn: e.target.value })} placeholder="9983" />
              <Input aria-label="Quantity" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
              <Input aria-label="Price in rupees" inputMode="decimal" value={l.rate_rupees} onChange={(e) => setLine(i, { rate_rupees: e.target.value })} placeholder="Price ₹" />
              <Select aria-label="GST" value={l.gst_rate} onChange={(e) => setLine(i, { gst_rate: e.target.value })}>{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}</Select>
              <Button variant="ghost" size="sm" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)} aria-label="Remove line">×</Button>
            </div>
          ))}
        </div>
        <div className="mt-3"><Button variant="ghost" size="sm" onClick={() => setLines([...lines, emptyLine()])}>+ Add a line</Button></div>
        <div className="mt-4 space-y-1 text-right text-sm text-ink-700">
          <p>Taxable value: {rs(p.taxable)}</p>
          <p>{intra ? 'CGST + SGST' : 'IGST'}: {rs(p.tax)}</p>
          <p className="text-base font-semibold text-ink-900">Total: {rs(p.total)}</p>
        </div>
      </Card>
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          {kind === 'INVOICE' && <Field id="d-due" label="Due date"><Input id="d-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>}
          {kind === 'QUOTE' && <Field id="d-due" label="Valid until"><Input id="d-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>}
          {kind === 'INVOICE' && businessId && (
            <>
            <Field id="d-credit" label="WhatsApp credit to load when paid (₹)" hint="Leave blank if this invoice is not for credit. It goes into the client's wallet automatically once the invoice is paid.">
              <Input id="d-credit" inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="1000" />
            </Field>
            {kind === 'INVOICE' && businessId && prices && Number(credit) > 0 && <p className="-mt-2 text-sm text-ink-600">That gives them about <b>{Math.floor(Number(credit) * 100 / Math.max(1, prices.UTILITY)).toLocaleString('en-IN')}</b> normal messages or <b>{Math.floor(Number(credit) * 100 / Math.max(1, prices.MARKETING)).toLocaleString('en-IN')}</b> marketing messages.</p>}
            </>
          )}
          <Field id="d-notes" label="Note on the document"><Input id="d-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
        </div>
      </Card>
      <Alert>{error}</Alert>
      <div className="flex gap-2"><Button onClick={save} loading={busy}>{doc ? 'Save changes' : `Create ${label}`}</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
};

/* ── the printable document ──────────────────────────────────────────────── */
const View = ({ id, onEdit, onOpen, onBack, onChanged }) => {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const load = () => adminApi(`/documents/${id}`).then(setD).catch((e) => setError(e.message));
  useEffect(() => { setD(null); load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <ListState loading={!error} error={error} />;
  const quote = d.kind === 'QUOTE';
  const act = async (status) => {
    setError('');
    try { await adminApi(`/documents/${id}/status`, { method: 'POST', body: { status } }); toast.success('Updated'); await load(); onChanged(); } catch (e) { setError(e.message); }
  };
  const [payForm, setPayForm] = useState(null);
  const [mailBusy, setMailBusy] = useState(false);
  const emailIt = async () => {
    setError(''); let to = d.client?.email;
    if (!to) { to = window.prompt('Email address to send it to'); if (!to) return; }
    setMailBusy(true);
    try { const r = await adminApi(`/documents/${id}/email`, { method: 'POST', body: { to } }); toast.success(`Sent to ${r.emailed_to}`); await load(); onChanged(); } catch (e) { setError(e.message); } finally { setMailBusy(false); }
  };
  const whatsappIt = () => {
    const digits = String(d.client?.phone || '').replace(/\D/g, '');
    const to = digits.length === 10 ? `91${digits}` : digits;
    const lines = [`${quote ? 'Quotation' : 'Invoice'} ${d.doc_number} from ${s.name || 'FlowXP'}`, `Total ${rs(d.totals?.total_paise)}`, !quote && d.status !== 'PAID' && d.payment_link_url && `Pay online: ${d.payment_link_url}`, !quote && d.status !== 'PAID' && s.upi && `UPI: ${s.upi}`].filter(Boolean);
    window.open(`https://wa.me/${to}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
    if (d.status === 'DRAFT') act('SENT');
  };
  const recordPayment = async (e) => {
    e.preventDefault(); setError('');
    try { await adminApi(`/documents/${id}/status`, { method: 'POST', body: { status: 'PAID', method: payForm.method, paid_on: payForm.date, note: payForm.ref } }); toast.success('Payment recorded'); setPayForm(null); await load(); onChanged(); } catch (err) { setError(err.message); }
  };
  const makeLink = async () => {
    setError(''); setLinkBusy(true);
    try { const r = await adminApi(`/documents/${id}/payment-link`, { method: 'POST' }); await load(); onChanged(); try { await navigator.clipboard.writeText(r.payment_link_url); toast.success('Payment link copied'); } catch { toast.success('Payment link ready'); } }
    catch (e) { setError(e.message); } finally { setLinkBusy(false); }
  };
  const convert = async () => { setError(''); try { const inv = await adminApi(`/documents/${id}/convert`, { method: 'POST' }); toast.success(`${inv.doc_number} created`); onChanged(); onOpen(inv.doc_id, 'INVOICE'); } catch (e) { setError(e.message); } };
  const s = d.seller || {}; const t = d.totals; const c = d.client;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Badge tone={TONE[d.status]}>{d.status[0] + d.status.slice(1).toLowerCase()}</Badge>
        <span className="flex-1" />
        {d.status === 'DRAFT' && <Button variant="ghost" onClick={onEdit}>Edit</Button>}
        {!['CANCELLED', 'DECLINED'].includes(d.status) && <Button variant="ghost" onClick={emailIt} loading={mailBusy}>Email to client</Button>}
        {!['CANCELLED', 'DECLINED'].includes(d.status) && <Button variant="ghost" onClick={whatsappIt}>WhatsApp</Button>}
        {d.status === 'DRAFT' && <Button variant="ghost" onClick={() => act('SENT')}>Mark as sent</Button>}
        {!quote && ['DRAFT', 'SENT'].includes(d.status) && <Button variant="ghost" onClick={makeLink} loading={linkBusy}>{d.payment_link_url ? 'Copy payment link' : 'Create payment link'}</Button>}
        {!quote && ['DRAFT', 'SENT'].includes(d.status) && <Button onClick={() => setPayForm({ method: 'UPI', date: new Date().toISOString().slice(0, 10), ref: '' })}>Record payment</Button>}
        {quote && d.status === 'SENT' && <><Button variant="ghost" onClick={() => act('ACCEPTED')}>Accepted</Button><Button variant="ghost" onClick={() => act('DECLINED')}>Declined</Button></>}
        {quote && ['DRAFT', 'SENT', 'ACCEPTED'].includes(d.status) && <Button onClick={convert}>Make it an invoice</Button>}
        {['DRAFT', 'SENT'].includes(d.status) && <Button variant="ghost" onClick={() => window.confirm('Cancel this document?') && act('CANCELLED')}>Cancel</Button>}
        <Button onClick={() => window.print()}>Print / save as PDF</Button>
      </div>
      <Alert>{error}</Alert>
      {payForm && (
        <form onSubmit={recordPayment} className="space-y-3 rounded-lg border border-line bg-white p-4 print:hidden">
          <p className="text-sm font-semibold text-ink-900">Record a payment received outside the payment link</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="p-method" label="Paid by">
              <Select id="p-method" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                {[['UPI', 'UPI'], ['BANK_TRANSFER', 'Bank transfer'], ['CASH', 'Cash'], ['CHEQUE', 'Cheque'], ['CARD', 'Card'], ['OTHER', 'Other']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field id="p-date" label="Date received"><Input id="p-date" type="date" max={new Date().toISOString().slice(0, 10)} value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} required /></Field>
            <Field id="p-ref" label="Reference (UTR, cheque no.)"><Input id="p-ref" value={payForm.ref} onChange={(e) => setPayForm({ ...payForm, ref: e.target.value })} placeholder="optional" /></Field>
          </div>
          <div className="flex gap-2"><Button type="submit">Save payment</Button><Button type="button" variant="ghost" onClick={() => setPayForm(null)}>Cancel</Button></div>
        </form>
      )}
      {!quote && Number(d.credit_paise) > 0 && <p className="rounded-lg bg-brand-50 p-3 text-sm text-ink-700 print:hidden" role="status">{d.credit_loaded ? `${rs(d.credit_paise)} of WhatsApp credit was loaded into this client's wallet.` : `${rs(d.credit_paise)} of WhatsApp credit will be loaded into this client's wallet as soon as this invoice is paid.`}</p>}
      {d.emailed_at && <p className="text-xs text-ink-500 print:hidden">Emailed to {d.emailed_to} on {day(d.emailed_at)}</p>}
      {d.payment_link_url && ['DRAFT', 'SENT'].includes(d.status) && <p className="break-all rounded-lg bg-surface p-3 text-xs text-ink-600 print:hidden">Payment link: {d.payment_link_url}</p>}
      <article className="mx-auto max-w-3xl rounded-xl border border-line bg-white p-8 text-sm text-ink-900 print:max-w-none print:rounded-none print:border-0 print:p-0">
        <header className="flex justify-between gap-6">
          <div><p className="text-lg font-semibold">{s.name || 'FlowXP'}</p><p className="whitespace-pre-line text-ink-600">{s.address}</p>{s.gstin && <p>GSTIN: {s.gstin}</p>}<p className="text-ink-600">{[s.phone, s.email].filter(Boolean).join(' · ')}</p></div>
          <div className="text-right"><p className="text-xl font-semibold uppercase tracking-wide">{quote ? 'Quotation' : s.gstin ? 'Tax invoice' : 'Invoice'}</p><p>{d.doc_number}</p><p className="text-ink-600">Date: {day(d.issue_date)}</p>{d.due_date && <p className="text-ink-600">{quote ? 'Valid until' : 'Due'}: {day(d.due_date)}</p>}</div>
        </header>
        <section className="mt-6"><p className="text-xs uppercase text-ink-500">{quote ? 'Prepared for' : 'Billed to'}</p><p className="font-semibold">{c.name}</p><p className="text-ink-600">{c.address}</p><p className="text-ink-600">{[c.state, c.phone, c.email].filter(Boolean).join(' · ')}</p>{c.gstin && <p>GSTIN: {c.gstin}</p>}</section>
        <table className="mt-6 w-full">
          <thead><tr className="border-b border-ink-300 text-left text-xs uppercase text-ink-500"><th className="py-2">Description</th><th>HSN</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">GST</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{d.items.map((i, k) => <tr key={k} className="border-b border-line"><td className="py-2">{i.description}</td><td>{i.hsn}</td><td className="text-right">{i.qty}</td><td className="text-right">{rs(i.rate_paise)}</td><td className="text-right">{i.gst_rate}%</td><td className="text-right">{rs(i.taxable_paise)}</td></tr>)}</tbody>
        </table>
        <div className="ml-auto mt-4 w-64 space-y-1">
          <p className="flex justify-between"><span>Taxable value</span><span>{rs(t.taxable_paise)}</span></p>
          {d.intra_state ? <><p className="flex justify-between"><span>CGST</span><span>{rs(t.cgst_paise)}</span></p><p className="flex justify-between"><span>SGST</span><span>{rs(t.sgst_paise)}</span></p></> : <p className="flex justify-between"><span>IGST</span><span>{rs(t.igst_paise)}</span></p>}
          {t.round_off_paise !== 0 && <p className="flex justify-between"><span>Round off</span><span>{rs(t.round_off_paise)}</span></p>}
          <p className="flex justify-between border-t border-ink-300 pt-1 text-base font-semibold"><span>Total</span><span>{rs(t.total_paise)}</span></p>
        </div>
        {d.notes && <p className="mt-6 whitespace-pre-line text-ink-700">{d.notes}</p>}
        <footer className="mt-8 space-y-1 border-t border-line pt-3 text-xs text-ink-600">
          {!quote && (s.upi || s.bank) && <p>Pay by {[s.upi && `UPI ${s.upi}`, s.bank].filter(Boolean).join(' · ')}</p>}
          {!quote && d.payment_link_url && d.status !== 'PAID' && <p>Pay online: {d.payment_link_url}</p>}
          {d.status === 'PAID' && <p className="font-semibold text-success">Paid on {day(d.paid_at)}{d.paid_method ? ` by ${d.paid_method.replace('_', ' ').toLowerCase()}` : ''}{d.paid_note ? ` (${d.paid_note})` : ''}</p>}
          {s.terms && <p>{s.terms}</p>}
        </footer>
      </article>
    </div>
  );
};

/* ── the page ────────────────────────────────────────────────────────────── */
const AdminDocuments = ({ kind }) => {
  const quote = kind === 'QUOTE';
  const word = quote ? 'quotation' : 'invoice';
  const [params] = useSearchParams();
  const [mode, setMode] = useState(params.get('open') ? { name: 'view', id: Number(params.get('open')) } : params.get('client') && !quote ? { name: 'new' } : { name: 'list' });
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const load = () => adminApi(`/documents?kind=${kind}&status=${status}&search=${encodeURIComponent(search)}`).then((r) => { setError(''); setRows(r); }).catch((e) => setError(e.message));
  useEffect(() => { setRows(null); load(); }, [kind, status, search]);   // eslint-disable-line react-hooks/exhaustive-deps
  const statuses = quote ? ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CONVERTED', 'CANCELLED'] : ['DRAFT', 'SENT', 'PAID', 'CANCELLED'];
  const open = (id, k = kind) => (k === kind ? setMode({ name: 'view', id }) : window.location.assign(`/superadmin/${k === 'QUOTE' ? 'quotations' : 'invoices'}`));

  if (mode.name === 'new') return <><PageHeader title={`New ${word}`} /><Builder kind={kind} onDone={(id) => { load(); setMode({ name: 'view', id }); }} onCancel={() => setMode({ name: 'list' })} /></>;
  if (mode.name === 'edit') return <><PageHeader title={`Change ${word}`} /><Builder kind={kind} doc={mode.doc} onDone={(id) => { load(); setMode({ name: 'view', id }); }} onCancel={() => setMode({ name: 'view', id: mode.doc.doc_id })} /></>;
  if (mode.name === 'view') return <View id={mode.id} onBack={() => setMode({ name: 'list' })} onChanged={load} onOpen={open} onEdit={async () => setMode({ name: 'edit', doc: await adminApi(`/documents/${mode.id}`) })} />;

  return (
    <div className="space-y-5">
      <PageHeader title={quote ? 'Quotations' : 'Invoices'} lead={quote ? 'Price offers to clients. Once accepted, turn one into an invoice in one step.' : 'GST invoices from FlowXP to its clients, for plans, setup and WhatsApp credit.'} action={<Button onClick={() => setMode({ name: 'new' })}>New {word}</Button>} />
      <CompanyDetails />
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{statuses.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}</Select>
        <Input aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number or client" />
      </div>
      {!rows || !rows.length ? <ListState loading={!rows && !error} error={error} empty={rows && !rows.length ? `No ${word}s yet.` : undefined} /> : (
        <Table>
          <Thead><tr><Th>Number</Th><Th>Client</Th><Th>Date</Th><Th className="text-right">Total</Th><Th>Status</Th></tr></Thead>
          <tbody>{rows.map((r) => (
            <Tr key={r.doc_id} onClick={() => setMode({ name: 'view', id: r.doc_id })} className="cursor-pointer">
              <Td>{r.doc_number}</Td><Td>{r.client_name}</Td><Td>{day(r.issue_date)}</Td><Td className="text-right">{rs(r.total_paise)}</Td><Td><Badge tone={TONE[r.status]}>{r.status[0] + r.status.slice(1).toLowerCase()}</Badge></Td>
            </Tr>
          ))}</tbody>
        </Table>
      )}
    </div>
  );
};

export const AdminInvoices = () => <AdminDocuments kind="INVOICE" />;
export const AdminQuotations = () => <AdminDocuments kind="QUOTE" />;
export default AdminInvoices;
