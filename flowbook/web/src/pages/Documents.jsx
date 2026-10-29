/* Invoices, bills and credit notes share one set of screens: a list, a form for the draft, and a page for the document. */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLoad } from '../api.js';
import { STATES, addDays, inr, showDate, today } from '../lib.js';
import { useSession } from '../session.jsx';
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
          <Table head={['Number', kind.who, 'Date', 'Due', 'Status', '>Total', '>Balance']} empty={!rows.length && <Empty>Nothing here yet.</Empty>}>
            {rows.map((d) => (
              <tr key={d.id} className="click" onClick={() => nav(`/${kind.path}/${d.id}`)}>
                <td><Link to={`/${kind.path}/${d.id}`}>{d.number || 'Draft'}</Link></td><td>{d.party_name}</td><td>{showDate(d.issue_date)}</td><td>{showDate(d.due_date)}</td>
                <td><Badge status={d.status} /></td><td className="r"><Money v={d.total_minor} /></td><td className="r">{d.status === 'ISSUED' ? <Money v={d.balance_minor} /> : ''}</td>
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

const blankLine = () => ({ itemId: '', description: '', hsnSac: '', quantity: '1', unitPrice: '', discount: '', taxCode: 'GST18' });

export const DocForm = ({ kind }) => {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { o, org } = useSession();
  const nav = useNavigate();
  const a = useAction();
  const parties = useLoad(() => o(`/parties?kind=${kind.partyKind}&limit=500`), [org.id, kind.partyKind]);
  const items = useLoad(() => o('/items'), [org.id]);
  const rates = useLoad(() => o('/tax-rates'), [org.id]);
  const existing = useLoad(() => (id ? o(`/${kind.api}/${id}`) : Promise.resolve(null)), [org.id, id]);
  const [f, setF] = useState({ partyId: '', date: today(), dueDate: '', placeOfSupply: '', supplierRef: '', relatedDocumentId: '', memo: '', roundOff: true, lines: [blankLine()] });
  const invoices = useLoad(() => (kind.api === 'credit-notes' && f.partyId ? o(`/invoices?status=ISSUED&partyId=${f.partyId}&limit=100`) : Promise.resolve(null)), [org.id, f.partyId, kind.api]);

  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setF({ partyId: String(d.party_id), date: d.issue_date || today(), dueDate: d.due_date || '', placeOfSupply: d.place_of_supply || '', supplierRef: d.supplier_ref || '', relatedDocumentId: d.related_document_id ? String(d.related_document_id) : '',
      memo: d.memo || '', roundOff: Number(d.round_off_minor) !== 0 || d.status === 'DRAFT', lines: d.lines.map((l) => ({ itemId: l.item_id ? String(l.item_id) : '', description: l.description || '', hsnSac: l.hsn_sac || '', quantity: l.quantity, unitPrice: l.unit_price_minor, discount: Number(l.discount_minor) ? l.discount_minor : '', taxCode: l.tax_code || '' })) });
  }, [existing.data]);
  useEffect(() => { if (!id && search.get('partyId')) setF((x) => ({ ...x, partyId: search.get('partyId') })); }, [id, search]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setLine = (i, patch) => setF({ ...f, lines: f.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) });
  const pickItem = (i, itemId) => {
    const it = (items.data || []).find((x) => String(x.id) === itemId);
    setLine(i, it ? { itemId, description: it.name, hsnSac: it.hsn_sac || '', taxCode: it.tax_code || 'GST18', unitPrice: (kind.api === 'bills' ? it.purchase_price_minor : it.sale_price_minor) || '' } : { itemId: '' });
  };
  const codes = [...new Set((rates.data || []).map((r) => r.code))];

  const submit = (e) => {
    e.preventDefault();
    a.run(async () => {
      const body = { partyId: f.partyId, date: f.date, roundOff: f.roundOff, memo: f.memo || undefined, dueDate: f.dueDate || undefined, placeOfSupply: f.placeOfSupply || undefined,
        supplierRef: kind.api === 'bills' ? f.supplierRef || undefined : undefined, relatedDocumentId: f.relatedDocumentId || undefined,
        lines: f.lines.map((l) => ({ itemId: l.itemId || undefined, description: l.description || undefined, hsnSac: l.hsnSac || undefined, quantity: String(l.quantity), unitPrice: String(l.unitPrice || '0'), discount: l.discount ? String(l.discount) : undefined, taxCode: l.taxCode || undefined })) };
      const out = id ? await o(`/${kind.api}/${id}`, { method: 'PUT', body }) : await o(`/${kind.api}`, { method: 'POST', body });
      nav(`/${kind.path}/${out.id}`);
    });
  };

  const party = (parties.data || []).find((p) => String(p.id) === f.partyId);
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
            {kind.api !== 'credit-notes' && <Field label="Due date" hint={party?.credit_days ? `${party.name} usually gets ${party.credit_days} days` : 'Optional'}><input type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>}
            <Field label="Place of supply" hint="Leave empty to use the party's state"><select value={f.placeOfSupply} onChange={set('placeOfSupply')}><option value="">Automatic</option>{Object.entries(STATES).map(([c, n]) => <option key={c} value={String(c).padStart(2, '0')}>{String(c).padStart(2, '0')} · {n}</option>)}</select></Field>
            {kind.api === 'bills' && <Field label="Vendor's bill number"><input value={f.supplierRef} onChange={set('supplierRef')} maxLength={60} /></Field>}
            {kind.api === 'credit-notes' && (
              <Field label="Against invoice" hint="Optional">
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
                <Field label="Price (₹)"><input inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} required /></Field>
                <Field label="Discount (₹)"><input inputMode="decimal" value={l.discount} onChange={(e) => setLine(i, { discount: e.target.value })} /></Field>
                <Field label="GST"><select value={l.taxCode} onChange={(e) => setLine(i, { taxCode: e.target.value })}>{codes.length ? codes.map((c) => <option key={c}>{c}</option>) : <option>{l.taxCode}</option>}</select></Field>
                <Btn type="button" className="btn small danger" disabled={f.lines.length === 1} onClick={() => setF({ ...f, lines: f.lines.filter((_, n) => n !== i) })} aria-label="Remove line">Remove</Btn>
              </div>
            ))}
          </div>
          <p className="check"><input id="ro" type="checkbox" checked={f.roundOff} onChange={set('roundOff')} /><label htmlFor="ro">Round the total to the nearest rupee</label></p>
        </Card>
        <div className="actions"><Btn kind="primary" busy={a.busy}>Save draft</Btn><Btn type="button" onClick={() => nav(-1)}>Cancel</Btn></div>
      </form>
    </Page>
  );
};

export const DocView = ({ kind }) => {
  const { id } = useParams();
  const { o, org } = useSession();
  const nav = useNavigate();
  const load = useLoad(() => o(`/${kind.api}/${id}`), [org.id, kind.api, id]);
  const a = useAction();
  const [panel, setPanel] = useState('');
  const [void_, setVoid] = useState({ date: today(), reason: '' });
  const [apply, setApply] = useState({});
  const open = useLoad(() => (kind.api === 'credit-notes' && load.data?.status === 'ISSUED' ? o(`/invoices?status=ISSUED&partyId=${load.data.party_id}&limit=100`) : Promise.resolve(null)), [load.data?.id, load.data?.status]);

  const act = (fn, msg) => a.run(async () => { await fn(); await load.reload(); setPanel(''); }, msg);
  return (
    <Page title={load.data ? `${kind.one} ${load.data.number || '(draft)'}` : kind.one} lead={load.data && `${kind.who}: ${load.data.party_name}`}
      actions={load.data && <>
        {load.data.status === 'DRAFT' && <><Link className="btn" to={`/${kind.path}/${id}/edit`}>Edit</Link><Btn kind="primary" busy={a.busy} onClick={() => act(() => o(`/${kind.api}/${id}/issue`, { method: 'POST', body: {} }), `${kind.one} issued and posted to the books.`)}>Issue</Btn>
          <Btn kind="danger" onClick={() => setPanel(panel === 'delete' ? '' : 'delete')}>Delete draft</Btn></>}
        {load.data.status === 'ISSUED' && <>
          {kind.paymentDirection && Number(load.data.balance_minor) > 0 && <Link className="btn primary" to={`/payments/new?direction=${kind.paymentDirection}&partyId=${load.data.party_id}&documentId=${id}`}>{kind.paymentDirection === 'IN' ? 'Record payment' : 'Pay this bill'}</Link>}
          {kind.api === 'credit-notes' && Number(load.data.balance_minor) > 0 && <Btn onClick={() => setPanel(panel === 'apply' ? '' : 'apply')}>Apply to invoices</Btn>}
          <Btn onClick={() => window.print()}>Print</Btn><Btn kind="danger" onClick={() => setPanel(panel === 'void' ? '' : 'void')}>Void</Btn></>}
      </>}>
      <Async load={load}>{(d) => (<>
        <Err>{a.error}</Err><Note>{a.done}</Note>
        {panel === 'delete' && <Confirm><p>Delete this draft? It has no number and nothing is posted.</p><Btn kind="danger" busy={a.busy} onClick={() => a.run(async () => { await o(`/${kind.api}/${id}`, { method: 'DELETE' }); nav(`/${kind.path}`); })}>Yes, delete</Btn></Confirm>}
        {panel === 'void' && (
          <Confirm><p>Voiding reverses the entries in the books. Money already allocated to this {kind.one.toLowerCase()} must be unlinked first.</p>
            <div className="form"><Field label="Date of reversal"><input type="date" value={void_.date} onChange={(e) => setVoid({ ...void_, date: e.target.value })} /></Field>
              <Field label="Reason"><input value={void_.reason} onChange={(e) => setVoid({ ...void_, reason: e.target.value })} required /></Field></div>
            <p><Btn kind="danger" busy={a.busy} disabled={!void_.reason} onClick={() => act(() => o(`/${kind.api}/${id}/void`, { method: 'POST', body: void_ }), `${kind.one} voided.`)}>Void {kind.one.toLowerCase()}</Btn></p></Confirm>
        )}
        {panel === 'apply' && (
          <Confirm><p>Set this credit note against open invoices (up to ₹{inr(d.balance_minor)}).</p>
            {(open.data?.documents || []).filter((x) => Number(x.balance_minor) > 0).map((x) => (
              <Field key={x.id} label={`${x.number} · due ₹${inr(x.balance_minor)}`}><input inputMode="decimal" value={apply[x.id] || ''} onChange={(e) => setApply({ ...apply, [x.id]: e.target.value })} /></Field>))}
            <p><Btn kind="primary" busy={a.busy} onClick={() => act(() => o(`/credit-notes/${id}/apply`, { method: 'POST', body: { allocations: Object.entries(apply).filter(([, v]) => Number(v) > 0).map(([documentId, amount]) => ({ documentId, amount })) } }), 'Applied.')}>Apply</Btn></p></Confirm>
        )}

        <Card>
          <div className="actions" style={{ justifyContent: 'space-between' }}><Badge status={d.status} />{d.status === 'ISSUED' && d.journal_entry_id && <Link to={`/journals/${d.journal_entry_id}`}>See in the books</Link>}</div>
          <dl className="kv" style={{ marginTop: '.75rem' }}>
            <dt>Date</dt><dd>{showDate(d.issue_date)}</dd>
            {d.due_date && <><dt>Due</dt><dd>{showDate(d.due_date)}</dd></>}
            {d.supplier_ref && <><dt>Vendor's number</dt><dd>{d.supplier_ref}</dd></>}
            {d.place_of_supply && <><dt>Place of supply</dt><dd>{d.place_of_supply} · {STATES[d.place_of_supply] || ''} ({d.inter_state ? 'other state: IGST' : 'same state: CGST + SGST'})</dd></>}
            {d.memo && <><dt>Note</dt><dd>{d.memo}</dd></>}
          </dl>
        </Card>
        <Card title="Lines">
          <Table head={['#', 'Description', 'HSN/SAC', '>Qty', '>Price', 'GST', '>Taxable', '>Tax']}>
            {d.lines.map((l) => (<tr key={l.id}><td>{l.line_no}</td><td>{l.description}</td><td>{l.hsn_sac}</td><td className="r">{l.quantity}</td><td className="r num">{inr(l.unit_price_minor)}</td><td>{l.tax_code} {l.tax_rate_bp != null ? `(${l.tax_rate_bp / 100}%)` : ''}</td><td className="r num">{inr(l.taxable_minor)}</td><td className="r num">{inr(l.tax_minor)}</td></tr>))}
          </Table>
          <div className="totals">
            <div><span>Subtotal</span><Money v={d.subtotal_minor} /></div><div><span>Tax</span><Money v={d.tax_minor} /></div>
            {Number(d.round_off_minor) !== 0 && <div><span>Round off</span><Money v={d.round_off_minor} /></div>}
            <div className="grand"><span>Total</span><Money v={d.total_minor} /></div>
            {d.status === 'ISSUED' && <div><span>Still to settle</span><Money v={d.balance_minor} strong /></div>}
          </div>
        </Card>
        {d.allocations.length > 0 && (
          <Card title="Payments and credits against this">
            <Table head={['What', '>Amount', 'State']}>{d.allocations.map((x, i) => (<tr key={i}><td>{x.source_type === 'PAYMENT' ? <Link to={`/payments/${x.source_id}`}>Payment</Link> : 'Credit note'}</td><td className="r"><Money v={x.amount_minor} /></td><td>{x.voided ? <Badge status="VOID" /> : 'Counted'}</td></tr>))}</Table>
          </Card>
        )}
      </>)}</Async>
    </Page>
  );
};
