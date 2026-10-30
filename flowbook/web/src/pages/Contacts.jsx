import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoad } from '../api.js';
import { STATES, UNITS, isZero, unitLabel } from '../lib.js';
import { CsvImport } from './Import.jsx';
import { useSession } from '../session.jsx';
import { useSimple } from '../mode.js';
import { Term } from '../help.jsx';
import { Async, Badge, Btn, Card, Empty, Err, Field, Money, Note, Page, Table, useAction } from '../ui.jsx';

const blank = (kind) => ({ kind, name: '', gstin: '', pan: '', stateCode: '', phone: '', email: '', creditDays: '', addressLine: '', city: '', pincode: '', shipAddressLine: '', shipCity: '', shipPincode: '' });

/** Customers and vendors: a list with search, and a form that opens in place for adding or changing one. */
export const Parties = ({ kind }) => {
  const { o, org } = useSession();
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);   // null closed; {id?, ...fields}
  const [importing, setImporting] = useState(false);
  const simple = useSimple();
  const [more, setMore] = useState(false);   // Simple view asks for a name, phone and GSTIN; the rest is behind "More options"
  const adv = !simple || more;
  const a = useAction();
  const word = kind === 'CUSTOMER' ? 'customer' : 'vendor';
  const load = useLoad(() => o(`/parties?kind=${kind}&limit=500${q ? `&q=${encodeURIComponent(q)}` : ''}`), [org.id, kind, q]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      const { id, ...f } = form;
      const body = { kind: f.kind, name: f.name, ...(f.gstin && { gstin: f.gstin.toUpperCase() }), ...(f.pan && { pan: f.pan.toUpperCase() }), ...(f.stateCode && { stateCode: f.stateCode }), ...(f.phone && { phone: f.phone }), ...(f.email && { email: f.email }), ...(f.creditDays !== '' && { creditDays: Number(f.creditDays) }), ...Object.fromEntries(['addressLine', 'city', 'pincode', 'shipAddressLine', 'shipCity', 'shipPincode'].filter((k) => f[k] || id).map((k) => [k, f[k]])), ...(id && { whatsappOptOut: Boolean(f.whatsappOptOut) }) };
      if (id) await o(`/parties/${id}`, { method: 'PATCH', body }); else await o('/parties', { method: 'POST', body });
      setForm(null); await load.reload();
    }, `Saved.`);
  };
  const edit = (p) => { setMore(Boolean(p.pan || p.state_code || p.email || p.credit_days || p.address_line || p.city || p.pincode || p.ship_address_line)); setForm({ id: p.id, kind: p.kind, name: p.name, gstin: p.gstin || '', pan: p.pan || '', stateCode: p.state_code || '', phone: p.phone || '', email: p.email || '', creditDays: p.credit_days ?? '', whatsappOptOut: Boolean(p.whatsapp_opt_out), addressLine: p.address_line || '', city: p.city || '', pincode: p.pincode || '', shipAddressLine: p.ship_address_line || '', shipCity: p.ship_city || '', shipPincode: p.ship_pincode || '' }); };

  return (
    <Page title={`${word[0].toUpperCase()}${word.slice(1)}s`} lead={kind === 'CUSTOMER' ? 'People and businesses you sell to.' : 'People and businesses you buy from.'} actions={<><Btn onClick={() => setImporting(true)}>Import CSV</Btn><Btn kind="primary" onClick={() => { a.setError(''); a.setDone(''); setForm(blank(kind)); }}>Add {word}</Btn></>}>
      {importing && <CsvImport what="party" partyKind={kind} onDone={() => load.reload()} onClose={() => setImporting(false)} />}
      <Note>{a.done}</Note>
      {form && (
        <Card title={form.id ? `Edit ${word}` : `New ${word}`}>
          <Err>{a.error}</Err>
          {simple && <div className="more-bar"><Btn type="button" className="btn small" onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Fewer options' : 'More options'}</Btn></div>}
          <form className="form" onSubmit={save}>
            <Field label="Name" wide><input value={form.name} onChange={set('name')} required maxLength={160} /></Field>
            <Field label={<Term k="GSTIN">GSTIN</Term>} hint="15 characters, checked when saved. Leave empty if they have none"><input value={form.gstin} onChange={set('gstin')} maxLength={15} /></Field>
            {adv && <Field label="State" hint="Taken from the GSTIN when you leave it empty"><select value={form.stateCode} onChange={set('stateCode')}><option value="">Not set</option>{Object.entries(STATES).map(([c, n]) => <option key={c} value={String(c).padStart(2, '0')}>{String(c).padStart(2, '0')} · {n}</option>)}</select></Field>}
            <Field label="Phone"><input value={form.phone} onChange={set('phone')} maxLength={20} inputMode="tel" /></Field>
            {adv && <Field label="Email"><input type="email" value={form.email} onChange={set('email')} maxLength={200} /></Field>}
            {adv && <Field label="PAN"><input value={form.pan} onChange={set('pan')} maxLength={10} /></Field>}
            {adv && <Field label="Days to pay" hint="Sets the due date on new documents"><input inputMode="numeric" value={form.creditDays} onChange={set('creditDays')} /></Field>}
            {adv && <Field label="Address" wide><input value={form.addressLine} onChange={set('addressLine')} maxLength={200} /></Field>}
            {adv && <Field label="City"><input value={form.city} onChange={set('city')} maxLength={80} /></Field>}
            {adv && <Field label="PIN code" hint="Six digits; needed for an e-way bill"><input value={form.pincode} onChange={set('pincode')} maxLength={6} inputMode="numeric" /></Field>}
            {adv && <Field label="Deliver to (if different)" wide><input value={form.shipAddressLine} onChange={set('shipAddressLine')} maxLength={200} /></Field>}
            {adv && <Field label="Delivery city"><input value={form.shipCity} onChange={set('shipCity')} maxLength={80} /></Field>}
            {adv && <Field label="Delivery PIN code"><input value={form.shipPincode} onChange={set('shipPincode')} maxLength={6} inputMode="numeric" /></Field>}
            {form.id && <p className="check wide"><input id="wa-out" type="checkbox" checked={form.whatsappOptOut} onChange={(e) => setForm({ ...form, whatsappOptOut: e.target.checked })} /><label htmlFor="wa-out">Do not send WhatsApp messages to this {word} (they asked to stop)</label></p>}
            <div className="wide actions"><Btn kind="primary" busy={a.busy}>Save</Btn><Btn type="button" onClick={() => setForm(null)}>Cancel</Btn></div>
          </form>
        </Card>
      )}
      <Card>
        <Field label="Search"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find a ${word}`} /></Field>
        <Async load={load}>{(rows) => (
          <Table head={['Name', 'GSTIN', 'State', 'Phone', '']} empty={!rows.length && <Empty>No {word}s yet.</Empty>}>
            {rows.map((p) => (<tr key={p.id}><td>{p.name} {!p.active && <Badge status="VOID">inactive</Badge>}{p.external_ref && <span className="muted"> · from FlowXP</span>}</td><td>{p.gstin}</td><td>{p.state_code && `${p.state_code} ${STATES[p.state_code] || ''}`}</td><td>{p.phone}</td>
              <td className="r"><button className="linkish" onClick={() => edit(p)}>Edit</button></td></tr>))}
          </Table>
        )}</Async>
      </Card>
    </Page>
  );
};

export const Items = () => {
  const { o, org } = useSession();
  const [form, setForm] = useState(null);
  const [importing, setImporting] = useState(false);
  const load = useLoad(() => o('/items'), [org.id]);
  const rates = useLoad(() => o('/tax-rates'), [org.id]);
  const a = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const codes = [...new Set((rates.data || []).map((r) => r.code))];
  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      await o('/items', { method: 'POST', body: { sku: form.sku, name: form.name, kind: form.kind, ...(form.hsnSac && { hsnSac: form.hsnSac }), ...(form.unit && { unit: form.unit }), taxCode: form.taxCode, ...(form.salePrice && { salePrice: form.salePrice }), ...(form.purchasePrice && { purchasePrice: form.purchasePrice }), ...(form.kind === 'GOODS' && form.trackStock && { trackStock: true, ...(form.tracking && form.tracking !== 'NONE' && { tracking: form.tracking }), ...(form.reorderLevel && { reorderLevel: form.reorderLevel }) }) } });
      setForm(null); await load.reload();
    }, 'Item added.');
  };
  return (
    <Page title="Items" lead="Products and services you sell or buy. Pick them on a line to fill in the price and GST." actions={<><Btn onClick={() => setImporting(true)}>Import CSV</Btn><Btn kind="primary" onClick={() => { a.setError(''); a.setDone(''); setForm({ sku: '', name: '', kind: 'GOODS', hsnSac: '', unit: 'NOS', taxCode: 'GST18', salePrice: '', purchasePrice: '', trackStock: false, reorderLevel: '' }); }}>Add item</Btn></>}>
      {importing && <CsvImport what="item" onDone={() => load.reload()} onClose={() => setImporting(false)} />}
      <Note>{a.done}</Note>
      {form && (
        <Card title="New item"><Err>{a.error}</Err>
          <form className="form" onSubmit={save}>
            <Field label="Code (SKU)"><input value={form.sku} onChange={set('sku')} required maxLength={60} /></Field>
            <Field label="Name"><input value={form.name} onChange={set('name')} required maxLength={160} /></Field>
            <Field label="Kind"><select value={form.kind} onChange={set('kind')}><option value="GOODS">Goods</option><option value="SERVICE">Service</option></select></Field>
            <Field label="HSN / SAC"><input value={form.hsnSac} onChange={set('hsnSac')} maxLength={12} /></Field>
            <Field label="Unit" hint="Needed for the GST return"><select value={form.unit} onChange={set('unit')}>{UNITS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></Field>
            <Field label="GST"><select value={form.taxCode} onChange={set('taxCode')}>{(codes.length ? codes : ['GST18']).map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Selling price (₹)"><input inputMode="decimal" value={form.salePrice} onChange={set('salePrice')} /></Field>
            <Field label="Buying price (₹)"><input inputMode="decimal" value={form.purchasePrice} onChange={set('purchasePrice')} /></Field>
            {form.kind === 'GOODS' && <p className="check wide"><input id="trk" type="checkbox" checked={form.trackStock} onChange={(e) => setForm({ ...form, trackStock: e.target.checked })} /><label htmlFor="trk">Count its stock (buying adds, selling takes away)</label></p>}
            {form.kind === 'GOODS' && form.trackStock && <Field label="How to count it" hint="By batch for medicines or food that expire; by serial number for items like phones. Cannot be changed once stock moves"><select value={form.tracking || 'NONE'} onChange={set('tracking')}><option value="NONE">Just a quantity</option><option value="BATCH">By batch (with expiry date)</option><option value="SERIAL">By serial number</option></select></Field>}
            {form.kind === 'GOODS' && form.trackStock && <Field label="Warn me when it falls to" hint="Optional"><input inputMode="decimal" value={form.reorderLevel} onChange={set('reorderLevel')} /></Field>}
            <div className="wide actions"><Btn kind="primary" busy={a.busy}>Save</Btn><Btn type="button" onClick={() => setForm(null)}>Cancel</Btn></div>
          </form></Card>
      )}
      <Card><Async load={load}>{(rows) => (
        <Table head={['Code', 'Name', 'Kind', 'HSN/SAC', 'Unit', 'GST', '>Sells at', '>Buys at']} empty={!rows.length && <Empty>No items yet. You can also type lines by hand on an invoice.</Empty>}>
          {rows.map((i) => (<tr key={i.id}><td>{i.sku}</td><td>{i.name}</td><td>{i.kind === 'SERVICE' ? 'Service' : 'Goods'}</td><td>{i.hsn_sac}</td><td>{unitLabel(i.unit)}</td><td>{i.tax_code}</td><td className="r">{!isZero(i.sale_price_minor) && <Money v={i.sale_price_minor} />}</td><td className="r">{!isZero(i.purchase_price_minor) && <Money v={i.purchase_price_minor} />}</td></tr>))}
        </Table>
      )}</Async></Card>
      <p className="muted"><Link to="/settings">GST rates</Link> are set in Settings.</p>
    </Page>
  );
};
