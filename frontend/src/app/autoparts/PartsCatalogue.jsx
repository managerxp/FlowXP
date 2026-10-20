/* The parts catalogue: search by name, SKU, barcode or any part number; add a part; open one to see its numbers, the vehicles it fits (never assumed), where it sits on the racks and how it moved. */
import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { CLASSIFICATIONS, CLASS_LABEL, FIT, KIND_LABEL, NUMBER_KINDS, VEHICLE_TYPES, VEHICLE_LABEL, n3, qs, rsPaise, useDebounced, useLoad } from '../../lib/autoparts.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr, useToast } from '../../components/ui.jsx';
import { Chips, NumberField, Pager, Panel, Tabs, Toolbar, useAction } from '../salon/parts.jsx';
import { useT, T } from '../../i18n/useT.js';

/* ── add a part ─────────────────────────────────────────────────────────── */
const AddPart = ({ onClose, onSaved }) => {
  const tr = useT();
  const [f, setF] = useState({ name: '', sku: '', barcode: '', selling_price: '', purchase_price: '', mrp: '', tax_rate: '18', hsn_sac: '', classification: 'AFTERMARKET', vehicle_type: 'CAR', oem_part_no: '', mfr_part_no: '', reorder_level: '', opening_stock: '' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = () => run(async () => {
    setError('');
    const body = { ...f };
    for (const k of Object.keys(body)) if (body[k] === '') delete body[k];
    if (body.opening_stock) body.current_stock = Number(body.opening_stock);
    delete body.opening_stock;
    try { onSaved(await api('/autoparts/parts', { method: 'POST', body })); } catch (e) { setError(e.message); }
  }, null);
  return (
    <Modal wide title={tr('Add a part')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button onClick={save} loading={busy} disabled={!f.name.trim() || f.selling_price === ''}>{tr('Add part')}</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="ap-name" label={tr('Name')}><Input id="ap-name" value={f.name} onChange={set('name')} autoFocus placeholder={tr('Front brake pad set, Swift 1.2')} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="ap-sku" label={tr('SKU')} hint={tr('Left blank, one is made for you')}><Input id="ap-sku" value={f.sku} onChange={set('sku')} /></Field>
          <Field id="ap-bc" label={tr('Barcode')}><Input id="ap-bc" value={f.barcode} onChange={set('barcode')} /></Field>
          <Field id="ap-hsn" label={tr('HSN')}><Input id="ap-hsn" value={f.hsn_sac} onChange={set('hsn_sac')} placeholder="87083000" /></Field>
          <Field id="ap-oem" label={tr('OEM part number')}><Input id="ap-oem" value={f.oem_part_no} onChange={set('oem_part_no')} /></Field>
          <Field id="ap-mfr" label={tr('Manufacturer part number')}><Input id="ap-mfr" value={f.mfr_part_no} onChange={set('mfr_part_no')} /></Field>
          <Field id="ap-cl" label={tr('Type of part')}><Select id="ap-cl" value={f.classification} onChange={set('classification')}>{CLASSIFICATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field id="ap-vt" label={tr('For')}><Select id="ap-vt" value={f.vehicle_type} onChange={set('vehicle_type')}>{VEHICLE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <NumberField id="ap-sell" label={tr('Selling price')} prefix="₹" value={f.selling_price} onChange={(v) => setF((x) => ({ ...x, selling_price: v }))} />
          <NumberField id="ap-cost" label={tr('Purchase price')} prefix="₹" value={f.purchase_price} onChange={(v) => setF((x) => ({ ...x, purchase_price: v }))} />
          <NumberField id="ap-mrp" label={tr('MRP')} prefix="₹" value={f.mrp} onChange={(v) => setF((x) => ({ ...x, mrp: v }))} />
          <NumberField id="ap-tax" label={tr('GST')} suffix="%" value={f.tax_rate} onChange={(v) => setF((x) => ({ ...x, tax_rate: v }))} />
          <NumberField id="ap-rl" label={tr('Reorder level')} value={f.reorder_level} onChange={(v) => setF((x) => ({ ...x, reorder_level: v }))} />
          <NumberField id="ap-os" label={tr('Opening stock')} hint={tr('Counted into the outlet you are in')} value={f.opening_stock} onChange={(v) => setF((x) => ({ ...x, opening_stock: v }))} />
        </div>
      </div>
    </Modal>
  );
};

/* ── one part ───────────────────────────────────────────────────────────── */
const Numbers = ({ part, canEdit, reload }) => {
  const tr = useT();
  const [number, setNumber] = useState(''); const [kind, setKind] = useState('ALTERNATE');
  const [busy, run] = useAction();
  const add = () => run(async () => { await api(`/autoparts/parts/${part.product_id}/numbers`, { method: 'POST', body: { number, kind } }); setNumber(''); reload(); }, 'Number added');
  const remove = (n) => run(async () => { await api(`/autoparts/parts/${part.product_id}/numbers/${n.pn_id}`, { method: 'DELETE' }); reload(); }, 'Removed');
  return (
    <div className="space-y-3">
      <p className="text-small text-ink-500">{tr('Every number this part is known by. Scanning or typing any of them, with or without dashes, finds the part.')}</p>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {part.numbers.length === 0 && <li className="px-4 py-3 text-small text-ink-500">{tr('No part numbers yet.')}</li>}
        {part.numbers.map((n) => (
          <li key={n.pn_id} className="flex items-center justify-between px-4 py-2 text-small"><span><span className="font-medium tabular">{n.number}</span> <Badge>{KIND_LABEL[n.kind]}</Badge></span>
            {canEdit && <Button size="sm" variant="ghost" onClick={() => remove(n)}>{tr('Remove')}</Button>}</li>
        ))}
      </ul>
      {canEdit && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (number.trim()) add(); }}>
          <Field id="pn-num" label={tr('Add a number')}><Input id="pn-num" value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
          <Field id="pn-kind" label={tr('Kind')}><Select id="pn-kind" value={kind} onChange={(e) => setKind(e.target.value)}>{NUMBER_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Button type="submit" loading={busy} disabled={!number.trim()}>{tr('Add')}</Button>
        </form>
      )}
    </div>
  );
};

const Fitment = ({ part, fit, canEdit, reload }) => {
  const tr = useT();
  const veh = useLoad('/autoparts/vehicles');
  const [model, setModel] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [busy, run] = useAction();
  const models = (veh.data || []).flatMap((mk) => mk.models.map((m) => ({ id: m.model_id, label: `${mk.name} ${m.name}` })));
  const add = () => run(async () => { await api(`/autoparts/parts/${part.product_id}/fitment`, { method: 'POST', body: { model_id: Number(model), year_from: from || null, year_to: to || null } }); reload(); }, 'Added as not verified');
  const setStatus = (r, status) => run(async () => { await api(`/autoparts/fitment/${r.fit_id}`, { method: 'PUT', body: { status } }); reload(); }, 'Saved');
  const remove = (r) => run(async () => { await api(`/autoparts/fitment/${r.fit_id}`, { method: 'DELETE' }); reload(); }, 'Removed');
  return (
    <div className="space-y-3">
      <p className="text-small text-ink-500">{tr('Only what is recorded here counts. A part with no record is never assumed to fit.')}</p>
      <ListState empty={fit.length === 0} emptyLabel={tr('No vehicles recorded for this part.')} />
      {fit.length > 0 && (
        <Table>
          <Thead><Th>{tr('Vehicle')}</Th><Th>{tr('Years')}</Th><Th>{tr('Fitment')}</Th><Th /></Thead>
          <tbody>
            {fit.map((r) => (
              <Tr key={r.fit_id}>
                <Td>{r.make} {r.model}{r.variant ? ` ${r.variant}` : ''}</Td>
                <Td className="tabular">{r.year_from || r.year_to ? `${r.year_from || '…'} to ${r.year_to || '…'}` : 'any'}</Td>
                <Td><Badge tone={FIT[r.status].tone}>{tr(FIT[r.status].label)}</Badge>{r.source && <span className="ml-2 text-caption text-ink-400">{r.source}</span>}</Td>
                <Td className="text-right">{canEdit && (<span className="inline-flex gap-1">
                  {r.status !== 'VERIFIED' && <Button size="sm" variant="secondary" onClick={() => setStatus(r, 'VERIFIED')}>{tr('Verify')}</Button>}
                  {r.status !== 'NOT_FIT' && <Button size="sm" variant="ghost" onClick={() => setStatus(r, 'NOT_FIT')}>{tr('Does not fit')}</Button>}
                  <Button size="sm" variant="ghost" onClick={() => remove(r)}>{tr('Remove')}</Button></span>)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {canEdit && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (model) add(); }}>
          <Field id="ft-model" label={tr('Add a vehicle')}><Select id="ft-model" value={model} onChange={(e) => setModel(e.target.value)}><option value="">{tr('Choose a model')}</option>{models.map((m) => <option key={m.id} value={m.id}>{tr(m.label)}</option>)}</Select></Field>
          <Field id="ft-from" label={tr('From year')}><div className="w-24"><Input id="ft-from" type="number" value={from} onChange={(e) => setFrom(e.target.value)} /></div></Field>
          <Field id="ft-to" label={tr('To year')}><div className="w-24"><Input id="ft-to" type="number" value={to} onChange={(e) => setTo(e.target.value)} /></div></Field>
          <Button type="submit" loading={busy} disabled={!model}>{tr('Add')}</Button>
        </form>
      )}
    </div>
  );
};

const Where = ({ part }) => {
  const tr = useT();
  const l = useLoad(`/autoparts/parts/${part.product_id}/locations`);
  const d = l.data;
  return (
    <div className="space-y-3">
      <ListState loading={l.loading && !d} error={l.error} />
      {d && (
        <>
          <p className="text-small text-ink-700">{tr('{{n3}} on hand: {{n32}} on shelves and {{n33}} waiting for a bin.', { n3: n3(d.on_hand), n32: n3(d.binned), n33: n3(d.unassigned) })}</p>
          <Table>
            <Thead><Th>{tr('Bin')}</Th><Th className="text-right">{tr('Quantity')}</Th><Th className="text-right">{tr('Held')}</Th></Thead>
            <tbody>
              {d.bins.length === 0 && <tr><Td colSpan={3} className="text-ink-500">{tr('Not on any shelf yet. Use Racks and bins to put it away.')}</Td></tr>}
              {d.bins.map((b) => (<Tr key={b.location_id}><Td>{b.code}{b.is_primary && <Badge tone="brand"> {tr('pick bin')}</Badge>}</Td><Td className="tabular text-right">{n3(b.qty)}</Td><Td className="tabular text-right">{n3(b.reserved_qty)}</Td></Tr>))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
};

const Ledger = ({ part }) => {
  const tr = useT();
  const l = useLoad(`/autoparts/parts/${part.product_id}/ledger`);
  const together = useLoad(`/autoparts/parts/${part.product_id}/together`);
  return (
    <div className="space-y-4">
      {together.data?.length > 0 && <p className="text-small text-ink-700">{tr('Often bought with: {{v}}', { v: together.data.map((t) => `${t.name} (${t.bills} bills)`).join(', ') })}</p>}
      <ListState loading={l.loading && !l.data} error={l.error} empty={l.data && l.data.movements.length === 0} emptyLabel={tr('No movements yet.')} />
      {l.data?.movements.length > 0 && (
        <Table>
          <Thead><Th>{tr('When')}</Th><Th>{tr('What')}</Th><Th className="text-right">{tr('Quantity')}</Th><Th>{tr('Where')}</Th></Thead>
          <tbody>
            {l.data.movements.slice(0, 60).map((m, i) => (
              <Tr key={i}><Td className="whitespace-nowrap">{new Date(m.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Td>
                <Td>{m.ledger === 'BIN' ? `Shelf: ${m.kind.toLowerCase()}` : m.kind.toLowerCase()}</Td><Td className="tabular text-right">{n3(m.qty)}</Td>
                <Td>{m.ledger === 'BIN' ? `${m.from_code || 'waiting'} → ${m.to_code || 'out'}` : m.note || ''}</Td></Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
};

const PartDetail = ({ id, onClose, onChanged }) => {
  const tr = useT();
  const { can } = useAuth();
  const canEdit = can('parts_catalog');
  const part = useLoad(`/autoparts/parts/${id}`);
  const [tab, setTab] = useState('numbers');
  const toast = useToast();
  const p = part.data;
  const reload = () => { part.reload(); onChanged?.(); };
  return (
    <Modal wide title={p ? p.name : tr('Part')} onClose={onClose}>
      <ListState loading={part.loading && !p} error={part.error} />
      {p && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-small text-ink-700">
            <span className="tabular font-medium">{p.sku}</span>{p.classification && <Badge>{CLASS_LABEL[p.classification]}</Badge>}{p.vehicle_type && <Badge>{VEHICLE_LABEL[p.vehicle_type]}</Badge>}
            <span>{rsPaise(p.selling_price_paise)}{p.mrp_paise ? ` (MRP ${rsPaise(p.mrp_paise)})` : ''}</span><span>{tr('{{n3}} in stock', { n3: n3(p.stock) })}</span>
            {!p.has_profile && canEdit && <Button size="sm" variant="secondary" onClick={async () => { try { await api(`/autoparts/parts/${p.product_id}/profile`, { method: 'PUT', body: { classification: 'AFTERMARKET', vehicle_type: 'CAR' } }); reload(); } catch (e) { toast.error(e.message); } }}>{tr('Add the part details')}</Button>}
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ key: 'numbers', label: T('Part numbers'), count: p.numbers.length }, { key: 'fitment', label: T('Vehicles'), count: p.fitment.length }, { key: 'where', label: T('Where it is') }, { key: 'moves', label: T('Movements') }]} />
          {tab === 'numbers' && <Numbers part={p} canEdit={canEdit} reload={reload} />}
          {tab === 'fitment' && <Fitment part={p} fit={p.fitment} canEdit={canEdit} reload={reload} />}
          {tab === 'where' && <Where part={p} />}
          {tab === 'moves' && <Ledger part={p} />}
        </div>
      )}
    </Modal>
  );
};

/* ── the list ───────────────────────────────────────────────────────────── */
const STOCK = [['', 'All'], ['in', T('In stock')], ['low', T('Low')], ['out', T('Out of stock')], ['over', T('Over max')]];

export default function PartsCatalogue() {
  const tr = useT();
  const { can } = useAuth();
  const canEdit = can('parts_catalog');
  const [search, setSearch] = useState(''); const q = useDebounced(search, 300);
  const [stock, setStock] = useState(''); const [vt, setVt] = useState(''); const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false); const [open, setOpen] = useState(null);
  const list = useLoad(`/autoparts/parts${qs({ search: q, stock, vehicle_type: vt, limit: 30, offset })}`, { paged: true });
  const rows = list.data || [];
  return (
    <div>
      <PageHeader title={tr('Parts')} lead={tr('Every part with its numbers, vehicles and shelf. Search by name, SKU, barcode or any part number.')}
        action={canEdit && <Button onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" /> {tr('Add part')}</Button>} />
      <Toolbar>
        <div className="relative w-full max-w-sm"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input aria-label={tr('Search parts')} className="pl-9" placeholder={tr('Name, SKU, barcode, OEM number')} value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} /></div>
        <Chips label={tr('Stock')} value={stock} onChange={(v) => { setStock(v); setOffset(0); }} options={STOCK.map(([value, label]) => ({ value, label }))} />
        <Select aria-label={tr('Vehicle type')} className="w-36" value={vt} onChange={(e) => { setVt(e.target.value); setOffset(0); }}><option value="">{tr('All vehicles')}</option>{VEHICLE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      </Toolbar>
      <ListState loading={list.loading && !list.data} error={list.error} empty={list.data && rows.length === 0} emptyLabel={tr('No parts found.')} />
      {rows.length > 0 && (
        <Panel className="!p-0">
          <Table>
            <Thead><Th>{tr('Part')}</Th><Th>{tr('OEM / mfr no.')}</Th><Th>{tr('Type')}</Th><Th className="text-right">{tr('Price')}</Th><Th className="text-right">{tr('Stock')}</Th></Thead>
            <tbody>
              {rows.map((p) => (
                <Tr key={p.product_id} onClick={() => setOpen(p.product_id)}>
                  <Td><span className="font-medium">{p.name}</span><span className="block text-caption text-ink-500">{p.sku}{p.brand_name ? ` · ${p.brand_name}` : ''}{!p.has_profile ? tr('· no part details') : ''}</span></Td>
                  <Td className="tabular text-small">{[p.oem_part_no, p.mfr_part_no].filter(Boolean).join(' / ') || '-'}</Td>
                  <Td>{p.classification ? CLASS_LABEL[p.classification] : '-'}</Td>
                  <Td className="tabular text-right">{rsPaise(p.selling_price_paise)}</Td>
                  <Td className={`tabular text-right ${p.stock <= 0 ? 'text-danger' : ''}`}>{n3(p.stock)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
      <Pager meta={list.meta} onPage={setOffset} />
      {adding && <AddPart onClose={() => setAdding(false)} onSaved={(p) => { setAdding(false); list.reload(); setOpen(p.product_id); }} />}
      {open && <PartDetail id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </div>
  );
}
