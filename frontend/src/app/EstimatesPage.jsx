/*
 * Estimates / quotations: a priced offer with a number and a valid-until date. Not a sale. "Make invoice" bills the same lines
 * through the normal invoice engine, so tax and stock behave exactly as at the till.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { formatDate } from '../lib/display.js';
import { Alert, Button, Field, Input, Modal, Select, useDialog, useToast } from '../components/ui.jsx';
import { useT, T } from '../i18n/useT.js';
import { useAuth } from '../context/AuthContext.jsx';

const STATUS = { OPEN: T('Open'), CONVERTED: T('Invoiced'), CANCELLED: T('Cancelled') };
const shareText = (r) => [`Estimate ${r.estimate_number}`, ...(r.customer_name ? [`For: ${r.customer_name}`] : []), '',
  ...r.items.map((i, n) => `${n + 1}. ${i.description}  ${i.quantity} x ${formatCurrency(i.unit_price)} = ${formatCurrency(i.quantity * i.unit_price)}`),
  ...(r.discount > 0 ? ['', `Discount: ${formatCurrency(r.discount)}`] : []), '', `Total: ${formatCurrency(r.total)}`, ...(r.valid_until ? [`Valid until: ${r.valid_until}`] : [])].join('\n');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* A clean one-page estimate in its own window, opened on the print dialog (Save as PDF works from there). */
const printEstimate = (r, shop) => {
  const w = window.open('', '_blank');
  if (!w) return;
  const rows = r.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.description)}</td><td class="r">${i.quantity}</td><td class="r">${formatCurrency(i.unit_price)}</td><td class="r">${formatCurrency(i.quantity * i.unit_price)}</td></tr>`).join('');
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(r.estimate_number)}</title><style>body{font:14px system-ui,sans-serif;margin:32px;color:#111}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border-bottom:1px solid #ccc;padding:6px 8px;text-align:left}.r{text-align:right}.t{font-weight:700}</style><h1>${esc(shop)}</h1><p>Estimate ${esc(r.estimate_number)}${r.customer_name ? ' &middot; ' + esc(r.customer_name) : ''}${r.valid_until ? ' &middot; valid until ' + esc(r.valid_until) : ''}</p><table><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr>${rows}${r.discount > 0 ? `<tr><td colspan="4" class="r">Discount</td><td class="r">- ${formatCurrency(r.discount)}</td></tr>` : ''}<tr class="t"><td colspan="4" class="r">Total</td><td class="r">${formatCurrency(r.total)}</td></tr></table>${r.notes ? `<p>${esc(r.notes)}</p>` : ''}`);
  w.document.close(); w.focus(); w.print();
};
const blankLine = () => ({ product_id: '', description: '', quantity: '1', unit_price: '' });
const blank = () => ({ customer_id: '', customer_name: '', valid_until: '', discount: '', notes: '', items: [blankLine()] });

const EstimatesPage = () => {
  const { t: tr } = useT();
  const toast = useToast();
  const { business } = useAuth();
  const dialog = useDialog();
  const [rows, setRows] = useState(null);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => { api('/estimates').then(setRows).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    load();
    api('/products?kind=DISH').then((r) => setProducts(r?.rows || r || [])).catch(() => {});
    api('/customers').then((r) => setCustomers(r?.rows || r || [])).catch(() => {});
  }, [load]);

  const setItem = (i, patch) => setForm((f) => ({ ...f, items: f.items.map((it, n) => (n === i ? { ...it, ...patch } : it)) }));
  const pick = (i, id) => {
    const p = products.find((x) => String(x.product_id) === id);
    setItem(i, { product_id: id, description: p ? p.name : '', unit_price: p ? String(p.selling_price ?? '') : '' });
  };
  const total = form ? Math.max(0, form.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0) - (Number(form.discount) || 0)) : 0;

  const save = async (e) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await api('/estimates', { method: 'POST', idempotencyKey: crypto.randomUUID(), body: {
        customer_id: form.customer_id || undefined, customer_name: form.customer_id ? undefined : form.customer_name, valid_until: form.valid_until || undefined,
        discount: form.discount || undefined, notes: form.notes || undefined,
        items: form.items.filter((it) => it.description.trim() || it.product_id).map((it) => ({ product_id: it.product_id || undefined, description: it.description, quantity: it.quantity, unit_price: it.unit_price }))
      } });
      setForm(null); toast.success(tr('Saved')); load();
    } catch (caught) { setError(caught.message); } finally { setSaving(false); }
  };

  const makeInvoice = async (row) => {
    if (!(await dialog.confirm({ title: tr('Make an invoice from this estimate?'), body: `${row.estimate_number} · ${formatCurrency(row.total)}`, confirmLabel: tr('Make invoice') }))) return;
    try { await api(`/estimates/${row.estimate_id}/convert`, { method: 'POST', idempotencyKey: crypto.randomUUID(), body: {} }); toast.success(tr('Invoice made')); load(); } catch (caught) { setError(caught.message); }
  };
  const cancel = async (row) => {
    if (!(await dialog.confirm({ title: tr('Cancel this estimate?'), body: row.estimate_number, confirmLabel: tr('Cancel estimate'), danger: true }))) return;
    try { await api(`/estimates/${row.estimate_id}/cancel`, { method: 'POST', body: {} }); load(); } catch (caught) { setError(caught.message); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h3 font-semibold text-ink-900">{tr('Estimates')}</h1>
          <p className="text-small text-ink-500">{tr('Send a price before the sale. When the customer agrees, turn it into an invoice in one tap.')}</p>
        </div>
        <Button onClick={() => setForm(blank())}><Plus className="size-4" aria-hidden="true" /> {tr('New estimate')}</Button>
      </div>
      <Alert>{error}</Alert>
      {rows && (rows.length === 0
        ? <p className="rounded-(--radius-card) border border-dashed border-line-strong p-8 text-center text-small text-ink-500">{tr('No estimates yet.')}</p>
        : (
          <ul className="divide-y divide-line rounded-(--radius-card) border border-line bg-surface">
            {rows.map((r) => (
              <li key={r.estimate_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-small font-medium text-ink-900">{r.estimate_number} <span className="font-normal text-ink-500">· {r.customer_name || tr('Walk-in')}</span></p>
                  <p className="text-xs text-ink-500">{STATUS[r.status] ? tr(STATUS[r.status]) : r.status}{r.valid_until ? ` · ${tr('valid until')} ${formatDate(r.valid_until)}` : ''}</p>
                </div>
                <span className="tabular text-small font-semibold text-ink-900">{formatCurrency(r.total)}</span>
                {r.status === 'OPEN' && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => printEstimate(r, business?.name || '')}>{tr('Print')}</Button>
                    <Button size="sm" variant="secondary" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(shareText(r))}`, '_blank', 'noopener')}>{tr('Share on WhatsApp')}</Button>
                    <Button size="sm" onClick={() => makeInvoice(r)}>{tr('Make invoice')}</Button>
                    <Button size="sm" variant="secondary" aria-label={tr('Cancel estimate')} onClick={() => cancel(r)}><Trash2 className="size-4" aria-hidden="true" /></Button>
                  </>
                )}
                {r.status === 'CONVERTED' && r.invoice_id && <Link className="text-small text-brand-700 hover:underline" to={`/app/billing/invoices/${r.invoice_id}`}>{tr('Open invoice')}</Link>}
              </li>
            ))}
          </ul>
        ))}

      {form && (
        <Modal open title={tr('New estimate')} onClose={() => setForm(null)}>
          <form onSubmit={save} className="space-y-3">
            <Field label={tr('Customer')}>
              <Select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                <option value="">{tr('Walk-in / type a name')}</option>
                {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name}</option>)}
              </Select>
            </Field>
            {!form.customer_id && <Field label={tr('Name')}><Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></Field>}
            {form.items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_4.5rem_6rem] gap-2">
                <Select aria-label={tr('Item')} value={it.product_id} onChange={(e) => pick(i, e.target.value)}>
                  <option value="">{tr('Other item')}</option>
                  {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
                </Select>
                <Input aria-label={tr('Qty')} inputMode="decimal" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} />
                <Input aria-label={tr('Price')} inputMode="decimal" value={it.unit_price} onChange={(e) => setItem(i, { unit_price: e.target.value })} />
                {!it.product_id && <div className="col-span-3"><Input aria-label={tr('Name')} placeholder={tr('Name of the item or service')} value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} /></div>}
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => setForm({ ...form, items: [...form.items, blankLine()] })}>{tr('Add another item')}</Button>
            <div className="grid grid-cols-2 gap-2">
              <Field label={tr('Discount')}><Input inputMode="decimal" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} /></Field>
              <Field label={tr('Valid until')}><Input type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></Field>
            </div>
            <Field label={tr('Note')}><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <p className="tabular text-right text-h4 font-semibold text-ink-900">{formatCurrency(total)}</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setForm(null)}>{tr('Close')}</Button><Button type="submit" loading={saving}>{tr('Save')}</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
};

export default EstimatesPage;
