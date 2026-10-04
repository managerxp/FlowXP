/*
 * Principals and brands: the manufacturers you distribute, their agreements, the brands and products that belong to each,
 * and what is owed between you. A principal is also a supplier, so purchase orders, goods receipts and payments to it
 * work exactly as they do for any supplier.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Factory, Pencil, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { AGREEMENT, dateText, fetchAll, money, qs, saveCsv, useDebounced, useLoad } from '../../lib/distributor.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Table, Td, Textarea, Th, Thead, Tr, useToast, PageLoader } from '../../components/ui.jsx';
import { Chips, NumberField, Pager, Panel, StatusPill, Tabs, Toolbar, useAction } from '../wholesale/parts.jsx';
import { ProductPicker } from '../wholesale/parts.jsx';


const blank = { name: '', company_name: '', contact_person: '', phone: '', email: '', gstin: '', pan: '', address: '', territory_note: '', agreement_start: '', agreement_end: '', margin_pct: '', payment_terms_days: '', credit_limit: '', notes: '' };

const PrincipalForm = ({ principal, onClose, onSaved }) => {
  const toast = useToast();
  const editing = Boolean(principal?.principal_id);
  const [f, setF] = useState(() => (editing ? Object.fromEntries(Object.keys(blank).map((k) => [k, principal[k] ?? ''])) : blank));
  const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault(); setError('');
    const n = (v) => (v === '' ? null : Number(v));
    const body = { ...f, margin_pct: n(f.margin_pct) ?? 0, payment_terms_days: n(f.payment_terms_days), credit_limit: n(f.credit_limit) ?? 0, agreement_start: f.agreement_start || null, agreement_end: f.agreement_end || null };
    try {
      const r = await run(() => api(editing ? `/distributor/principals/${principal.principal_id}` : '/distributor/principals', { method: editing ? 'PUT' : 'POST', body }), editing ? 'Principal updated' : 'Principal added');
      if (r) onSaved(r);
    } catch (err) { setError(err.message); }
    void toast;
  };
  return (
    <Modal title={editing ? 'Edit principal' : 'Add a principal'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pf-name" label="Principal / brand name"><Input id="pf-name" value={f.name} onChange={set('name')} required autoFocus maxLength={120} /></Field>
          <Field id="pf-company" label="Company name" hint="As on their invoices"><Input id="pf-company" value={f.company_name} onChange={set('company_name')} maxLength={160} /></Field>
          <Field id="pf-contact" label="Contact person"><Input id="pf-contact" value={f.contact_person} onChange={set('contact_person')} /></Field>
          <Field id="pf-phone" label="Phone"><Input id="pf-phone" type="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field id="pf-email" label="Email"><Input id="pf-email" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field id="pf-gstin" label="GSTIN"><Input id="pf-gstin" value={f.gstin} onChange={(e) => setF((x) => ({ ...x, gstin: e.target.value.toUpperCase() }))} maxLength={15} /></Field>
          <Field id="pf-pan" label="PAN"><Input id="pf-pan" value={f.pan} onChange={(e) => setF((x) => ({ ...x, pan: e.target.value.toUpperCase() }))} maxLength={10} /></Field>
          <Field id="pf-territory" label="Territory they appointed you for"><Input id="pf-territory" value={f.territory_note} onChange={set('territory_note')} maxLength={200} /></Field>
          <div className="sm:col-span-2"><Field id="pf-address" label="Address"><Textarea id="pf-address" rows={2} value={f.address} onChange={set('address')} /></Field></div>
          <Field id="pf-start" label="Agreement starts"><Input id="pf-start" type="date" value={f.agreement_start ? String(f.agreement_start).slice(0, 10) : ''} onChange={set('agreement_start')} /></Field>
          <Field id="pf-end" label="Agreement ends"><Input id="pf-end" type="date" value={f.agreement_end ? String(f.agreement_end).slice(0, 10) : ''} onChange={set('agreement_end')} /></Field>
          <NumberField id="pf-margin" label="Margin / commission" suffix="%" hint="What the agreement lets you earn" value={f.margin_pct} onChange={set('margin_pct')} />
          <NumberField id="pf-terms" label="Payment terms" suffix="days" step={1} value={f.payment_terms_days} onChange={set('payment_terms_days')} />
          <NumberField id="pf-limit" label="Credit limit they give you" prefix="₹" value={f.credit_limit} onChange={set('credit_limit')} />
          <div className="sm:col-span-2"><Field id="pf-notes" label="Notes"><Textarea id="pf-notes" rows={2} value={f.notes} onChange={set('notes')} /></Field></div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{editing ? 'Save changes' : 'Add principal'}</Button></div>
      </form>
    </Modal>
  );
};

/** Pick products and tag them to the principal (and a brand) in one go. */
const AssignProducts = ({ principal, brands, onClose, onDone }) => {
  const [picked, setPicked] = useState([]);
  const [brandId, setBrandId] = useState('');
  const [busy, run] = useAction();
  const save = async () => { const r = await run(() => api(`/distributor/principals/${principal.principal_id}/assign-products`, { method: 'POST', body: { product_ids: picked.map((p) => p.product_id), brand_id: brandId || null } }), 'Products assigned'); if (r) onDone(); };
  return (
    <Modal title={`Add products to ${principal.name}`} onClose={onClose}>
      <div className="space-y-4">
        <ProductPicker onPick={(p) => setPicked((l) => (l.some((x) => x.product_id === p.product_id) ? l : [...l, p]))} placeholder="Search products to add" autoFocus />
        {picked.length > 0 && <ul className="divide-y divide-line rounded-lg border border-line">{picked.map((p) => <li key={p.product_id} className="flex items-center justify-between px-3 py-2 text-small"><span>{p.name}<span className="ml-2 text-caption text-ink-500">{p.sku}</span></span><button type="button" className="text-caption text-danger" onClick={() => setPicked((l) => l.filter((x) => x.product_id !== p.product_id))}>Remove</button></li>)}</ul>}
        <Field id="ap-brand" label="Brand (optional)" hint="Tags the same brand on all of them"><select id="ap-brand" className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-small" value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">Leave as it is</option>{brands.map((b) => <option key={b.brand_id} value={b.brand_id}>{b.name}</option>)}</select></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!picked.length}>Add {picked.length || ''} product{picked.length === 1 ? '' : 's'}</Button></div>
      </div>
    </Modal>
  );
};

const PrincipalDetail = ({ id, onClose, onChanged }) => {
  const { can } = useAuth();
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [brandName, setBrandName] = useState('');
  const [busy, run] = useAction();
  const { data: p, reload } = useLoad(`/distributor/principals/${id}`);
  const products = useLoad(tab === 'products' ? `/distributor/principals/${id}/products?limit=100` : null, { paged: true });
  const edit = can('principals');
  const addBrand = async (e) => { e.preventDefault(); if (!brandName.trim()) return; const r = await run(() => api('/distributor/brands', { method: 'POST', body: { name: brandName.trim(), principal_id: id } }), 'Brand added'); if (r) { setBrandName(''); reload(); onChanged(); } };
  return (
    <Modal title={p ? p.name : 'Principal'} onClose={onClose} wide>
      {!p ? <PageLoader compact /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><StatusPill map={AGREEMENT} status={p.agreement_status} />{p.status === 'INACTIVE' && <Badge>Inactive</Badge>}<span className="text-small text-ink-500">{[p.company_name, p.gstin].filter(Boolean).join(' · ')}</span>
            {edit && <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setEditing(true)}><Pencil aria-hidden="true" className="h-4 w-4" />Edit</Button>}</div>
          <Tabs tabs={[{ key: 'overview', label: 'Overview' }, { key: 'products', label: `Products${p.products ? ` (${p.products})` : ''}` }]} value={tab} onChange={setTab} />
          {tab === 'overview' && (
            <div className="grid gap-4 md:grid-cols-2">
              <Panel title="Agreement">
                <dl className="space-y-1.5 text-small">
                  {[['Contact', [p.contact_person, p.phone, p.email].filter(Boolean).join(' · ') || '—'], ['Territory', p.territory_note || '—'], ['Agreement', p.agreement_start || p.agreement_end ? `${p.agreement_start ? dateText(p.agreement_start) : '…'} to ${p.agreement_end ? dateText(p.agreement_end) : 'open'}` : '—'],
                    ['Margin', `${p.margin_pct}%`], ['Payment terms', p.payment_terms_days != null ? `${p.payment_terms_days} days` : '—'], ['Credit limit', p.credit_limit ? money(p.credit_limit) : '—']].map(([a, b]) => <div key={a} className="flex justify-between gap-4"><dt className="text-ink-500">{a}</dt><dd className="text-right">{b}</dd></div>)}
                </dl>
              </Panel>
              <Panel title="Account" action={p.supplier_id ? <Button to={`/app/wholesale/suppliers/${p.supplier_id}`} variant="ghost" size="sm">Ledger</Button> : undefined}>
                {p.account ? (
                  <dl className="space-y-1.5 text-small">
                    {[['Goods received', p.account.purchased], ['Returned', -p.account.returned], ['Paid', -p.account.paid], ['Adjustments', p.account.adjustments], ['Opening balance', p.account.opening]].map(([a, b]) => <div key={a} className="flex justify-between"><dt className="text-ink-500">{a}</dt><dd className="tabular">{money(b)}</dd></div>)}
                    <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>You owe</dt><dd className="tabular">{money(p.account.outstanding)}</dd></div>
                  </dl>
                ) : <p className="text-small text-ink-500">No supplier account is linked yet.</p>}
                {can('purchases') && <Button to="/app/wholesale/purchasing/new" variant="secondary" className="mt-3">New purchase order</Button>}
              </Panel>
              <div className="md:col-span-2">
                <Panel title="Brands" lead="Products are grouped under the brands each principal owns">
                  {p.brands.length === 0 ? <p className="text-small text-ink-500">No brands yet.</p> : <ul className="flex flex-wrap gap-2">{p.brands.map((b) => <li key={b.brand_id}><Badge tone="brand">{b.name} · {b.products} product{b.products === 1 ? '' : 's'}</Badge></li>)}</ul>}
                  {edit && <form onSubmit={addBrand} className="mt-4 flex max-w-sm gap-2"><Input aria-label="New brand name" placeholder="New brand name" value={brandName} onChange={(e) => setBrandName(e.target.value)} maxLength={80} /><Button type="submit" variant="secondary" loading={busy} disabled={brandName.trim().length < 2}>Add</Button></form>}
                </Panel>
              </div>
            </div>
          )}
          {tab === 'products' && (
            <div>
              {edit && <div className="mb-3 flex justify-end"><Button variant="secondary" onClick={() => setAssigning(true)}><Plus aria-hidden="true" className="h-4 w-4" />Add products</Button></div>}
              <ListState loading={products.loading && !products.data} error={products.error} empty={products.data?.length === 0} emptyIcon={Factory} emptyLabel="No products yet" emptyBody="Add the products this principal supplies so they can be reported by principal." />
              {products.data?.length > 0 && <Table><Thead><Th>Product</Th><Th>Brand</Th><Th className="text-right">MRP</Th><Th className="text-right">Principal price</Th><Th className="text-right">Our cost</Th><Th className="text-right">In stock</Th></Thead>
                <tbody>{products.data.map((x) => <Tr key={x.product_id}><Td><span className="font-medium">{x.name}</span><span className="block text-caption text-ink-500">{x.sku}</span></Td><Td>{x.brand || '—'}</Td><Td className="text-right tabular">{money(x.mrp)}</Td><Td className="text-right tabular">{x.principal_price == null ? '—' : money(x.principal_price)}</Td><Td className="text-right tabular">{money(x.purchase_price)}</Td><Td className="text-right tabular">{x.on_hand} {x.unit}</Td></Tr>)}</tbody></Table>}
            </div>
          )}
          {editing && <PrincipalForm principal={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); onChanged(); }} />}
          {assigning && <AssignProducts principal={p} brands={p.brands} onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); setTab('products'); reload(); onChanged(); }} />}
        </div>
      )}
      <p className="mt-4 text-caption text-ink-500">Need to change where a product sits? Open it under <Link to="/app/wholesale/products" className="font-semibold text-brand-600">Products &amp; pricing</Link>.</p>
    </Modal>
  );
};

const Principals = () => {
  const { can } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);
  const [stamp, setStamp] = useState(0);
  const term = useDebounced(q.trim(), 250);
  const query = useMemo(() => qs({ q: term, status, limit: 50, offset, k: stamp }), [term, status, offset, stamp]);
  const { data, meta, loading, error } = useLoad(`/distributor/principals${query}`, { paged: true });
  const exportCsv = async () => { try { const rows = await fetchAll(`/distributor/principals${qs({ status: 'ALL' })}`); saveCsv('principals.csv', ['name', 'company_name', 'contact_person', 'phone', 'email', 'gstin', 'pan', 'margin_pct', 'payment_terms_days', 'agreement_start', 'agreement_end', 'payable'].map((k) => ({ key: k, label: k.replace(/_/g, ' ') })), rows); } catch (e) { toast.error(e.message); } };
  return (
    <div>
      <PageHeader title="Principals & brands" lead="The manufacturers you distribute, their agreements, brands and products."
                  action={<>{can('export') && <Button variant="secondary" onClick={exportCsv}><Download aria-hidden="true" className="h-4 w-4" />Export</Button>}{can('principals') && <Button onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />Add principal</Button>}</>} />
      <Toolbar><div className="w-full sm:w-72"><Input type="search" placeholder="Name, company or GSTIN" aria-label="Search principals" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div>
        <Chips label="Status" value={status} onChange={(v) => { setStatus(v); setOffset(0); }} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }, { value: 'ALL', label: 'All' }]} /></Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={Factory} emptyLabel="No principals here" emptyBody={term ? 'Nothing matches that search.' : 'Add the manufacturers or brands you distribute.'} emptyAction={can('principals') && !term ? <Button onClick={() => setAdding(true)}>Add a principal</Button> : undefined} />
      {data?.length > 0 && <><Table><Thead><Th>Principal</Th><Th>Contact</Th><Th>Agreement</Th><Th className="text-right">Margin</Th><Th className="text-right">Brands</Th><Th className="text-right">Products</Th><Th className="text-right">You owe</Th></Thead>
        <tbody>{data.map((p) => <Tr key={p.principal_id} onClick={() => setOpen(p.principal_id)}><Td><span className="font-medium text-brand-700">{p.name}</span><span className="block text-caption text-ink-500">{p.company_name || p.gstin || ''}</span></Td><Td className="text-ink-700">{[p.contact_person, p.phone].filter(Boolean).join(' · ') || '—'}</Td>
          <Td><StatusPill map={AGREEMENT} status={p.agreement_status} />{p.agreement_end && <span className="ml-2 text-caption text-ink-500">to {dateText(p.agreement_end)}</span>}</Td><Td className="text-right tabular">{p.margin_pct}%</Td><Td className="text-right tabular">{p.brands}</Td><Td className="text-right tabular">{p.products}</Td><Td className={`text-right tabular ${p.payable > 0 ? 'font-semibold' : 'text-ink-400'}`}>{p.payable > 0 ? money(p.payable) : '—'}</Td></Tr>)}</tbody></Table><Pager meta={meta} onPage={setOffset} /></>}
      {adding && <PrincipalForm onClose={() => setAdding(false)} onSaved={(p) => { setAdding(false); setStamp((n) => n + 1); setOpen(p.principal_id); }} />}
      {open && <PrincipalDetail id={open} onClose={() => setOpen(null)} onChanged={() => setStamp((n) => n + 1)} />}
    </div>
  );
};

export default Principals;
