/* Invoices, bills and credit notes share one set of screens: a list, a form for the draft, and a page for the document. */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLoad } from '../api.js';
import { STATES, TCS_SECTIONS, UNITS, addDays, amountInWords, inr, showDate, today, unitLabel } from '../lib.js';
import { useSession } from '../session.jsx';
import { DocSheet, EwayPanel } from './Print.jsx';
import { WhatsappButton, WhatsappLog } from './Whatsapp.jsx';
import { EmailForm, EmailLog, useEmailOn } from './Email.jsx';
import { Async, Badge, Btn, Card, Confirm, Empty, Err, Field, Money, Note, Page, Table, Tabs, useAction } from '../ui.jsx';

export const DocList = ({ kind }) => {
  const { o, org } = useSession();
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [extra, setExtra] = useState([]);
  const load = useLoad(() => o(`/${kind.api}?limit=50${status ? `&status=${status}` : ''}`), [org.id, kind.api, status]);
  useEffect(() => setExtra([]), [kind.api, status]);
  const more = useAction();
  const rows = load.data ? [...load.data.documents, ...extra] : [];
  const next = extra.length ? extra.next : load.data?.next;
  const loadMore = () => more.run(async () => { const r = await o(`/${kind.api}?limit=50&before=${next}${status ? `&status=${status}` : ''}`); const list = Object.assign([...extra, ...r.documents], { next: r.next }); setExtra(list); });

  return (
    <Page title={kind.title} actions={<Link className="btn primary" to={`/${kind.path}/new`}>New {kind.one.toLowerCase()}</Link>}>
      <Tabs value={status} onChange={setStatus} tabs={[['', 'All'], ['DRAFT', 'Drafts'], ['ISSUED', 'Issued'], ['VOID', 'Void']]} />
      <Async load={load}>{() => (
        <Card>
          <Table head={['Number', kind.who, 'Date', kind.dueLabel || 'Due', 'Status', '>Total', kind.pre ? '' : '>Balance']} empty={!rows.length && <Empty>Nothing here yet.</Empty>}>
            {rows.map((d) => (
              <tr key={d.id} className="click" onClick={() => nav(`/${kind.path}/${d.id}`)}>
                <td><Link to={`/${kind.path}/${d.id}`}>{d.number || 'Draft'}</Link></td><td>{d.party_name}</td><td>{showDate(d.issue_date)}</td><td>{showDate(d.due_date)}</td>
                <td><Badge status={d.outcome || d.status} /></td><td className="r"><Money v={d.total_minor} /></td><td className="r">{d.status === 'ISSUED' && !kind.pre ? <Money v={d.balance_minor} /> : ''}</td>
              </tr>
            ))}
          </Table>
          <Err>{more.error}</Err>
          {next && <p><Btn busy={more.busy} onClick={loadMore}>Show more</Btn></p>}
        </Card>
      )}</Async>
    </Page>
  );
};

const isNote = (kind) => kind.api === 'credit-notes' || kind.api === 'debit-notes';   // reduces what a customer owes (credit) or what you owe a vendor (debit)
const blankLine = () => ({ itemId: '', description: '', hsnSac: '', unit: '', quantity: '1', unitPrice: '', discount: '', taxCode: 'GST18', inclusive: false });

export const DocForm = ({ kind }) => {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { o, org } = useSession();
  const nav = useNavigate();
  const a = useAction();
  const parties = useLoad(() => o(`/parties?kind=${kind.partyKind}&limit=500`), [org.id, kind.partyKind]);
  const items = useLoad(() => o('/items'), [org.id]);
  const fx = useLoad(() => o('/exchange-rates'), [org.id]);
  const rates = useLoad(() => o('/tax-rates'), [org.id]);
  const existing = useLoad(() => (id ? o(`/${kind.api}/${id}`) : Promise.resolve(null)), [org.id, id]);
  const [f, setF] = useState({ partyId: '', date: today(), dueDate: '', placeOfSupply: '', supplierRef: '', relatedDocumentId: '', memo: '', roundOff: true, tcsRate: '', tcsSection: '', reverseCharge: false, currency: 'INR', fxRate: '', projectId: '', warehouseId: '', shippingBillNo: '', shippingBillDate: '', portCode: '', lines: [blankLine()] });
  const warehouses = useLoad(() => (['quotes', 'sales-orders', 'purchase-orders'].includes(kind.api) ? Promise.resolve([]) : o('/warehouses')), [org.id]);
  const projects = useLoad(() => (isNote(kind) || kind.api === 'purchase-orders' ? Promise.resolve([]) : o('/projects?status=ACTIVE')), [org.id]);
  const invoices = useLoad(() => (isNote(kind) && f.partyId ? o(`/${kind.api === 'credit-notes' ? 'invoices' : 'bills'}?status=ISSUED&partyId=${f.partyId}&limit=100`) : Promise.resolve(null)), [org.id, f.partyId, kind.api]);

  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setF({ shippingBillNo: d.shipping_bill_no || '', shippingBillDate: d.shipping_bill_date || '', portCode: d.port_code || '', warehouseId: d.warehouse_id ? String(d.warehouse_id) : '', projectId: d.project_id ? String(d.project_id) : '', currency: d.currency || 'INR', fxRate: d.currency && d.currency !== 'INR' ? String(d.fx_rate).replace(/0+$/, '').replace(/\.$/, '') : '', partyId: String(d.party_id), date: d.issue_date || today(), dueDate: d.due_date || '', placeOfSupply: d.place_of_supply || '', supplierRef: d.supplier_ref || '', relatedDocumentId: d.related_document_id ? String(d.related_document_id) : '',
      memo: d.memo || '', reverseCharge: Boolean(d.reverse_charge), tcsRate: d.tcs_rate_bp ? String(d.tcs_rate_bp / 100) : '', tcsSection: d.tcs_section || '', roundOff: Number(d.round_off_minor) !== 0 || d.status === 'DRAFT', lines: d.lines.map((l) => ({ itemId: l.item_id ? String(l.item_id) : '', description: l.description || '', hsnSac: l.hsn_sac || '', unit: l.unit || '', quantity: l.quantity, unitPrice: l.unit_price_fc_minor ?? l.unit_price_minor, discount: Number(l.discount_fc_minor ?? l.discount_minor) ? (l.discount_fc_minor ?? l.discount_minor) : '', taxCode: l.tax_code || '', inclusive: Boolean(l.price_includes_tax) })) });
  }, [existing.data]);
  useEffect(() => { if (!id && search.get('partyId')) setF((x) => ({ ...x, partyId: search.get('partyId') })); }, [id, search]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setLine = (i, patch) => setF({ ...f, lines: f.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) });
  const pickItem = (i, itemId) => {
    const it = (items.data || []).find((x) => String(x.id) === itemId);
    setLine(i, it ? { itemId, description: it.name, hsnSac: it.hsn_sac || '', unit: it.unit || '', taxCode: it.tax_code || 'GST18', unitPrice: f.currency !== 'INR' ? '' : (kind.api === 'bills' || kind.api === 'purchase-orders' ? it.purchase_price_minor : it.sale_price_minor) || '' } : { itemId: '' });
  };
  const codes = [...new Set((rates.data || []).map((r) => r.code))];

  const submit = (e) => {
    e.preventDefault();
    a.run(async () => {
      const body = { partyId: f.partyId, date: f.date, roundOff: f.currency !== 'INR' ? false : f.roundOff, ...(f.currency !== 'INR' && { currency: f.currency, fxRate: f.fxRate }), memo: f.memo || undefined, ...(f.projectId && { projectId: f.projectId }), ...(f.warehouseId && { warehouseId: f.warehouseId }), ...(f.currency !== 'INR' && kind.api === 'invoices' && { ...(f.shippingBillNo && { shippingBillNo: f.shippingBillNo }), ...(f.shippingBillDate && { shippingBillDate: f.shippingBillDate }), ...(f.portCode && { portCode: f.portCode }) }), dueDate: f.dueDate || undefined, placeOfSupply: f.placeOfSupply || undefined,
        supplierRef: kind.api === 'bills' ? f.supplierRef || undefined : undefined, relatedDocumentId: isNote(kind) ? f.relatedDocumentId || undefined : undefined,
        ...(kind.api === 'bills' && f.reverseCharge && { reverseCharge: true }),
        ...(kind.api === 'invoices' && Number(f.tcsRate) > 0 && { tcsRateBp: Math.round(Number(f.tcsRate) * 100), ...(f.tcsSection && { tcsSection: f.tcsSection }) }),
        lines: f.lines.map((l) => ({ itemId: l.itemId || undefined, description: l.description || undefined, hsnSac: l.hsnSac || undefined, unit: l.unit || undefined, quantity: String(l.quantity), unitPrice: String(l.unitPrice || '0'), discount: l.discount ? String(l.discount) : undefined, taxCode: l.taxCode || undefined, ...(l.inclusive && { inclusive: true }) })) };
      const out = id ? await o(`/${kind.api}/${id}`, { method: 'PUT', body }) : await o(`/${kind.api}`, { method: 'POST', body });
      nav(`/${kind.path}/${out.id}`);
    });
  };

  const party = (parties.data || []).find((p) => String(p.id) === f.partyId);
  const cs = f.currency === 'INR' ? '₹' : f.currency;
  const changeCurrency = async (currency) => {
    let fxRate = '';
    if (currency !== 'INR') { try { fxRate = (await o(`/exchange-rates/on?currency=${currency}&date=${f.date}`)).rate || ''; } catch { /* the person types the rate */ } }
    setF((x) => ({ ...x, currency, fxRate: fxRate.replace(/0+$/, '').replace(/\.$/, '') }));
  };
  const onParty = (e) => {
    const p = (parties.data || []).find((x) => String(x.id) === e.target.value);
    setF({ ...f, partyId: e.target.value, relatedDocumentId: '', dueDate: p && !f.dueDate && p.credit_days ? addDays(f.date, p.credit_days) : f.dueDate });
  };

  return (
    <Page title={`${id ? 'Edit' : 'New'} ${kind.one.toLowerCase()}`} lead="Prices are reworked and numbered when you issue it. Until then it is a draft you can change.">
      <Err>{existing.error || a.error}</Err>
      <form onSubmit={submit}>
        <Card>
          <div className="form">
            <Field label={kind.who}>
              <select value={f.partyId} onChange={onParty} required><option value="">Choose…</option>{(parties.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              {parties.data && !parties.data.length && <span className="hint">No {kind.who.toLowerCase()}s yet. <Link to={kind.partyKind === 'VENDOR' ? '/vendors' : '/customers'}>Add one first</Link>.</span>}
            </Field>
            <Field label="Date"><input type="date" value={f.date} onChange={set('date')} required /></Field>
            {!!projects.data?.length && <Field label="Project" hint="Optional: counts towards that project's profit"><select value={f.projectId} onChange={set('projectId')}><option value="">None</option>{projects.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
            {(warehouses.data || []).filter((w) => w.active).length > 1 && <Field label="Warehouse" hint="Where counted goods on this document come from or go to"><select value={f.warehouseId} onChange={set('warehouseId')}><option value="">Default</option>{warehouses.data.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>}
            {!isNote(kind) && <Field label="Currency"><select value={f.currency} onChange={(e) => changeCurrency(e.target.value)}><option value="INR">Rupees (₹)</option>{Object.entries(fx.data?.currencies || {}).map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select></Field>}
            {f.currency !== 'INR' && kind.api === 'invoices' && <>
              <Field label="Shipping bill no." hint="Export of goods; goes in GSTR-1 (optional until it is filed)"><input value={f.shippingBillNo} onChange={set('shippingBillNo')} maxLength={7} /></Field>
              <Field label="Shipping bill date"><input type="date" value={f.shippingBillDate} onChange={set('shippingBillDate')} /></Field>
              <Field label="Port code"><input value={f.portCode} onChange={set('portCode')} maxLength={6} /></Field>
            </>}
            {f.currency !== 'INR' && <Field label={`Rate: ₹ for 1 ${f.currency}`} hint="Converts to rupees for your books and GST. Save usual rates in Settings > Currencies"><input inputMode="decimal" value={f.fxRate} onChange={set('fxRate')} required /></Field>}
            {!isNote(kind) && <Field label={kind.dueLabel || 'Due date'} hint={party?.credit_days ? `${party.name} usually gets ${party.credit_days} days` : 'Optional'}><input type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>}
            <Field label="Place of supply" hint="Leave empty to use the party's state"><select value={f.placeOfSupply} onChange={set('placeOfSupply')}><option value="">Automatic</option>{Object.entries(STATES).map(([c, n]) => <option key={c} value={String(c).padStart(2, '0')}>{String(c).padStart(2, '0')} · {n}</option>)}</select></Field>
            {kind.api === 'bills' && <Field label="Vendor's bill number"><input value={f.supplierRef} onChange={set('supplierRef')} maxLength={60} /></Field>}
            {isNote(kind) && (
              <Field label={kind.api === 'credit-notes' ? 'Against invoice' : 'Against bill'} hint="Optional">
                <select value={f.relatedDocumentId} onChange={set('relatedDocumentId')} disabled={!f.partyId}><option value="">None</option>{(invoices.data?.documents || []).map((d) => <option key={d.id} value={d.id}>{d.number} · ₹{inr(d.total_minor)}</option>)}</select>
              </Field>
            )}
            <Field label="Note" wide><input value={f.memo} onChange={set('memo')} maxLength={500} /></Field>
          </div>
        </Card>

        <Card title="Lines" actions={<Btn type="button" className="btn small" onClick={() => setF({ ...f, lines: [...f.lines, blankLine()] })}>Add line</Btn>}>
          <div className="lines">
            {f.lines.map((l, i) => (
              <div className="line" key={i}>
                <Field label="Item"><select value={l.itemId} onChange={(e) => pickItem(i, e.target.value)}><option value="">Not from the list</option>{(items.data || []).map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}</select></Field>
                <Field label="Description"><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></Field>
                <Field label="Qty"><input inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} required /></Field>
                <Field label="Unit"><select value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })}><option value="">–</option>{UNITS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></Field>
                <Field label={l.inclusive ? `Price with GST (${cs})` : `Price (${cs})`} hint={<label className="check"><input type="checkbox" checked={l.inclusive} onChange={(e) => setLine(i, { inclusive: e.target.checked })} /> GST is in this price</label>}><input inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} required /></Field>
                <Field label={`Discount (${cs})`}><input inputMode="decimal" value={l.discount} onChange={(e) => setLine(i, { discount: e.target.value })} /></Field>
                <Field label="GST"><select value={l.taxCode} onChange={(e) => setLine(i, { taxCode: e.target.value })}>{codes.length ? codes.map((c) => <option key={c}>{c}</option>) : <option>{l.taxCode}</option>}</select></Field>
                <Btn type="button" className="btn small danger" disabled={f.lines.length === 1} onClick={() => setF({ ...f, lines: f.lines.filter((_, n) => n !== i) })} aria-label="Remove line">Remove</Btn>
              </div>
            ))}
          </div>
          {kind.api === 'invoices' && <div className="form">
            <Field label="TCS to collect (%)" hint="Only if the law requires you to collect tax at source on this sale; charged on value plus GST"><input inputMode="decimal" value={f.tcsRate} onChange={set('tcsRate')} /></Field>
            {Number(f.tcsRate) > 0 && <Field label="TCS section"><select value={f.tcsSection} onChange={set('tcsSection')}><option value="">Not stated</option>{TCS_SECTIONS.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select></Field>}
          </div>}
          {kind.api === 'bills' && <p className="check"><input id="rcm" type="checkbox" checked={f.reverseCharge} onChange={set('reverseCharge')} /><label htmlFor="rcm">Reverse charge: the vendor charges no GST, I pay it to the government and claim it back</label></p>}
          <p className="check"><input id="ro" type="checkbox" checked={f.roundOff} onChange={set('roundOff')} /><label htmlFor="ro">Round the total to the nearest rupee</label></p>
        </Card>
        <div className="actions"><Btn kind="primary" busy={a.busy}>Save draft</Btn><Btn type="button" onClick={() => nav(-1)}>Cancel</Btn></div>
      </form>
    </Page>
  );
};

const PATH = { PURCHASE_ORDER: 'purchase-orders', INVOICE: 'sales', BILL: 'purchases', CREDIT_NOTE: 'credit-notes', DEBIT_NOTE: 'debit-notes', QUOTE: 'quotes', SALES_ORDER: 'sales-orders' };

/* Which batches or serial numbers a counted line is made of, asked for when a document is issued. Buying needs them; selling may leave them empty and takes the earliest expiry or oldest serial. */
const TrackingPanel = ({ lines, inward, value, onChange }) => {
  const items = [...new Map(lines.filter((l) => l.tracking && l.tracking !== 'NONE').map((l) => [l.item_id, l])).values()];
  if (!items.length) return null;
  const set = (id, v) => onChange({ ...value, [id]: v });
  return (
    <Card title="Which units?">
      <p className="muted">{inward ? 'Say the batch (with its expiry date) or the serial numbers coming in.' : 'Leave empty to take the batch that expires first, or the serial numbers that have been in longest.'}</p>
      {items.map((l) => {
        const v = value[l.item_id] || { rows: [{ batch: '', expiry: '', quantity: '' }], serials: '' };
        const rows = v.rows;
        return (
          <div key={l.item_id} className="form">
            <strong className="wide">{l.description} · {l.quantity}</strong>
            {l.tracking === 'SERIAL'
              ? <Field label="Serial numbers" hint="One per line" wide><textarea rows={Math.min(8, Math.max(3, Number(l.quantity) + 1))} value={v.serials} onChange={(e) => set(l.item_id, { ...v, serials: e.target.value })} /></Field>
              : rows.map((r, i) => (
                <div key={i} className="wide form">
                  <Field label="Batch"><input value={r.batch} maxLength={40} onChange={(e) => set(l.item_id, { ...v, rows: rows.map((x, j) => (j === i ? { ...x, batch: e.target.value } : x)) })} /></Field>
                  <Field label="Expires"><input type="date" value={r.expiry} onChange={(e) => set(l.item_id, { ...v, rows: rows.map((x, j) => (j === i ? { ...x, expiry: e.target.value } : x)) })} /></Field>
                  {rows.length > 1 && <Field label="Quantity"><input inputMode="decimal" value={r.quantity} onChange={(e) => set(l.item_id, { ...v, rows: rows.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) })} /></Field>}
                </div>
              ))}
            {l.tracking === 'BATCH' && <p className="wide actions"><button type="button" className="linkish" onClick={() => set(l.item_id, { ...v, rows: [...rows, { batch: '', expiry: '', quantity: '' }] })}>Split across another batch</button></p>}
          </div>
        );
      })}
    </Card>
  );
};
const trackingBody = (lines, value) => lines.filter((l) => l.tracking && l.tracking !== 'NONE').flatMap((l) => {
  const v = value[l.item_id];
  if (!v) return [];
  if (l.tracking === 'SERIAL') { const serials = v.serials.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean); return serials.length ? [{ itemId: String(l.item_id), serials }] : []; }
  return v.rows.filter((r) => r.batch.trim()).map((r) => ({ itemId: String(l.item_id), batch: r.batch.trim(), ...(r.expiry && { expiry: r.expiry }), ...(r.quantity && { quantity: r.quantity }) }));
});

export const DocView = ({ kind }) => {
  const { id } = useParams();
  const { o, org } = useSession();
  const nav = useNavigate();
  const load = useLoad(() => o(`/${kind.api}/${id}`), [org.id, kind.api, id]);
  const a = useAction();
  const [panel, setPanel] = useState('');
  const [sent, setSent] = useState(0);
  const emailOn = useEmailOn();
  const [void_, setVoid] = useState({ date: today(), reason: '' });
  const [apply, setApply] = useState({});
  const [trk, setTrk] = useState({});
  const open = useLoad(() => (isNote(kind) && load.data?.status === 'ISSUED' ? o(`/${kind.api === 'credit-notes' ? 'invoices' : 'bills'}?status=ISSUED&partyId=${load.data.party_id}&limit=100`) : Promise.resolve(null)), [load.data?.id, load.data?.status]);

  const d0 = load.data || {};
  const convert = (to) => a.run(async () => { const r = await o(`/${kind.api}/${id}/convert`, { method: 'POST', body: { to, date: today() } }); nav(`/${PATH[to]}/${r.id}`); });
  const act = (fn, msg) => a.run(async () => { await fn(); await load.reload(); setPanel(''); }, msg);
  return (
    <Page title={load.data ? `${kind.one} ${load.data.number || '(draft)'}` : kind.one} lead={load.data && `${kind.who}: ${load.data.party_name}`}
      actions={load.data && <>
        {load.data.status === 'DRAFT' && <><Link className="btn" to={`/${kind.path}/${id}/edit`}>Edit</Link><Btn kind="primary" busy={a.busy} onClick={() => act(() => o(`/${kind.api}/${id}/issue`, { method: 'POST', body: { tracking: trackingBody(load.data.lines, trk) } }), kind.pre ? `${kind.one} sent.` : `${kind.one} issued and posted to the books.`)}>{kind.pre ? 'Mark as sent' : 'Issue'}</Btn>
          <Btn kind="danger" onClick={() => setPanel(panel === 'delete' ? '' : 'delete')}>Delete draft</Btn></>}
        {load.data.status === 'ISSUED' && <>
          {kind.paymentDirection && Number(load.data.balance_minor) > 0 && <Link className="btn primary" to={`/payments/new?direction=${kind.paymentDirection}&partyId=${load.data.party_id}&documentId=${id}`}>{kind.paymentDirection === 'IN' ? 'Record payment' : 'Pay this bill'}</Link>}
          {isNote(kind) && Number(load.data.balance_minor) > 0 && <Btn onClick={() => setPanel(panel === 'apply' ? '' : 'apply')}>{kind.api === 'credit-notes' ? 'Apply to invoices' : 'Apply to bills'}</Btn>}
          {kind.api === 'invoices' && <WhatsappButton kind="INVOICE" documentId={id} label="Send on WhatsApp" onDone={() => setSent((n) => n + 1)} />}
          {kind.api === 'invoices' && Number(load.data.balance_minor) > 0 && <WhatsappButton kind="REMINDER" documentId={id} label="Remind on WhatsApp" onDone={() => setSent((n) => n + 1)} />}
          {kind.pre && !d0.outcome && <><Btn onClick={() => act(() => o(`/${kind.api}/${id}/outcome`, { method: 'POST', body: { outcome: 'ACCEPTED' } }), 'Marked accepted.')}>{kind.who} accepted</Btn><Btn onClick={() => act(() => o(`/${kind.api}/${id}/outcome`, { method: 'POST', body: { outcome: 'DECLINED' } }), 'Marked declined.')}>{kind.who} declined</Btn></>}
          {kind.pre && d0.outcome !== 'CONVERTED' && d0.outcome !== 'DECLINED' && <>
            {kind.api === 'quotes' && <Btn onClick={() => convert('SALES_ORDER')}>Make sales order</Btn>}
            {kind.api === 'purchase-orders' ? <Btn kind="primary" onClick={() => convert('BILL')}>Make bill</Btn> : <Btn kind="primary" onClick={() => convert('INVOICE')}>Make invoice</Btn>}</>}
          {kind.api === 'invoices' && <Btn onClick={() => setPanel(panel === 'eway' ? '' : 'eway')}>E-way bill</Btn>}
          {emailOn && kind.api !== 'bills' && <Btn onClick={() => setPanel(panel === 'email' ? '' : 'email')}>Send email</Btn>}
          <Btn onClick={() => window.print()}>Print</Btn><Btn kind="danger" onClick={() => setPanel(panel === 'void' ? '' : 'void')}>Void</Btn></>}
      </>}>
      <Async load={load}>{(d) => (<>
        <Err>{a.error}</Err><Note>{a.done}</Note>
        {panel === 'email' && <EmailForm documentId={id} onDone={() => setSent((n) => n + 1)} onClose={() => setPanel('')} />}
        {panel === 'eway' && <EwayPanel id={id} number={d.number} onClose={() => setPanel('')} />}
        {d.status === 'DRAFT' && d.lines && !kind.pre && <TrackingPanel lines={d.lines} inward={kind.api === 'bills' || kind.api === 'credit-notes'} value={trk} onChange={setTrk} />}
        {d.status === 'ISSUED' && <DocSheet kind={kind} d={d} />}
        {panel === 'delete' && <Confirm><p>Delete this draft? It has no number and nothing is posted.</p><Btn kind="danger" busy={a.busy} onClick={() => a.run(async () => { await o(`/${kind.api}/${id}`, { method: 'DELETE' }); nav(`/${kind.path}`); })}>Yes, delete</Btn></Confirm>}
        {panel === 'void' && (
          <Confirm><p>Voiding reverses the entries in the books. Money already allocated to this {kind.one.toLowerCase()} must be unlinked first.</p>
            <div className="form"><Field label="Date of reversal"><input type="date" value={void_.date} onChange={(e) => setVoid({ ...void_, date: e.target.value })} /></Field>
              <Field label="Reason"><input value={void_.reason} onChange={(e) => setVoid({ ...void_, reason: e.target.value })} required /></Field></div>
            <p><Btn kind="danger" busy={a.busy} disabled={!void_.reason} onClick={() => act(() => o(`/${kind.api}/${id}/void`, { method: 'POST', body: void_ }), `${kind.one} voided.`)}>Void {kind.one.toLowerCase()}</Btn></p></Confirm>
        )}
        {panel === 'apply' && (
          <Confirm><p>Set this {kind.one.toLowerCase()} against open {kind.api === 'credit-notes' ? 'invoices' : 'bills'} (up to ₹{inr(d.balance_minor)}).</p>
            {(open.data?.documents || []).filter((x) => Number(x.balance_minor) > 0).map((x) => (
              <Field key={x.id} label={`${x.number} · due ₹${inr(x.balance_minor)}`}><input inputMode="decimal" value={apply[x.id] || ''} onChange={(e) => setApply({ ...apply, [x.id]: e.target.value })} /></Field>))}
            <p><Btn kind="primary" busy={a.busy} onClick={() => act(() => o(`/${kind.api}/${id}/apply`, { method: 'POST', body: { allocations: Object.entries(apply).filter(([, v]) => Number(v) > 0).map(([documentId, amount]) => ({ documentId, amount })) } }), 'Applied.')}>Apply</Btn></p></Confirm>
        )}

        <Card>
          <div className="actions" style={{ justifyContent: 'space-between' }}><Badge status={d.status} />{d.status === 'ISSUED' && d.journal_entry_id && <Link to={`/journals/${d.journal_entry_id}`}>See in the books</Link>}</div>
          <dl className="kv" style={{ marginTop: '.75rem' }}>
            <dt>Date</dt><dd>{showDate(d.issue_date)}</dd>
            {d.outcome && <><dt>Answer</dt><dd><Badge status={d.outcome} /></dd></>}
            {d.converted_document_id && <><dt>Turned into</dt><dd><Link to={`/${PATH[d.converted_kind]}/${d.converted_document_id}`}>See it</Link></dd></>}
            {d.related_document_id && PATH[d.related_kind] && !isNote(kind) && <><dt>Made from</dt><dd><Link to={`/${PATH[d.related_kind]}/${d.related_document_id}`}>See it</Link></dd></>}
            {d.currency !== 'INR' && <><dt>Currency</dt><dd>{d.currency} at ₹{String(d.fx_rate).replace(/0+$/, '').replace(/\.$/, '')} for 1 {d.currency}; the books and GST use rupees</dd></>}
            {d.due_date && <><dt>{kind.dueLabel || 'Due'}</dt><dd>{showDate(d.due_date)}</dd></>}
            {d.supplier_ref && <><dt>Vendor's number</dt><dd>{d.supplier_ref}</dd></>}
            {d.place_of_supply && <><dt>Place of supply</dt><dd>{d.place_of_supply} · {STATES[d.place_of_supply] || ''} ({d.inter_state ? 'other state: IGST' : 'same state: CGST + SGST'})</dd></>}
            {d.reverse_charge && <><dt>Reverse charge</dt><dd>Yes: the GST below is paid by you, not added to what the vendor is owed</dd></>}
            {d.memo && <><dt>Note</dt><dd>{d.memo}</dd></>}
            {d.project_id && <><dt>Project</dt><dd><Link to={`/projects/${d.project_id}`}>{d.project_name}</Link></dd></>}
          </dl>
        </Card>
        <Card title="Lines">
          <Table head={['#', 'Description', 'HSN/SAC', '>Qty', '>Price', 'GST', '>Taxable', '>Tax']}>
            {d.lines.map((l) => (<tr key={l.id}><td>{l.line_no}</td><td>{l.description}</td><td>{l.hsn_sac}</td><td className="r">{l.quantity}{l.unit ? ' ' + unitLabel(l.unit) : ''}</td><td className="r num">{inr(l.unit_price_minor)}</td><td>{l.tax_code} {l.tax_rate_bp != null ? `(${l.tax_rate_bp / 100}%)` : ''}</td><td className="r num">{inr(l.taxable_minor)}</td><td className="r num">{inr(l.tax_minor)}</td></tr>))}
          </Table>
          <div className="totals">
            <div><span>Subtotal</span><Money v={d.subtotal_minor} /></div><div><span>Tax</span><Money v={d.tax_minor} /></div>
            {Number(d.tcs_minor) > 0 && <div><span>TCS{d.tcs_section ? ` (${d.tcs_section})` : ''}</span><Money v={d.tcs_minor} /></div>}
            {Number(d.round_off_minor) !== 0 && <div><span>Round off</span><Money v={d.round_off_minor} /></div>}
            <div className="grand"><span>Total</span><Money v={d.total_minor} /></div>
            {d.currency !== 'INR' && <div><span>Total in {d.currency}</span><span className="num strong">{d.currency} {inr(d.foreign_total_minor)}</span></div>}
            {d.currency !== 'INR' && d.status === 'ISSUED' && !kind.pre && <div><span>Still to settle in {d.currency}</span><span className="num">{d.currency} {inr(d.foreign_balance_minor)}</span></div>}
            {d.status === 'ISSUED' && !kind.pre && <div><span>Still to settle</span><Money v={d.balance_minor} strong /></div>}
          </div>
          <p className="muted words">{amountInWords(d.total_minor)}</p>
        </Card>
        {kind.api === 'invoices' && <WhatsappLog documentId={id} refresh={sent} />}
        {kind.api !== 'bills' && <EmailLog documentId={id} refresh={sent} />}
        {d.allocations.length > 0 && (
          <Card title="Payments and credits against this">
            <Table head={['What', '>Amount', 'State']}>{d.allocations.map((x, i) => (<tr key={i}><td>{x.source_type === 'PAYMENT' ? <Link to={`/payments/${x.source_id}`}>Payment</Link> : 'Credit note'}</td><td className="r"><Money v={x.amount_minor} /></td><td>{x.voided ? <Badge status="VOID" /> : 'Counted'}</td></tr>))}</Table>
          </Card>
        )}
      </>)}</Async>
    </Page>
  );
};
