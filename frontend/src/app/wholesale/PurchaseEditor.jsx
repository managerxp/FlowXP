/*
 * A purchase order in the supplier’s units: pick the supplier and warehouse, add products by name or barcode in the
 * unit you buy them in (a carton, a box), set the cost, and save as a draft. A purchase manager approves it, which
 * orders it; goods are then received against it.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, qty, useLoad } from '../../lib/wholesale.js';
import { Alert, Button, Field, Input, PageHeader, Select, Skeleton, Textarea, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, ProductPicker, SupplierPicker, WarehouseSelect } from './parts.jsx';

let seq = 0;

const PurchaseEditor = () => {
  const { id } = useParams();
  const editing = Boolean(id);
  const toast = useToast();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [supplier, setSupplier] = useState(null);
  const [warehouse, setWarehouse] = useState('');
  const [lines, setLines] = useState([]);
  const [f, setF] = useState({ expected_date: '', payment_terms_days: '', notes: '' });
  const [loaded, setLoaded] = useState(!editing);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  useEffect(() => {
    if (editing) {
      api(`/wholesale/purchase-orders/${id}`).then(async (po) => {
        if (po.status !== 'DRAFT') { setLoadError('Only a draft purchase order can be edited. Cancel it and raise a new one to change an ordered one.'); return; }
        const sup = await api(`/wholesale/suppliers/${po.supplier_id}`);
        setSupplier({ supplier_id: sup.supplier_id, name: sup.name, phone: sup.phone, gstin: sup.gstin });
        setWarehouse(String(po.branch_id));
        setF({ expected_date: po.expected_date ? String(po.expected_date).slice(0, 10) : '', payment_terms_days: po.payment_terms_days ?? '', notes: po.notes || '' });
        const prods = await Promise.all(po.items.map((i) => (i.product_id ? api(`/wholesale/products/${i.product_id}`).catch(() => null) : null)));
        setLines(po.items.map((i, k) => ({ key: `l${++seq}`, product_id: i.product_id, name: i.description, unit_name: i.unit_name, units: [{ unit_name: i.base_unit, factor: 1 }, ...(prods[k]?.units || []).map((u) => ({ unit_name: u.unit_name, factor: u.factor }))], base_unit: i.base_unit, quantity: String(i.ordered), unit_cost: String(i.unit_cost), tax_rate: String(i.tax_rate), purchase_price: prods[k]?.purchase_price })));
        setLoaded(true);
      }).catch((e) => setLoadError(e.message));
    } else if (search.get('supplier')) {
      api(`/wholesale/suppliers/${search.get('supplier')}`).then((s) => { setSupplier({ supplier_id: s.supplier_id, name: s.name, phone: s.phone, gstin: s.gstin }); if (s.payment_terms_days != null) setF((x) => ({ ...x, payment_terms_days: s.payment_terms_days })); }).catch(() => {});
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseSupplier = async (s) => { setSupplier(s); if (s && !editing) { try { const full = await api(`/wholesale/suppliers/${s.supplier_id}`); setF((x) => ({ ...x, payment_terms_days: full.payment_terms_days ?? x.payment_terms_days })); } catch { /* optional */ } } };

  const addProduct = (p) => {
    const unit = p.purchase_unit || p.unit;
    const factor = unit === p.unit ? 1 : (p.units || []).find((u) => u.unit_name === unit)?.factor || 1;
    setLines((ls) => [...ls, { key: `l${++seq}`, product_id: p.product_id, name: p.name, unit_name: unit, units: [{ unit_name: p.unit, factor: 1 }, ...(p.units || []).map((u) => ({ unit_name: u.unit_name, factor: u.factor }))], base_unit: p.unit, quantity: '1', unit_cost: String(Math.round((p.purchase_price || 0) * factor * 100) / 100), tax_rate: String(p.tax_rate ?? 0), purchase_price: p.purchase_price }]);
  };
  const patch = (key, p) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const changeUnit = (l, unitName) => {
    const from = l.units.find((u) => u.unit_name === l.unit_name)?.factor || 1; const to = l.units.find((u) => u.unit_name === unitName)?.factor || 1;
    patch(l.key, { unit_name: unitName, unit_cost: l.unit_cost === '' ? '' : String(Math.round((Number(l.unit_cost) / from) * to * 100) / 100) });
  };

  const sub = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);
  const tax = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0) * ((Number(l.tax_rate) || 0) / 100), 0);

  const save = async () => {
    if (!supplier) { setError('Choose a supplier.'); return; }
    setBusy(true); setError('');
    try {
      const body = { supplier_id: supplier.supplier_id, branch_id: warehouse ? Number(warehouse) : undefined, expected_date: f.expected_date || null, notes: f.notes || null, payment_terms_days: f.payment_terms_days === '' ? undefined : Number(f.payment_terms_days),
        items: lines.map((l) => ({ product_id: l.product_id, unit_name: l.unit_name, quantity: Number(l.quantity), unit_cost: l.unit_cost === '' ? undefined : Number(l.unit_cost), tax_rate: l.tax_rate === '' ? undefined : Number(l.tax_rate) })) };
      const po = await api(editing ? `/wholesale/purchase-orders/${id}` : '/wholesale/purchase-orders', { method: editing ? 'PUT' : 'POST', body });
      toast.success(`${po.po_number} saved as a draft`); navigate(`/app/wholesale/purchasing/${po.po_id}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (loadError) return <div><PageHeader title="Edit purchase order" /><Alert>{loadError}</Alert><Button to="/app/wholesale/purchasing" variant="secondary">Back</Button></div>;
  if (!loaded) return <div className="space-y-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;

  return (
    <div>
      <PageHeader title={editing ? 'Edit purchase order' : 'New purchase order'} lead="Order goods from a supplier in the unit you buy them in." />
      <Alert>{error}</Alert>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Panel title="Supplier">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2"><SupplierPicker value={supplier} onChange={chooseSupplier} /></div>
              <WarehouseSelect value={warehouse} onChange={setWarehouse} label="Deliver to" id="po-wh" />
              <Field id="po-exp" label="Expected on"><Input id="po-exp" type="date" value={f.expected_date} onChange={set('expected_date')} /></Field>
              <NumberField id="po-terms" label="Payment terms" suffix="days" step={1} value={f.payment_terms_days} onChange={set('payment_terms_days')} />
            </div>
          </Panel>
          <Panel title="Products" lead="Costs default to the supplier’s listed price, or your last purchase price">
            <ProductPicker onPick={addProduct} autoFocus={!editing} placeholder="Scan or search a product to order" />
            {lines.length === 0 ? <p className="py-8 text-center text-small text-ink-400">No products yet.</p> : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[680px] text-small">
                  <thead className="text-left text-caption font-semibold uppercase tracking-wide text-ink-500"><tr><th className="pb-2 pr-3">Product</th><th className="pb-2 pr-3">Unit</th><th className="pb-2 pr-3 text-right">Qty</th><th className="pb-2 pr-3 text-right">Cost / unit</th><th className="pb-2 pr-3 text-right">GST %</th><th className="pb-2 pr-3 text-right">Amount</th><th className="pb-2"><span className="sr-only">Remove</span></th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {lines.map((l) => {
                      const f1 = l.units.find((u) => u.unit_name === l.unit_name)?.factor || 1;
                      return (
                        <tr key={l.key} className="align-top">
                          <td className="py-2 pr-3"><span className="font-medium text-ink-900">{l.name}</span>{f1 !== 1 && <span className="block text-caption text-ink-500">{qty((Number(l.quantity) || 0) * f1)} {l.base_unit} in total</span>}</td>
                          <td className="py-2 pr-3"><div className="w-28"><Select aria-label={`Unit for ${l.name}`} value={l.unit_name} onChange={(e) => changeUnit(l, e.target.value)}>{l.units.map((u) => <option key={u.unit_name} value={u.unit_name}>{u.unit_name}</option>)}</Select></div></td>
                          <td className="py-2 pr-3"><div className="ml-auto w-24"><Input aria-label={`Quantity of ${l.name}`} type="number" min="0" step="any" value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} className="text-right" /></div></td>
                          <td className="py-2 pr-3"><div className="ml-auto w-28"><Input aria-label={`Cost of ${l.name}`} type="number" min="0" step="any" value={l.unit_cost} onChange={(e) => patch(l.key, { unit_cost: e.target.value })} className="text-right" /></div></td>
                          <td className="py-2 pr-3"><div className="ml-auto w-20"><Input aria-label={`GST on ${l.name}`} type="number" min="0" max="100" step="any" value={l.tax_rate} onChange={(e) => patch(l.key, { tax_rate: e.target.value })} className="text-right" /></div></td>
                          <td className="tabular py-2 pr-3 text-right font-medium">{money((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0))}</td>
                          <td className="py-2 text-right"><button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove ${l.name}`} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-danger"><X className="h-4 w-4" /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title="Notes"><Field id="po-notes" label="Notes for the supplier"><Textarea id="po-notes" rows={2} value={f.notes} onChange={set('notes')} maxLength={1000} /></Field></Panel>
        </div>
        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Panel title="Summary"><dl className="space-y-2 text-small"><div className="flex justify-between"><dt className="text-ink-500">Before GST</dt><dd className="tabular">{money(Math.round(sub * 100) / 100)}</dd></div><div className="flex justify-between"><dt className="text-ink-500">GST</dt><dd className="tabular">{money(Math.round(tax * 100) / 100)}</dd></div><div className="flex justify-between border-t border-line pt-2 text-body font-semibold"><dt>Total</dt><dd className="tabular">{money(Math.round((sub + tax) * 100) / 100)}</dd></div></dl></Panel>
          <div className="flex flex-col gap-2"><Button onClick={save} loading={busy} disabled={!supplier || !lines.length}>{editing ? 'Save changes' : 'Save as draft'}</Button><Button variant="ghost" onClick={() => navigate(editing ? `/app/wholesale/purchasing/${id}` : '/app/wholesale/purchasing')}>Cancel</Button></div>
        </aside>
      </div>
    </div>
  );
};

export default PurchaseEditor;
