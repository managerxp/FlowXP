/*
 * Import a menu from a photo: take or choose pictures of the printed menu, check
 * what was read (names, prices, categories), fix anything, and only then add it.
 * Reading a photo never changes the menu; the review step is what saves.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { useIdempotencyKey } from '../lib/idempotency.js';
import { Alert, Badge, Button, Input, Modal, Select } from './ui.jsx';

/* Phone photos are 3-8 MB; the menu is just as readable at 1800 px, and far quicker to upload. */
const shrink = async (file, max = 1800) => {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    return blob ? new File([blob], 'menu.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
};

let rowKey = 0;
const toRow = (i) => ({ key: ++rowKey, include: !i.unsure || i.price != null, name: i.name, price: i.price == null ? '' : String(i.price), category: i.category || '', description: i.description || '', unsure: i.unsure, duplicate: i.duplicate_of });

const MenuImportModal = ({ onClose, onDone }) => {
  const confirmKey = useIdempotencyKey();
  const [step, setStep] = useState('pick');          // pick | reading | review | done
  const [files, setFiles] = useState([]);            // { file, url }
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ notes: null, categories: [], gst: false });
  const [tax, setTax] = useState('0');
  const [onDup, setOnDup] = useState('skip');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef(null); const libraryRef = useRef(null);

  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = (list) => {
    const picked = [...list].filter((f) => f.type.startsWith('image/')).map((file) => ({ file, url: URL.createObjectURL(file) }));
    setFiles((prev) => [...prev, ...picked].slice(0, 5));
    setError('');
  };
  const removeFile = (i) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const read = async () => {
    setError(''); setStep('reading');
    try {
      const form = new FormData();
      for (const { file } of files) form.append('images', await shrink(file));
      const data = await api('/menu-import/scan', { method: 'POST', body: form });
      if (!data.items.length) { setError(data.notes || 'No menu items were found in that photo. Try a clearer, closer picture.'); setStep('pick'); return; }
      setRows(data.items.map(toRow));
      setMeta({ notes: data.notes, categories: data.categories, gst: data.gst_enabled });
      setTax(data.gst_enabled ? '5' : '0');
      setStep('review');
    } catch (caught) { setError(caught.message); setStep('pick'); }
  };

  const update = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.include);
  const problems = useMemo(() => chosen.filter((r) => !r.name.trim() || r.price === '' || Number(r.price) < 0 || Number.isNaN(Number(r.price))).length, [chosen]);

  const confirm = async () => {
    setError(''); setBusy(true);
    try {
      const data = await api('/menu-import/confirm', {
        method: 'POST', idempotencyKey: confirmKey.get(),
        body: { tax_rate: Number(tax) || 0, on_duplicate: onDup, items: chosen.map((r) => ({ name: r.name, price: Number(r.price), category: r.category || null, description: r.description || null })) }
      });
      confirmKey.settle();
      setResult(data); setStep('done'); onDone();
    } catch (caught) { confirmKey.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Add your menu from a photo" onClose={onClose} wide>
      <div className="space-y-4">
        <Alert>{error}</Alert>

        {step === 'pick' && (
          <>
            <p className="text-sm text-ink-600">Take a clear photo of your printed menu, or choose pictures you already have. Use one photo per page. FlowXP reads the items and prices, and <strong>you check everything before anything is added</strong>. The photos are not kept.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => cameraRef.current?.click()}>Take a photo</Button>
              <Button variant="secondary" onClick={() => libraryRef.current?.click()}>Choose photos</Button>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              <input ref={libraryRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>
            {files.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {files.map((f, i) => (
                  <div key={f.url} className="relative">
                    <img src={f.url} alt={`Menu page ${i + 1}`} className="h-28 w-24 rounded-lg border border-line object-cover" />
                    <button type="button" onClick={() => removeFile(i)} aria-label={`Remove page ${i + 1}`} className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-ink-900 text-xs text-white">✕</button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-ink-400">Up to 5 photos. Good light, the whole page in the frame, and no glare make the biggest difference.</p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={read} disabled={!files.length}>Read the menu</Button>
            </div>
          </>
        )}

        {step === 'reading' && (
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-brand-500" />
            <p className="text-sm font-semibold text-ink-900">Reading your menu…</p>
            <p className="mt-1 text-xs text-ink-400">This can take up to a minute for a long menu.</p>
          </div>
        )}

        {step === 'review' && (
          <>
            <p className="text-sm text-ink-600">Found <strong>{rows.length}</strong> items. Fix anything that was misread, untick what you don’t want, then add them.</p>
            {meta.notes && <Alert>{meta.notes}</Alert>}
            <div className="flex flex-wrap items-end gap-4 rounded-lg bg-surface-2 p-3">
              <label className="text-xs font-semibold text-ink-600">GST on these items (%)
                <Input className="mt-1 w-24" type="number" min="0" max="28" step="0.5" value={tax} onChange={(e) => setTax(e.target.value)} disabled={!meta.gst && tax === '0'} />
              </label>
              {rows.some((r) => r.duplicate) && (
                <label className="text-xs font-semibold text-ink-600">Items already on your menu
                  <Select className="mt-1" value={onDup} onChange={(e) => setOnDup(e.target.value)}><option value="skip">Leave them as they are</option><option value="update_price">Update their price</option></Select>
                </label>
              )}
              <div className="ml-auto flex gap-3 text-xs font-semibold text-brand-600">
                <button type="button" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: true })))}>Select all</button>
                <button type="button" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: false })))}>Select none</button>
              </div>
            </div>

            <datalist id="menu-import-categories">{[...new Set([...meta.categories, ...rows.map((r) => r.category).filter(Boolean)])].map((c) => <option key={c} value={c} />)}</datalist>
            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-400">
                  <tr><th className="w-8 px-2 py-2" /><th className="px-2 py-2">Item</th><th className="w-28 px-2 py-2">Price ₹</th><th className="w-40 px-2 py-2">Category</th><th className="w-8" /></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className={`border-t border-line ${r.include ? '' : 'opacity-50'} ${r.include && r.price === '' ? 'bg-danger/5' : r.unsure ? 'bg-warning/5' : ''}`}>
                      <td className="px-2 py-1.5"><input type="checkbox" checked={r.include} onChange={(e) => update(r.key, { include: e.target.checked })} aria-label={`Add ${r.name}`} className="h-4 w-4 accent-[var(--color-brand-500)]" /></td>
                      <td className="px-2 py-1.5">
                        <Input value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} aria-label="Item name" />
                        {r.duplicate && <span className="mt-1 inline-block"><Badge tone="warning">Already on your menu at {formatCurrency(r.duplicate.price)}</Badge></span>}
                        {r.unsure && !r.duplicate && <span className="mt-1 inline-block text-xs text-warning">Please check this one</span>}
                      </td>
                      <td className="px-2 py-1.5"><Input type="number" min="0" step="0.01" value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} aria-label="Price" placeholder="?" /></td>
                      <td className="px-2 py-1.5"><Input list="menu-import-categories" value={r.category} onChange={(e) => update(r.key, { category: e.target.value })} aria-label="Category" /></td>
                      <td className="px-2 py-1.5"><button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.name}`} className="text-ink-400 hover:text-danger">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, toRow({ name: '', price: null, unsure: false })])}>Add a missing item</Button>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-xs text-ink-500">{problems > 0 ? <span className="text-danger">{problems} selected item{problems === 1 ? ' needs' : 's need'} a name and price.</span> : 'Nothing is added until you press the button.'}</p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep('pick')}>Back</Button>
                <Button onClick={confirm} disabled={busy || !chosen.length || problems > 0}>{busy ? 'Adding…' : `Add ${chosen.length} item${chosen.length === 1 ? '' : 's'}`}</Button>
              </div>
            </div>
          </>
        )}

        {step === 'done' && result && (
          <div className="space-y-3 py-4 text-center">
            <p className="text-lg font-bold text-ink-900">Your menu is in.</p>
            <p className="text-sm text-ink-600">{result.created} added{result.categories_created ? ` in ${result.categories_created} new categor${result.categories_created === 1 ? 'y' : 'ies'}` : ''}{result.updated ? `, ${result.updated} prices updated` : ''}{result.skipped ? `, ${result.skipped} skipped` : ''}.</p>
            <p className="text-xs text-ink-400">Next: add recipes to your dishes so stock and food cost are tracked.</p>
            <Button onClick={onClose}>Done</Button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default MenuImportModal;
