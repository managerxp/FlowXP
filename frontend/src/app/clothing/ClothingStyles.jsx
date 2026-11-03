/*
 * Clothing: styles with size and colour variants. A style is one product as the shopper thinks of it ("Men's cotton T-shirt"); every colour and size of it is its own product with
 * its own SKU, barcode and stock, so the till, returns and stock center treat it like any other item.
 *
 * Making one is a short wizard: details, colours and sizes, prices and opening stock in a size x colour grid, then save. Opening one shows the same grid with live stock.
 */
import { useMemo, useState } from 'react';
import { Plus, Printer, Search, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { qs, useDebounced, useLoad } from '../../lib/salon.js';
import { readTable } from '../../lib/spreadsheet.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr, useToast } from '../../components/ui.jsx';
import { Chips, NumberField, Pager, Panel, Tabs, Toolbar, useAction } from '../salon/parts.jsx';
import { formatCurrency } from '../../lib/api.js';
import { useT, T } from '../../i18n/useT.js';

const GENDERS = [['MEN', T('Men')], ['WOMEN', T('Women')], ['BOYS', T('Boys')], ['GIRLS', T('Girls')], ['KIDS', T('Kids')], ['UNISEX', T('Unisex')]];
const GENDER_LABEL = Object.fromEntries(GENDERS);
const rs = (paise) => formatCurrency((paise || 0) / 100);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

const Swatch = ({ hex, name }) => <span title={name} aria-hidden="true" className="inline-block h-3.5 w-3.5 rounded-full border border-line-strong align-middle" style={{ background: hex || '#e5e7eb' }} />;

/* ── the size x colour grid ──────────────────────────────────────────────── */
const Grid = ({ matrix }) => {
  const tr = useT();
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-small">
        <thead><tr className="bg-surface-2 text-left text-caption text-ink-500"><th className="px-3 py-2 font-semibold">{tr('Colour')}</th>{matrix.sizes.map((s) => <th key={s} className="px-3 py-2 text-center font-semibold">{s}</th>)}<th className="px-3 py-2 text-right font-semibold">{tr('Total')}</th></tr></thead>
        <tbody>
          {matrix.colours.map((c) => {
            const row = matrix.grid[c.name] || {};
            const total = matrix.sizes.reduce((a, s) => a + (row[s]?.stock || 0), 0);
            return (
              <tr key={c.name} className="border-t border-line">
                <td className="whitespace-nowrap px-3 py-2 font-medium"><Swatch hex={c.hex} name={c.name} /> <span className="ml-1">{c.name}</span></td>
                {matrix.sizes.map((s) => {
                  const cell = row[s];
                  return <td key={s} className={`px-3 py-2 text-center tabular ${!cell ? 'text-ink-300' : cell.stock <= 0 ? 'font-semibold text-danger' : cell.low ? 'font-semibold text-warning' : ''}`}>{cell ? cell.stock : '–'}</td>;
                })}
                <td className="px-3 py-2 text-right font-semibold tabular">{total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/* ── one style ──────────────────────────────────────────────────────────── */
const VariantRow = ({ v, canEdit, onSaved, card = false }) => {
  const tr = useT();
  const [price, setPrice] = useState(String(v.selling_price)); const [reorder, setReorder] = useState(String(v.min_stock)); const [code, setCode] = useState(v.barcode || '');
  const [busy, run] = useAction();
  const dirty = price !== String(v.selling_price) || reorder !== String(v.min_stock) || code !== (v.barcode || '');
  const save = () => run(async () => { await api(`/clothing/variants/${v.product_id}`, { method: 'PATCH', body: { selling_price: price, reorder_level: reorder, barcode: code } }); onSaved(); }, 'Saved');
  if (card) {
    return (
      <li className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <p className="font-medium text-ink-900"><Swatch hex={v.colour_hex} name={v.colour} /> <span className="ml-1">{v.colour}</span> · {v.size}</p>
          <p className={`tabular text-small ${v.stock <= 0 ? 'font-semibold text-danger' : 'text-ink-700'}`}>{v.stock}</p>
        </div>
        <p className="tabular text-caption text-ink-500">{v.sku}</p>
        {canEdit ? <Input aria-label={tr('Barcode')} className="mt-1" value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))} /> : <p className="tabular text-caption text-ink-500">{v.barcode}</p>}
        <div className="mt-2 flex items-end gap-2">
          <label className="flex-1 text-caption text-ink-500">{tr('Price')}{canEdit ? <Input aria-label={tr('Selling price')} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /> : <span className="tabular block text-body text-ink-900">{rs(v.selling_price_paise)}</span>}</label>
          <label className="w-24 text-caption text-ink-500">{tr('Reorder')}{canEdit ? <Input aria-label={tr('Reorder level')} inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value)} /> : <span className="tabular block text-body text-ink-900">{v.min_stock}</span>}</label>
          {canEdit && dirty && <Button size="sm" onClick={save} loading={busy}>{tr('Save')}</Button>}
        </div>
      </li>
    );
  }
  return (
    <Tr>
      <Td><Swatch hex={v.colour_hex} name={v.colour} /> <span className="ml-1">{v.colour}</span> · <span className="font-medium">{v.size}</span></Td>
      <Td className="tabular text-caption">{v.sku}{canEdit ? <Input aria-label="Barcode" className="mt-1 h-8 text-caption" value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))} /> : <span className="block text-ink-500">{v.barcode}</span>}</Td>
      <Td className="w-28">{canEdit ? <Input aria-label="Selling price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /> : <span className="tabular">{rs(v.selling_price_paise)}</span>}</Td>
      <Td className="w-20">{canEdit ? <Input aria-label="Reorder level" inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value)} /> : <span className="tabular">{v.min_stock}</span>}</Td>
      <Td className={`text-right tabular ${v.stock <= 0 ? 'font-semibold text-danger' : ''}`}>{v.stock}</Td>
      <Td className="w-20 text-right">{canEdit && dirty && <Button size="sm" onClick={save} loading={busy}>Save</Button>}</Td>
    </Tr>
  );
};

const AddMore = ({ style, onClose, onSaved }) => {
  const tr = useT();
  const [colours, setColours] = useState(''); const [sizes, setSizes] = useState('');
  const [error, setError] = useState(''); const [busy, run] = useAction();
  const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const save = () => run(async () => {
    setError('');
    try { const out = await api(`/clothing/styles/${style.style_id}/variants`, { method: 'POST', body: { ...(list(colours).length ? { colours: list(colours) } : {}), ...(list(sizes).length ? { sizes: list(sizes) } : {}) } }); onSaved(out); } catch (e) { setError(e.message); }
  });
  return (
    <Modal title={tr('Add colours or sizes')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button onClick={save} loading={busy} disabled={!list(colours).length && !list(sizes).length}>{tr('Add')}</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <p className="text-small text-ink-500">{tr('Only the combinations this style does not have yet are made. Leave one box empty to use what the style already has.')}</p>
        <Field id="am-c" label={tr('New colours')} hint={tr('Separate with commas')}><Input id="am-c" value={colours} onChange={(e) => setColours(e.target.value)} placeholder="Maroon, Olive" autoFocus /></Field>
        <Field id="am-s" label={tr('New sizes')} hint={tr('Separate with commas')}><Input id="am-s" value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="XXL, 3XL" /></Field>
      </div>
    </Modal>
  );
};

const StyleDetail = ({ id, onClose, onChanged }) => {
  const tr = useT();
  const { can } = useAuth();
  const canEdit = can('products');
  const toast = useToast();
  const l = useLoad(`/clothing/styles/${id}`);
  const [tab, setTab] = useState('grid'); const [adding, setAdding] = useState(false);
  const s = l.data;
  const reload = () => { l.reload(); onChanged?.(); };
  const setStatus = (status) => api(`/clothing/styles/${id}`, { method: 'PATCH', body: { status } }).then(() => { toast.success(status === 'ARCHIVED' ? 'Archived' : 'Brought back'); reload(); }).catch((e) => toast.error(e.message));
  return (
    <Modal wide title={s ? s.name : tr('Style')} onClose={onClose}>
      <ListState loading={l.loading && !s} error={l.error} />
      {s && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-small text-ink-700">
            <span className="tabular font-medium">{s.style_code}</span>
            {s.category_name && <Badge>{s.category_name}</Badge>}<Badge>{GENDER_LABEL[s.gender]}</Badge>{s.brand_name && <Badge>{s.brand_name}</Badge>}
            {s.fabric && <span>{s.fabric}</span>}{s.fit && <span>· {s.fit}</span>}{s.season && <span>· {s.season}</span>}
            <span>· {tr('GST {{n}}%', { n: Number(s.tax_rate) })}{s.hsn_sac ? ` · HSN ${s.hsn_sac}` : ''}</span>
            {s.status === 'ARCHIVED' && <Badge tone="warning">{tr('Archived')}</Badge>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-small text-ink-700">{tr('{{n}} in stock across {{v}} sizes and colours', { n: s.stock, v: s.variants.length })} · {rs(s.selling_price_paise)}{s.mrp_paise ? ` (MRP ${rs(s.mrp_paise)})` : ''}</p>
            <div className="flex flex-wrap gap-2">
              <Link to={`/app/clothing/labels?styles=${s.style_id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-small font-semibold text-ink-700 hover:bg-surface-2"><Printer aria-hidden="true" className="h-4 w-4" /> {tr('Print tags')}</Link>
              {canEdit && <>
              {s.status === 'ACTIVE' && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" /> {tr('Add colours or sizes')}</Button>}
              <Button size="sm" variant="ghost" onClick={() => setStatus(s.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE')}>{s.status === 'ACTIVE' ? tr('Archive') : tr('Bring back')}</Button>
              </>}
            </div>
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ key: 'grid', label: T('Stock by size and colour') }, { key: 'variants', label: T('SKUs and barcodes'), count: s.variants.length }]} />
          {tab === 'grid' && <Grid matrix={s.matrix} />}
          {tab === 'variants' && (
            <>
            <ul className="divide-y divide-line rounded-xl border border-line sm:hidden">{s.variants.map((v) => <VariantRow card key={`${v.product_id}-${v.selling_price}-${v.min_stock}`} v={v} canEdit={canEdit} onSaved={reload} />)}</ul>
            <div className="hidden sm:block"><Table>
              <Thead><Th>{tr('Variant')}</Th><Th>{tr('SKU / barcode')}</Th><Th>{tr('Price')}</Th><Th>{tr('Reorder')}</Th><Th className="text-right">{tr('Stock')}</Th><Th><span className="sr-only">{tr('Save')}</span></Th></Thead>
              <tbody>{s.variants.map((v) => <VariantRow key={`${v.product_id}-${v.selling_price}-${v.min_stock}`} v={v} canEdit={canEdit} onSaved={reload} />)}</tbody>
            </Table></div>
            </>
          )}
          {adding && <AddMore style={s} onClose={() => setAdding(false)} onSaved={(out) => { setAdding(false); toast.success(out.variants.length ? `${out.variants.length} added` : 'Nothing new to add'); reload(); }} />}
        </div>
      )}
    </Modal>
  );
};

/* ── the wizard ─────────────────────────────────────────────────────────── */
const STEPS = [T('Details'), T('Colours and sizes'), T('Prices and stock'), T('Check and save')];

const NewStyle = ({ onClose, onSaved }) => {
  const tr = useT();
  const meta = useLoad('/clothing/meta');
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: '', category_id: '', brand: '', gender: 'MEN', season: '', fabric: '', fit: '', pattern: '', hsn_sac: '', tax_rate: '5', mrp: '', selling_price: '', purchase_price: '', reorder_level: '3', style_code: '' });
  const [sizes, setSizes] = useState([]); const [setName, setSetName] = useState('');
  const [colours, setColours] = useState([]);
  const [qty, setQty] = useState({});
  const [customSize, setCustomSize] = useState(''); const [customColour, setCustomColour] = useState('');
  const [error, setError] = useState(''); const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const sets = meta.data?.size_sets || []; const palette = meta.data?.colours || [];
  const colourOptions = useMemo(() => [...palette, ...colours.filter((c) => !palette.some((p) => same(p.name, c.name)))], [palette, colours]);
  const categories = meta.data?.categories || [];
  const tops = categories.filter((c) => !c.parent_id);

  const toggleSize = (s) => setSizes((x) => (x.some((y) => same(y, s)) ? x.filter((y) => !same(y, s)) : [...x, s]));
  const toggleColour = (c) => setColours((x) => (x.some((y) => same(y.name, c.name)) ? x.filter((y) => !same(y.name, c.name)) : [...x, c]));
  const pickSet = (name) => { const found = sets.find((s) => s.name === name); setSetName(name); if (found) setSizes(found.sizes); };
  const addSize = () => { const v = customSize.trim(); if (v && !sizes.some((y) => same(y, v))) setSizes((x) => [...x, v]); setCustomSize(''); };
  const addColour = () => { const v = customColour.trim(); if (v && !colours.some((y) => same(y.name, v))) setColours((x) => [...x, { name: v, hex: null }]); setCustomColour(''); };
  const cell = (c, s) => qty[`${c}|${s}`] ?? '';
  const setCell = (c, s, v) => setQty((x) => ({ ...x, [`${c}|${s}`]: v }));
  const fillRow = (c, v) => setQty((x) => ({ ...x, ...Object.fromEntries(sizes.map((s) => [`${c}|${s}`, v])) }));
  const total = colours.reduce((a, c) => a + sizes.reduce((b, s) => b + (Number(cell(c.name, s)) || 0), 0), 0);

  const priceOk = !f.mrp || !f.selling_price || Number(f.selling_price) <= Number(f.mrp);
  const can = [f.name.trim().length > 0, colours.length > 0 && sizes.length > 0, Number(f.selling_price) > 0 && priceOk, true][step];

  const save = () => run(async () => {
    setError('');
    const stock = colours.flatMap((c) => sizes.map((s) => ({ colour: c.name, size: s, qty: Number(cell(c.name, s)) || 0 }))).filter((r) => r.qty > 0);
    const body = { ...f, colours, sizes, stock, size_set: setName || undefined };
    for (const k of Object.keys(body)) if (body[k] === '') delete body[k];
    try { onSaved(await api('/clothing/styles', { method: 'POST', body })); } catch (e) { setError(e.message); }
  });

  return (
    <Modal wide title={tr('New style')} onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={step === 0 ? onClose : () => setStep(step - 1)}>{step === 0 ? tr('Cancel') : tr('Back')}</Button>
        {step < 3 ? <Button onClick={() => setStep(step + 1)} disabled={!can}>{tr('Next')}</Button> : <Button onClick={save} loading={busy}>{tr('Save style')}</Button>}
      </>}>
      <ol className="mb-5 flex flex-wrap gap-2 text-caption" aria-label={tr('Steps')}>
        {STEPS.map((s, i) => <li key={i} aria-current={i === step ? 'step' : undefined} className={`rounded-full px-3 py-1 font-medium ${i === step ? 'bg-brand-500 text-white' : i < step ? 'bg-brand-50 text-brand-700' : 'bg-surface-3 text-ink-500'}`}>{i + 1}. {tr(s)}</li>)}
      </ol>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field id="ns-name" label={tr('Product name')}><Input id="ns-name" value={f.name} onChange={set('name')} autoFocus placeholder={tr('Men\'s cotton T-shirt')} /></Field></div>
            <Field id="ns-cat" label={tr('Category')} hint={tr('Use Set up categories on the Styles page for the usual clothing ones.')}>
              <Select id="ns-cat" value={f.category_id} onChange={set('category_id')}><option value="">{tr('Choose…')}</option>
                {tops.map((t) => <optgroup key={t.category_id} label={t.name}><option value={t.category_id}>{t.name}</option>{categories.filter((c) => c.parent_id === t.category_id).map((c) => <option key={c.category_id} value={c.category_id}>{t.name} › {c.name}</option>)}</optgroup>)}
              </Select>
            </Field>
            <Field id="ns-gender" label={tr('For')}><Select id="ns-gender" value={f.gender} onChange={set('gender')}>{GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <Field id="ns-brand" label={tr('Brand')}><Input id="ns-brand" value={f.brand} onChange={set('brand')} /></Field>
            <Field id="ns-season" label={tr('Season')}><Input id="ns-season" value={f.season} onChange={set('season')} placeholder={tr('Summer 2026')} /></Field>
            <Field id="ns-fabric" label={tr('Fabric')}><Input id="ns-fabric" value={f.fabric} onChange={set('fabric')} placeholder={tr('Cotton')} /></Field>
            <Field id="ns-fit" label={tr('Fit')}><Input id="ns-fit" value={f.fit} onChange={set('fit')} placeholder={tr('Regular, slim')} /></Field>
            <Field id="ns-pattern" label={tr('Pattern')}><Input id="ns-pattern" value={f.pattern} onChange={set('pattern')} placeholder={tr('Plain, striped')} /></Field>
            <Field id="ns-hsn" label={tr('HSN code')}><Input id="ns-hsn" value={f.hsn_sac} onChange={set('hsn_sac')} placeholder="6109" /></Field>
            <NumberField id="ns-gst" label="GST" suffix="%" value={f.tax_rate} onChange={(v) => setF((x) => ({ ...x, tax_rate: v }))} hint="Clothing is usually 5% up to ₹1,000 and 12% above, but check with your accountant" />
          </div>
        )}
        {step === 1 && (
          <div className="space-y-6">
            <section aria-labelledby="ns-sizes">
              <h3 id="ns-sizes" className="mb-2 text-small font-semibold text-ink-900">{tr('Sizes')}</h3>
              <div className="mb-3 flex flex-wrap gap-2">{sets.map((s) => <Button key={s.name} size="sm" variant={setName === s.name ? 'primary' : 'secondary'} onClick={() => pickSet(s.name)}>{s.name}</Button>)}</div>
              <div className="flex flex-wrap gap-2">
                {[...new Set([...(sets.find((s) => s.name === setName)?.sizes || []), ...sizes])].map((s) => (
                  <button key={s} type="button" aria-pressed={sizes.some((y) => same(y, s))} onClick={() => toggleSize(s)}
                    className={`rounded-lg border px-3 py-1.5 text-small font-medium ${sizes.some((y) => same(y, s)) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-500'}`}>{s}</button>
                ))}
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addSize(); }}><Input aria-label={tr('Another size')} className="w-28" placeholder={tr('Another size')} value={customSize} onChange={(e) => setCustomSize(e.target.value)} /><Button type="submit" size="sm" variant="secondary">{tr('Add')}</Button></form>
              </div>
            </section>
            <section aria-labelledby="ns-colours">
              <h3 id="ns-colours" className="mb-2 text-small font-semibold text-ink-900">{tr('Colours')}</h3>
              <div className="flex flex-wrap gap-2">
                {colourOptions.map((c) => (
                  <button key={c.name} type="button" aria-pressed={colours.some((y) => same(y.name, c.name))} onClick={() => toggleColour(c)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-small font-medium ${colours.some((y) => same(y.name, c.name)) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-500'}`}><Swatch hex={c.hex} name={c.name} />{c.name}</button>
                ))}
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addColour(); }}><Input aria-label={tr('Another colour')} className="w-32" placeholder={tr('Another colour')} value={customColour} onChange={(e) => setCustomColour(e.target.value)} /><Button type="submit" size="sm" variant="secondary">{tr('Add')}</Button></form>
              </div>
            </section>
            <p className="text-small text-ink-500">{tr('{{n}} colours × {{m}} sizes = {{v}} variants, each with its own SKU and barcode.', { n: colours.length, m: sizes.length, v: colours.length * sizes.length })}</p>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-4">
              <NumberField id="ns-mrp" label="MRP" prefix="₹" value={f.mrp} onChange={(v) => setF((x) => ({ ...x, mrp: v }))} />
              <NumberField id="ns-sell" label="Selling price" prefix="₹" required value={f.selling_price} onChange={(v) => setF((x) => ({ ...x, selling_price: v }))} />
              <NumberField id="ns-cost" label="Purchase cost" prefix="₹" value={f.purchase_price} onChange={(v) => setF((x) => ({ ...x, purchase_price: v }))} />
              <NumberField id="ns-re" label="Reorder when stock is" value={f.reorder_level} onChange={(v) => setF((x) => ({ ...x, reorder_level: v }))} />
            </div>
            {!priceOk && <Alert>{tr('The selling price cannot be above the MRP.')}</Alert>}
            <div>
              <h3 className="mb-1 text-small font-semibold text-ink-900">{tr('Opening stock')}</h3>
              <p className="mb-2 text-caption text-ink-500">{tr('How many of each you have now. Leave blank for none. Counted into the outlet you are in.')}</p>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-small">
                  <thead><tr className="bg-surface-2 text-left text-caption text-ink-500"><th className="px-3 py-2 font-semibold">{tr('Colour')}</th>{sizes.map((s) => <th key={s} className="px-2 py-2 text-center font-semibold">{s}</th>)}</tr></thead>
                  <tbody>{colours.map((c) => (
                    <tr key={c.name} className="border-t border-line">
                      <td className="whitespace-nowrap px-3 py-1.5 font-medium"><Swatch hex={c.hex} name={c.name} /> <span className="ml-1">{c.name}</span></td>
                      {sizes.map((s) => <td key={s} className="px-1 py-1"><Input aria-label={`${c.name} ${s}`} className="w-16 text-center" inputMode="numeric" value={cell(c.name, s)} onChange={(e) => setCell(c.name, s, e.target.value.replace(/[^0-9]/g, ''))} /></td>)}
                      <td className="px-2"><Button size="sm" variant="ghost" onClick={() => fillRow(c.name, '5')}>{tr('All 5')}</Button></td>
                    </tr>))}</tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3 text-small text-ink-700">
            <p><span className="font-semibold text-ink-900">{f.name}</span> · {GENDER_LABEL[f.gender]}{f.brand ? ` · ${f.brand}` : ''}</p>
            <p>{tr('{{v}} variants will be made: {{c}} colours × {{s}} sizes, with {{n}} pieces in stock to start.', { v: colours.length * sizes.length, c: colours.length, s: sizes.length, n: total })}</p>
            <p>{tr('Selling {{p}}{{m}}, GST {{g}}%.', { p: rs(Math.round(Number(f.selling_price) * 100)), m: f.mrp ? ` (MRP ${rs(Math.round(Number(f.mrp) * 100))})` : '', g: f.tax_rate || 0 })}</p>
            <p className="text-ink-500">{tr('Each variant gets a SKU like ST00012-BLA-M and a barcode you can print on a tag.')}</p>
          </div>
        )}
      </div>
    </Modal>
  );
};

/* ── import ─────────────────────────────────────────────────────────────── */
const SAMPLE = 'style,colour,size,qty,selling_price,purchase_price,mrp,category,brand,gender,hsn,gst\nSlim Jeans,Indigo,30,5,1299,700,1799,,Denimco,men,6203,12\nSlim Jeans,Indigo,32,8,1299,700,1799,,Denimco,men,6203,12\n';
const normKey = (k) => String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const ImportStyles = ({ onClose, onDone }) => {
  const tr = useT();
  const [rows, setRows] = useState(null); const [result, setResult] = useState(null); const [error, setError] = useState('');
  const [busy, run] = useAction();
  const pick = async (file) => {
    setError(''); setResult(null);
    try { const t = await readTable(file); setRows(t.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [normKey(k), v])))); } catch (e) { setError(e.message || 'That file could not be read'); }
  };
  const send = (check) => run(async () => {
    setError('');
    try { const out = await api('/clothing/styles/import', { method: 'POST', body: { rows, check } }); setResult(out); if (!check) onDone(out); } catch (e) { setError(e.message); }
  });
  return (
    <Modal wide title={tr('Import styles')} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{tr('Close')}</Button><Button variant="secondary" onClick={() => send(true)} disabled={!rows} loading={busy}>{tr('Check the file')}</Button><Button onClick={() => send(false)} disabled={!rows || result?.ok === false} loading={busy}>{tr('Import')}</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <p className="text-small text-ink-700">{tr('One row for each size and colour. Rows with the same style name become one style. Everything is checked first and nothing is saved if a row is wrong.')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,.xlsx" aria-label={tr('Choose a file')} onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} className="text-small" />
          <a className="text-small text-brand-600 underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`} download="clothing-import-sample.csv">{tr('Download a sample file')}</a>
        </div>
        {rows && <p className="text-small text-ink-500">{tr('{{n}} rows read.', { n: rows.length })}</p>}
        {result?.ok && <Alert>{result.saved ? tr('{{n}} styles with {{v}} variants imported.', { n: result.styles, v: result.variants }) : tr('The file is fine: {{n}} styles with {{v}} variants. Press Import to save them.', { n: result.styles, v: result.variants })}</Alert>}
        {result?.ok === false && <ul className="list-disc pl-5 text-small text-danger">{result.problems.slice(0, 12).map((p, i) => <li key={i}>{p.line ? `${tr('Row')} ${p.line}: ` : ''}{p.message}</li>)}</ul>}
      </div>
    </Modal>
  );
};

/* ── the list ───────────────────────────────────────────────────────────── */
export default function ClothingStyles() {
  const tr = useT();
  const { can } = useAuth();
  const canEdit = can('products');
  const toast = useToast();
  const [search, setSearch] = useState(''); const q = useDebounced(search, 300);
  const [gender, setGender] = useState(''); const [status, setStatus] = useState('ACTIVE'); const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false); const [importing, setImporting] = useState(false); const [open, setOpen] = useState(null);
  const list = useLoad(`/clothing/styles${qs({ search: q, gender, status: status === 'ACTIVE' ? '' : status, limit: 24, offset })}`, { paged: true });
  const meta = useLoad('/clothing/meta');
  const rows = list.data || [];
  const setup = async () => { try { await api('/clothing/setup', { method: 'POST' }); meta.reload(); toast.success('Categories ready'); } catch (e) { toast.error(e.message); } };
  return (
    <div>
      <PageHeader title={tr('Styles and sizes')} lead={tr('Each product with every size and colour. Scan a tag or search by name, style code, SKU or barcode.')}
        action={canEdit && <><Button variant="secondary" onClick={() => setImporting(true)}><Upload aria-hidden="true" className="h-4 w-4" /> {tr('Import')}</Button><Button onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" /> {tr('New style')}</Button></>} />
      {meta.data?.needs_setup && canEdit && <Panel className="mb-4" title={tr('Set up your categories')} lead={tr('Add the usual clothing categories (Men\'s Wear, Women\'s Wear, Kids\' Wear, Ethnic Wear and more) with their subcategories. You can rename or remove them later.')} action={<Button onClick={setup}>{tr('Add categories')}</Button>} />}
      <Toolbar>
        <div className="relative w-full max-w-sm"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input aria-label={tr('Search styles')} className="pl-9" placeholder={tr('Name, style code, SKU, barcode')} value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} /></div>
        <Chips label={tr('For')} value={gender} onChange={(v) => { setGender(v); setOffset(0); }} options={[{ value: '', label: tr('All') }, ...GENDERS.slice(0, 3).map(([value, label]) => ({ value, label }))]} />
        <Chips label={tr('Show')} value={status} onChange={(v) => { setStatus(v); setOffset(0); }} options={[{ value: 'ACTIVE', label: tr('Active') }, { value: 'ARCHIVED', label: tr('Archived') }]} />
      </Toolbar>
      <ListState loading={list.loading && !list.data} error={list.error} empty={list.data && rows.length === 0} emptyLabel={tr('No styles yet.')} emptyBody={canEdit ? tr('Add your first style: pick its colours and sizes and every combination gets its own SKU and barcode.') : undefined} />
      {rows.length > 0 && (
        <Panel className="!p-0">
          <ul className="divide-y divide-line sm:hidden">
            {rows.map((s) => (
              <li key={s.style_id}>
                <button type="button" onClick={() => setOpen(s.style_id)} className="block w-full px-4 py-3 text-left">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 font-medium text-ink-900">{s.name}</span>
                    <span className="tabular shrink-0 text-small font-medium text-ink-900">{s.price_from_paise === s.price_to_paise ? rs(s.price_from_paise) : `${rs(s.price_from_paise)} – ${rs(s.price_to_paise)}`}</span>
                  </span>
                  <span className="block text-caption text-ink-500">{s.style_code} · {GENDER_LABEL[s.gender]}{s.brand_name ? ` · ${s.brand_name}` : ''}</span>
                  <span className="mt-1.5 flex flex-wrap gap-1">{(s.colours || []).slice(0, 6).map((c) => <span key={c} className="rounded-full bg-surface-3 px-2 py-0.5 text-caption">{c}</span>)}</span>
                  <span className="mt-1.5 block text-caption text-ink-500">{tr('{{n}} in stock across {{v}} sizes and colours', { n: s.stock, v: s.variants })}{s.sold_out > 0 && <span className="text-danger"> · {tr('{{n}} sold out', { n: s.sold_out })}</span>}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden sm:block"><Table>
            <Thead><Th>{tr('Style')}</Th><Th>{tr('Colours')}</Th><Th className="text-right">{tr('Price')}</Th><Th className="text-right">{tr('Variants')}</Th><Th className="text-right">{tr('In stock')}</Th></Thead>
            <tbody>
              {rows.map((s) => (
                <Tr key={s.style_id} onClick={() => setOpen(s.style_id)}>
                  <Td><span className="font-medium">{s.name}</span><span className="block text-caption text-ink-500">{s.style_code} · {GENDER_LABEL[s.gender]}{s.brand_name ? ` · ${s.brand_name}` : ''}{s.category_name ? ` · ${s.category_name}` : ''}</span></Td>
                  <Td><span className="flex flex-wrap gap-1">{(s.colours || []).slice(0, 8).map((c) => <span key={c} className="rounded-full bg-surface-3 px-2 py-0.5 text-caption">{c}</span>)}</span></Td>
                  <Td className="tabular text-right">{s.price_from_paise === s.price_to_paise ? rs(s.price_from_paise) : `${rs(s.price_from_paise)} – ${rs(s.price_to_paise)}`}</Td>
                  <Td className="tabular text-right">{s.variants}{s.sold_out > 0 && <span className="block text-caption text-danger">{tr('{{n}} sold out', { n: s.sold_out })}</span>}</Td>
                  <Td className="tabular text-right font-medium">{s.stock}</Td>
                </Tr>
              ))}
            </tbody>
          </Table></div>
          <Pager meta={list.meta} onPage={setOffset} />
        </Panel>
      )}
      {adding && <NewStyle onClose={() => setAdding(false)} onSaved={(out) => { setAdding(false); list.reload(); toast.success(`${out.variants.length} variants made`); setOpen(out.style_id); }} />}
      {importing && <ImportStyles onClose={() => setImporting(false)} onDone={(out) => { list.reload(); toast.success(`${out.styles} styles imported`); setImporting(false); }} />}
      {open && <StyleDetail id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </div>
  );
}
