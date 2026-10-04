/*
 * The names a product goes by, on its own screen: its SKU (made by FlowXP), any number of barcodes, other names people
 * search it by, and (under "Advanced details") an ERP code and supplier codes. Nothing here is required; a product with
 * none of it still sells.
 *
 * A barcode that already belongs to another product is never taken quietly: the server answers 409 with that
 * product's name, and this offers to open it, or (with permission) move the barcode here.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { api } from '../lib/api.js';
import { Alert, Button, Input, useToast } from './ui.jsx';

const label = 'text-caption font-semibold uppercase tracking-[0.12em] text-ink-500';

const Chip = ({ children, onRemove, removeLabel }) => (
  <li className="flex items-center gap-1 rounded-lg border border-line bg-surface-2 py-1 pl-2.5 pr-1 text-small text-ink-900">
    {children}
    {onRemove && (
      <button type="button" onClick={onRemove} aria-label={removeLabel} className="flex h-6 w-6 items-center justify-center rounded text-ink-400 hover:bg-surface-3 hover:text-danger pointer-coarse:h-11 pointer-coarse:w-11">
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    )}
  </li>
);

const AddRow = ({ value, onChange, onAdd, placeholder, ariaLabel, busy, children }) => (
  <form onSubmit={(e) => { e.preventDefault(); onAdd(); }} className="mt-2 flex gap-2">
    <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={ariaLabel} maxLength={160} className="!py-2 pointer-coarse:!py-3" />
    {children}
    <Button type="submit" variant="secondary" disabled={busy || !value.trim()} className="pointer-coarse:min-h-11">Add</Button>
  </form>
);

const ProductIdentifiers = ({ product, canEdit, canMove, onChanged }) => {
  const toast = useToast();
  const id = product.product_id;
  const [ids, setIds] = useState(null);
  const [error, setError] = useState('');
  const [clash, setClash] = useState(null);       // { barcode, name, product_id } when the barcode is someone else's
  const [barcode, setBarcode] = useState('');
  const [alias, setAlias] = useState('');
  const [code, setCode] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [suppliers, setSuppliers] = useState(null);
  const [erp, setErp] = useState(product.erp_code || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setIds(null); setError(''); setClash(null); setErp(product.erp_code || '');
    api(`/products/${id}/identifiers`).then(setIds).catch((e) => setError(e.message));
  }, [id, product.erp_code]);

  const send = async (path, options, done) => {
    setBusy(true); setError('');
    try {
      const result = await api(`/products/${id}${path}`, options);
      setIds(result.identifiers);
      onChanged?.();
      done?.(result);
      return true;
    } catch (caught) {
      if (caught.code === 'BARCODE_IN_USE') setClash({ ...caught.data, barcode: options?.body?.barcode?.trim() });
      else setError(caught.message);
      return false;
    } finally { setBusy(false); }
  };

  const addBarcode = async (replace = false) => {
    const text = (clash?.barcode || barcode).trim();
    if (!text) return;
    const ok = await send('/barcodes', { method: 'POST', body: { barcode: text, replace } }, (r) => {
      setBarcode(''); setClash(null);
      toast.success(r.status === 'moved' ? `Moved from ${r.moved_from.name}` : r.status === 'already_here' ? 'It was already here' : 'Barcode added');
    });
    return ok;
  };

  const saveErp = async () => {
    setBusy(true); setError('');
    try { await api(`/products/${id}`, { method: 'PATCH', body: { erp_code: erp.trim() || null } }); toast.success('Saved'); onChanged?.(); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  const openAdvanced = (e) => {
    if (e.currentTarget.open && suppliers === null && canEdit) api('/suppliers').then((rows) => setSuppliers(rows || [])).catch(() => setSuppliers([]));
  };

  const barcodes = ids?.barcodes || [];
  return (
    <section aria-label="Codes" className="space-y-4">
      <Alert>{error}</Alert>

      <div>
        <h3 className={label}>SKU</h3>
        <p className="mt-1 text-small text-ink-900">{product.sku || <span className="text-ink-500">None</span>}{product.sku && <span className="text-ink-500"> · made by FlowXP, you never have to type one</span>}</p>
      </div>

      <div>
        <h3 className={label}>Barcodes</h3>
        {ids === null ? <div className="mt-2 h-8 animate-pulse rounded-lg bg-surface-3" /> : barcodes.length === 0 ? (
          <p className="mt-1 text-small text-ink-500">No barcode yet. Optional: add one so it can be scanned at the till.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {barcodes.map((b) => (
              <Chip key={b.barcode_id} onRemove={canEdit ? () => send(`/barcodes/${encodeURIComponent(b.barcode)}`, { method: 'DELETE' }) : null} removeLabel={`Remove barcode ${b.barcode}`}>
                <span className="tabular">{b.barcode}</span>{b.is_primary && barcodes.length > 1 && <span className="ml-1 text-caption text-ink-500">main</span>}
              </Chip>
            ))}
          </ul>
        )}
        {canEdit && <AddRow value={barcode} onChange={(v) => { setBarcode(v); setClash(null); }} onAdd={() => addBarcode(false)} placeholder="Type or scan a barcode" ariaLabel="Barcode to add" busy={busy} />}
        {clash && (
          <div role="alert" className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-small text-ink-900">
            <p>This barcode is already assigned to <strong className="font-semibold">{clash.name}</strong>.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link to={`/app/products?p=${clash.product_id}`} className="inline-flex min-h-9 items-center rounded-lg border border-line-strong bg-surface px-3 font-medium text-ink-900 hover:bg-surface-2 pointer-coarse:min-h-11">Use {clash.name}</Link>
              {canMove
                ? <Button type="button" size="sm" disabled={busy} onClick={() => addBarcode(true)}>Move it to this product</Button>
                : <span className="self-center text-caption text-ink-500">Moving a barcode needs a manager's permission.</span>}
              <Button type="button" size="sm" variant="ghost" onClick={() => setClash(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      <div>
        <h3 className={label}>Other names</h3>
        <p className="mt-0.5 text-caption text-ink-500">Search finds the product by any of these too.</p>
        {(ids?.aliases || []).length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {ids.aliases.map((a) => <Chip key={a.alias_id} onRemove={canEdit ? () => send(`/aliases/${a.alias_id}`, { method: 'DELETE' }) : null} removeLabel={`Remove the name ${a.alias}`}>{a.alias}</Chip>)}
          </ul>
        )}
        {canEdit && <AddRow value={alias} onChange={setAlias} onAdd={() => send('/aliases', { method: 'POST', body: { alias } }, () => setAlias(''))} placeholder="e.g. Taaza milk" ariaLabel="Another name for this product" busy={busy} />}
      </div>

      <details onToggle={openAdvanced} className="rounded-(--radius-card) border border-line bg-surface">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-small font-medium text-ink-700 pointer-coarse:min-h-11">Advanced details</summary>
        <div className="space-y-4 border-t border-line px-4 py-3">
          <div>
            <h3 className={label}>ERP code <span className="font-normal normal-case tracking-normal">(optional)</span></h3>
            {canEdit ? (
              <form onSubmit={(e) => { e.preventDefault(); saveErp(); }} className="mt-2 flex gap-2">
                <Input value={erp} onChange={(e) => setErp(e.target.value)} aria-label="ERP code" maxLength={64} className="!py-2 pointer-coarse:!py-3" />
                <Button type="submit" variant="secondary" disabled={busy || erp.trim() === (product.erp_code || '')} className="pointer-coarse:min-h-11">Save</Button>
              </form>
            ) : <p className="mt-1 text-small text-ink-900">{product.erp_code || <span className="text-ink-500">None</span>}</p>}
          </div>
          <div>
            <h3 className={label}>Supplier codes <span className="font-normal normal-case tracking-normal">(optional)</span></h3>
            {(ids?.supplier_codes || []).length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {ids.supplier_codes.map((c) => (
                  <Chip key={c.code_id} onRemove={canEdit ? () => send(`/supplier-codes/${c.code_id}`, { method: 'DELETE' }) : null} removeLabel={`Remove supplier code ${c.code}`}>
                    <span className="tabular">{c.code}</span>{c.supplier_name && <span className="ml-1 text-caption text-ink-500">{c.supplier_name}</span>}
                  </Chip>
                ))}
              </ul>
            )}
            {canEdit && (
              <AddRow value={code} onChange={setCode} placeholder="Supplier's code" ariaLabel="Supplier code to add" busy={busy}
                      onAdd={() => send('/supplier-codes', { method: 'POST', body: { code, supplier_id: supplierId || undefined } }, () => setCode(''))}>
                {suppliers?.length > 0 && (
                  <select aria-label="Which supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="h-10 max-w-40 rounded-lg pointer-coarse:h-11 border border-line-strong bg-surface px-2 text-small">
                    <option value="">Any supplier</option>
                    {suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
                  </select>
                )}
              </AddRow>
            )}
          </div>
        </div>
      </details>
    </section>
  );
};

export default ProductIdentifiers;
