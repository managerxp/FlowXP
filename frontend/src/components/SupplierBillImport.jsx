/*
 * Read a supplier bill: take a photo (or choose photos or a PDF), check what was read against the products it matched,
 * and hand the checked lines to Receive stock. Reading never changes stock: the person reviews EVERY line, and the
 * stock goes on the shelf only when they press Receive on the page behind this one.
 *
 * Each line shows how it was matched (barcode, supplier code, wording learned from an earlier correction, or a name guess)
 * so the person knows what to trust; anything unmatched has to be chosen, created or left out. Two checks protect the books:
 * a bill number already recorded for this supplier, and lines that do not add up to the total printed on the bill.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, FileText, Search, X } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import QuickProductModal from './QuickProductModal.jsx';
import { Alert, Button, Field, Input, Modal, Select } from './ui.jsx';

const VIA = {
  barcode: ['Barcode', 'bg-success/10 text-success'],
  supplier_code: ['Supplier code', 'bg-success/10 text-success'],
  alias: ['Matched before', 'bg-success/10 text-success'],
  name: ['Name guess: check it', 'bg-warning/10 text-warning'],
  picked: ['Chosen by you', 'bg-brand-50 text-brand-700']
};

/* A phone photo is 3-8 MB; a bill is just as readable at 2000 px and uploads far quicker. PDFs go as they are. */
const shrink = async (file, max = 2000) => {
  if (file.type === 'application/pdf') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    return blob ? new File([blob], 'bill.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
};

const n = (v) => (v === '' || v == null ? 0 : Number(v));
let rowKey = 0;
const toRow = (l) => ({
  key: ++rowKey, bill: l, product: l.match || null, suggestions: l.suggestions || [],
  include: Boolean(l.match), qty: l.quantity == null ? '' : String(l.quantity), rate: l.rate == null ? '' : String(l.rate),
  tax: l.tax_rate == null ? '' : String(l.tax_rate), expiry: l.expiry_date || '', batch: l.batch_no || '', picking: false, q: ''
});

const SupplierBillImport = ({ suppliers, categories, search, onClose, onUse }) => {
  const [step, setStep] = useState('pick');             // pick | reading | review
  const [files, setFiles] = useState([]);               // { file, url, pdf }
  const [rows, setRows] = useState([]);
  const [head, setHead] = useState({ supplierId: '', supplierName: '', invoiceNo: '', invoiceDate: '', total: null, notes: null });
  const [duplicate, setDuplicate] = useState(null);     // the purchase number this bill number is already recorded as
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [creating, setCreating] = useState(null);       // the row a new product is being made for
  const [error, setError] = useState('');
  const cameraRef = useRef(null); const libraryRef = useRef(null);

  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = (list) => {
    const picked = [...list].filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf').map((file) => ({ file, url: URL.createObjectURL(file), pdf: file.type === 'application/pdf' }));
    setFiles((prev) => [...prev, ...picked].slice(0, 5));
    setError('');
  };

  const read = async () => {
    setError(''); setStep('reading');
    try {
      const form = new FormData();
      for (const { file } of files) form.append('files', await shrink(file));
      const data = await api('/retail/invoice-import/scan', { method: 'POST', body: form });
      if (!data.lines.length) { setError(data.notes || 'No item lines were found. Try a clearer photo of the whole bill.'); setStep('pick'); return; }
      setRows(data.lines.map(toRow));
      setHead({ supplierId: data.supplier ? String(data.supplier.supplier_id) : '', supplierName: data.supplier_name || '', invoiceNo: data.invoice_no || '', invoiceDate: data.invoice_date || '', total: data.total, notes: data.notes });
      setDuplicate(data.duplicate_of); setAllowDuplicate(false);
      setStep('review');
    } catch (caught) { setError(caught.message); setStep('pick'); }
  };

  // the repeated-bill check runs again whenever the supplier or the bill number is changed by hand
  useEffect(() => {
    if (step !== 'review' || !head.supplierId || !head.invoiceNo.trim()) { if (step === 'review') setDuplicate(null); return undefined; }
    const t = setTimeout(() => api(`/retail/invoice-import/check?supplier_id=${head.supplierId}&invoice_no=${encodeURIComponent(head.invoiceNo.trim())}`).then((d) => setDuplicate(d.duplicate_of)).catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [step, head.supplierId, head.invoiceNo]);

  const update = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const choose = (key, p) => update(key, { product: { product_id: p.product_id, name: p.name, sku: p.sku, unit: p.unit, via: 'picked' }, include: true, picking: false, q: '' });

  const chosen = rows.filter((r) => r.include);
  const lineProblems = chosen.filter((r) => !r.product || !(n(r.qty) > 0) || !(n(r.rate) >= 0) || r.rate === '').length;
  const net = chosen.reduce((s, r) => s + n(r.qty) * n(r.rate), 0);
  const gross = chosen.reduce((s, r) => s + n(r.qty) * n(r.rate) * (1 + n(r.tax) / 100), 0);
  const printed = head.total;
  const mismatch = printed != null && chosen.length > 0 && Math.min(Math.abs(printed - net), Math.abs(printed - gross)) > Math.max(5, printed * 0.02);
  const skipped = rows.length - chosen.length;
  const blocked = lineProblems > 0 || !chosen.length || (duplicate && !allowDuplicate);

  const use = () => onUse({
    supplier_id: head.supplierId ? Number(head.supplierId) : null, invoice_no: head.invoiceNo.trim(), invoice_date: head.invoiceDate || '', allow_duplicate: Boolean(duplicate && allowDuplicate),
    lines: chosen.map((r) => ({
      product: r.product, qty: n(r.qty), cost: r.rate, tax_rate: r.tax, expiry: r.expiry, batch: r.batch,
      learn: { description: r.bill.description, barcode: r.bill.barcode || undefined, supplier_code: r.bill.supplier_code || undefined, product_id: r.product.product_id }
    }))
  });

  return (
    <>
      <Modal title="Read a supplier bill" onClose={onClose} wide>
        <div className="space-y-4">
          <Alert>{error}</Alert>

          {step === 'pick' && (
            <>
              <p className="text-sm text-ink-700">Take a clear photo of the supplier’s bill, or choose photos or a PDF. FlowXP reads the items and matches them to your products, and <strong>you check every line before any stock is received</strong>. The files are not kept.</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => cameraRef.current?.click()}>Take a photo</Button>
                <Button variant="secondary" onClick={() => libraryRef.current?.click()}>Choose photos or PDF</Button>
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                <input ref={libraryRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              </div>
              {files.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {files.map((f, i) => (
                    <div key={f.url} className="relative">
                      {f.pdf
                        ? <div className="flex h-28 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-line bg-surface-2 text-caption text-ink-500"><FileText aria-hidden="true" className="h-7 w-7" />PDF</div>
                        : <img src={f.url} alt={`Bill page ${i + 1}`} className="h-28 w-24 rounded-lg border border-line object-cover" />}
                      <button type="button" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} aria-label={`Remove page ${i + 1}`} className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-ink-900 text-white hover:bg-danger"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-ink-400">Up to 5 pages of one bill. The whole page in the frame, good light and no glare help most.</p>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button onClick={read} disabled={!files.length}>Read the bill</Button>
              </div>
            </>
          )}

          {step === 'reading' && (
            <div className="py-12 text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-brand-500" />
              <p className="text-sm font-semibold text-ink-900">Reading the bill…</p>
              <p className="mt-1 text-xs text-ink-400">This can take up to a minute for a long bill.</p>
            </div>
          )}

          {step === 'review' && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id="bill-supplier" label="Supplier" hint={!head.supplierId && head.supplierName ? `The bill says “${head.supplierName}”: choose who it is` : undefined}>
                  <Select id="bill-supplier" value={head.supplierId} onChange={(e) => setHead((h) => ({ ...h, supplierId: e.target.value }))}>
                    <option value="">No supplier</option>{suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
                  </Select>
                </Field>
                <Field id="bill-no" label="Bill number"><Input id="bill-no" value={head.invoiceNo} maxLength={40} onChange={(e) => setHead((h) => ({ ...h, invoiceNo: e.target.value }))} /></Field>
                <Field id="bill-date" label="Bill date"><Input id="bill-date" type="date" value={head.invoiceDate} onChange={(e) => setHead((h) => ({ ...h, invoiceDate: e.target.value }))} /></Field>
              </div>

              {duplicate && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm text-ink-900">
                  <span className="flex items-start gap-2"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />This supplier’s bill <strong>{head.invoiceNo}</strong> is already recorded as <strong>{duplicate}</strong>. Receiving it again would double the stock and what you owe.</span>
                  <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" />It is a different delivery</label>
                </div>
              )}
              {mismatch && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm text-ink-900">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <span>The bill’s total is <strong>{formatCurrency(printed)}</strong>, but the lines you have ticked come to <strong>{formatCurrency(net)}</strong> ({formatCurrency(gross)} with GST). A line may have been misread or missed.</span>
                </div>
              )}
              {head.notes && <Alert>{head.notes}</Alert>}

              <p className="text-sm text-ink-700">Found <strong>{rows.length}</strong> lines. Check the product, quantity and price on each, and untick anything that should not be received.</p>
              <ul className="max-h-[48vh] space-y-2 overflow-y-auto pr-1" aria-label="Lines on the bill">
                {rows.map((r) => {
                  const via = r.product ? VIA[r.product.via] : null;
                  const hits = r.picking && r.q.trim().length >= 2 ? search(r.q.trim(), 6) : [];
                  return (
                    <li key={r.key} className={`rounded-lg border p-3 ${r.include ? 'border-line' : 'border-line opacity-60'} ${r.include && !r.product ? 'border-danger/40 bg-danger/5' : r.bill.unsure ? 'bg-warning/5' : ''}`}>
                      <div className="flex items-start gap-3">
                        <input type="checkbox" checked={r.include} onChange={(e) => update(r.key, { include: e.target.checked })} aria-label={`Receive ${r.bill.description}`} className="mt-1 h-4 w-4 accent-[var(--color-brand-500)]" />
                        <div className="min-w-0 flex-1">
                          <p className="text-small text-ink-500">On the bill: <span className="font-medium text-ink-700">{r.bill.description}</span>{r.bill.supplier_code ? <span className="text-ink-400"> · code {r.bill.supplier_code}</span> : null}</p>
                          {r.product && !r.picking ? (
                            <p className="mt-0.5 flex flex-wrap items-center gap-2">
                              <span className="font-medium text-ink-900">{r.product.name}</span>
                              {via && <span className={`rounded-full px-2 py-0.5 text-caption font-semibold ${via[1]}`}>{via[0]}</span>}
                              <button type="button" onClick={() => update(r.key, { picking: true, q: '' })} className="text-small font-medium text-brand-600 hover:underline">Change</button>
                            </p>
                          ) : (
                            <div className="mt-1.5">
                              {r.suggestions.length > 0 && !r.picking && <p className="mb-1 text-caption text-ink-500">Could be:</p>}
                              {!r.picking && (
                                <div className="flex flex-wrap gap-1.5">
                                  {r.suggestions.map((s) => <button key={s.product_id} type="button" onClick={() => choose(r.key, s)} className="rounded-full border border-line-strong px-2.5 py-1 text-small hover:border-brand-500 hover:bg-brand-50">{s.name}</button>)}
                                  <button type="button" onClick={() => update(r.key, { picking: true })} className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 py-1 text-small text-ink-700 hover:border-brand-500"><Search aria-hidden="true" className="h-3.5 w-3.5" />Find a product</button>
                                  <button type="button" onClick={() => setCreating(r)} className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-small text-ink-700 hover:border-brand-500">New product</button>
                                </div>
                              )}
                              {r.picking && (
                                <div className="relative">
                                  <Input autoFocus aria-label="Search products" placeholder="Search by name, SKU or barcode" value={r.q} onChange={(e) => update(r.key, { q: e.target.value })} />
                                  {hits.length > 0 && (
                                    <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
                                      {hits.map((p) => <li key={p.product_id}><button type="button" onClick={() => choose(r.key, p)} className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-small hover:bg-surface-2"><span className="truncate font-medium text-ink-900">{p.name}</span><span className="shrink-0 text-caption text-ink-500">{p.sku}</span></button></li>)}
                                    </ul>
                                  )}
                                  <button type="button" onClick={() => update(r.key, { picking: false })} className="mt-1 text-caption text-ink-500 hover:underline">{r.product ? 'Keep ' + r.product.name : 'Cancel'}</button>
                                </div>
                              )}
                            </div>
                          )}
                          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-[6rem_7rem_6rem_1fr_auto]">
                            <Input aria-label="Quantity" inputMode="decimal" placeholder="Qty" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} />
                            <Input aria-label="Cost each, before GST" inputMode="decimal" placeholder="Cost ₹" value={r.rate} onChange={(e) => update(r.key, { rate: e.target.value })} />
                            <Input aria-label="GST percent" inputMode="decimal" placeholder="GST %" value={r.tax} onChange={(e) => update(r.key, { tax: e.target.value })} />
                            <Input aria-label="Expiry date" type="date" value={r.expiry} onChange={(e) => update(r.key, { expiry: e.target.value })} className="col-span-2 sm:col-span-1" />
                            <p className="tabular self-center text-right text-small font-semibold text-ink-900">{formatCurrency(n(r.qty) * n(r.rate))}</p>
                          </div>
                          {r.bill.unsure && <p className="mt-1 text-caption text-warning">Part of this line was hard to read: please check the numbers.</p>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <p className="text-xs text-ink-500">
                  {lineProblems > 0 ? <span className="text-danger">{lineProblems} ticked line{lineProblems === 1 ? ' needs' : 's need'} a product, a quantity and a cost.</span>
                    : <>{chosen.length} line{chosen.length === 1 ? '' : 's'} ready{skipped ? `, ${skipped} left out` : ''}. Nothing is received until you press Receive on the next page.</>}
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep('pick')}>Back</Button>
                  <Button onClick={use} disabled={blocked}><Check aria-hidden="true" className="h-4 w-4" />Use {chosen.length} line{chosen.length === 1 ? '' : 's'}</Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>

      {creating && (
        <QuickProductModal
          barcode={creating.bill.barcode || undefined} categories={categories}
          onCancel={() => setCreating(null)}
          onCreated={(p) => { choose(creating.key, p); setCreating(null); }}
          onUseExisting={(p) => { choose(creating.key, p); setCreating(null); }}
        />
      )}
    </>
  );
};

export default SupplierBillImport;
