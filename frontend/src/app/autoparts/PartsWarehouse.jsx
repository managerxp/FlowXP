/* Racks and bins: the layout (warehouse, zone, aisle, rack, shelf, bin: the names are the shop's own), what is in each place, putting received stock away, moving it between bins, and the shop's settings. */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Printer } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { n3, qs, useDebounced, useLoad } from '../../lib/autoparts.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { NumberField, Panel, Tabs, Toggle, useAction } from '../salon/parts.jsx';

const KINDS = ['WAREHOUSE', 'ZONE', 'AISLE', 'RACK', 'SHELF', 'BIN'];
const typeLabel = (names, type) => (KINDS.includes(type) && names[KINDS.indexOf(type)]) || type.toLowerCase();

const AddLocation = ({ parent, names, onClose, onSaved }) => {
  const level = parent ? parent.level + 1 : 1;
  const [f, setF] = useState({ segment: '', name: '', bulk: false, count: '4', prefix: '', letters: false, can_store: level >= 4, capacity: '' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const save = () => run(async () => {
    setError('');
    const body = { parent_id: parent?.location_id, loc_type: f.can_store ? 'BIN' : undefined, can_store: f.can_store, capacity_units: f.capacity || undefined };
    try {
      if (f.bulk) await api('/autoparts/locations/bulk', { method: 'POST', body: { ...body, count: Number(f.count), prefix: f.prefix, letters: f.letters } });
      else await api('/autoparts/locations', { method: 'POST', body: { ...body, segment: f.segment, name: f.name || undefined } });
      onSaved();
    } catch (e) { setError(e.message); }
  }, null);
  return (
    <Modal title={parent ? `Add a place inside ${parent.code}` : `Add a ${(names[0] || 'warehouse').toLowerCase()}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={f.bulk ? !f.count : !f.segment.trim()}>Add</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Toggle id="al-bulk" checked={f.bulk} onChange={(v) => setF((x) => ({ ...x, bulk: v }))} label="Add several at once" hint="R01, R02, R03 ... or A, B, C ..." />
        {f.bulk ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="al-prefix" label="Starts with"><Input id="al-prefix" value={f.prefix} onChange={(e) => setF((x) => ({ ...x, prefix: e.target.value }))} placeholder="R" /></Field>
            <NumberField id="al-count" label="How many" value={f.count} min={1} step={1} onChange={(v) => setF((x) => ({ ...x, count: v }))} />
            <Toggle id="al-letters" checked={f.letters} onChange={(v) => setF((x) => ({ ...x, letters: v }))} label="Use letters" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="al-seg" label="Code" hint="Short, like R12 or B07. The full code is built from the places above it."><Input id="al-seg" value={f.segment} onChange={(e) => setF((x) => ({ ...x, segment: e.target.value }))} autoFocus /></Field>
            <Field id="al-name" label="Name (optional)"><Input id="al-name" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /></Field>
          </div>
        )}
        <Toggle id="al-store" checked={f.can_store} onChange={(v) => setF((x) => ({ ...x, can_store: v }))} label="Stock is kept here" hint="Bins and shelves hold stock. Warehouses, zones, aisles and racks only group them." />
        {f.can_store && <NumberField id="al-cap" label="Most units it should hold (optional)" value={f.capacity} onChange={(v) => setF((x) => ({ ...x, capacity: v }))} />}
      </div>
    </Modal>
  );
};

const LocationDetail = ({ id, onClose }) => {
  const d = useLoad(`/autoparts/locations/${id}`);
  const x = d.data;
  return (
    <Modal title={x ? x.code : 'Location'} onClose={onClose} wide>
      <ListState loading={d.loading && !x} error={d.error} />
      {x && (
        <div className="space-y-4">
          <p className="text-small text-ink-700">{x.path.map((p) => p.code).join('  ›  ')}</p>
          <div className="flex flex-wrap gap-2">{x.can_store && <Badge tone="brand">Holds stock</Badge>}{x.capacity_units != null && <Badge>Limit {n3(x.capacity_units)} units</Badge>}{!x.is_active && <Badge tone="danger">Switched off</Badge>}
            <Link to={`/app/parts/labels?ids=${x.location_id}`} className="text-small font-semibold text-brand-600">Print label</Link></div>
          {x.parts.length === 0 ? <p className="text-small text-ink-500">Nothing is stored here.</p> : (
            <Table>
              <Thead><Th>Part</Th><Th>Bin</Th><Th className="text-right">Quantity</Th><Th className="text-right">Held</Th></Thead>
              <tbody>{x.parts.map((p, i) => (<Tr key={i}><Td>{p.name}<span className="block text-caption text-ink-500">{p.sku}</span></Td><Td className="text-small">{p.location_code}{p.is_primary && ' (pick bin)'}</Td><Td className="tabular text-right">{n3(p.qty)}</Td><Td className="tabular text-right">{n3(p.reserved_qty)}</Td></Tr>))}</tbody>
            </Table>
          )}
        </div>
      )}
    </Modal>
  );
};

const Layout = ({ canEdit }) => {
  const tree = useLoad('/autoparts/locations');
  const settings = useLoad('/autoparts/warehouse/settings');
  const [adding, setAdding] = useState(null); const [open, setOpen] = useState(null);
  const [scan, setScan] = useState('');
  const [busy, run] = useAction();
  const rows = tree.data || [];
  const names = settings.data?.level_names || [];
  const lookup = () => run(async () => { const r = await api(`/autoparts/locations/scan${qs({ code: scan })}`); if (r) setOpen(r.location_id); else throw new Error('No location has that code'); setScan(''); }, null);
  const off = (l) => run(async () => { await api(`/autoparts/locations/${l.location_id}`, { method: 'PUT', body: { is_active: false } }); tree.reload(); }, 'Switched off');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (scan.trim()) lookup(); }}>
          <Field id="ly-scan" label="Scan or type a rack / bin code"><Input id="ly-scan" value={scan} onChange={(e) => setScan(e.target.value)} placeholder="WH-A-R12-B07" /></Field>
          <Button type="submit" variant="secondary" loading={busy}>Find</Button>
        </form>
        <span className="flex gap-2">
          {rows.length > 0 && <Link to={`/app/parts/labels?ids=${rows.filter((r) => r.can_store).map((r) => r.location_id).slice(0, 80).join(',')}`}><Button variant="secondary"><Printer aria-hidden="true" className="h-4 w-4" /> Print bin labels</Button></Link>}
          {canEdit && <Button onClick={() => setAdding({ parent: null })}><Plus aria-hidden="true" className="h-4 w-4" /> Add {names[0] || 'warehouse'}</Button>}
        </span>
      </div>
      <ListState loading={tree.loading && !tree.data} error={tree.error} empty={tree.data && rows.length === 0} emptyLabel="No racks or bins yet. Add your warehouse, then the zones, racks and bins inside it." />
      {rows.length > 0 && (
        <Panel className="!p-0">
          <Table>
            <Thead><Th>Place</Th><Th className="text-right">Units</Th><Th className="text-right">Parts</Th><Th className="text-right">Filled</Th><Th /></Thead>
            <tbody>
              {rows.map((l) => (
                <Tr key={l.location_id}>
                  <Td><button type="button" onClick={() => setOpen(l.location_id)} className="text-left" style={{ paddingLeft: `${(l.level - 1) * 18}px` }}>
                    <span className="font-medium">{l.segment}</span> <span className="text-caption text-ink-500">{typeLabel(names, l.loc_type)}{l.name && l.name !== l.segment ? ` · ${l.name}` : ''}</span>
                    {l.over_capacity && <Badge tone="danger"> over limit</Badge>}</button></Td>
                  <Td className="tabular text-right">{n3(l.qty)}</Td><Td className="tabular text-right">{l.parts}</Td>
                  <Td className="tabular text-right">{l.fill_pct != null ? `${l.fill_pct}%` : ''}</Td>
                  <Td className="text-right">{canEdit && l.level < 6 && !l.can_store && <Button size="sm" variant="ghost" onClick={() => setAdding({ parent: l })}>Add inside</Button>}
                    {canEdit && l.qty === 0 && <Button size="sm" variant="ghost" onClick={() => off(l)}>Switch off</Button>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
      {adding && <AddLocation parent={adding.parent} names={names} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); tree.reload(); }} />}
      {open && <LocationDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

/* ── put away and move ───────────────────────────────────────────────────── */
const PutAway = ({ canEdit }) => {
  const un = useLoad('/autoparts/warehouse/unassigned');
  const bins = useLoad('/autoparts/locations');
  const [pick, setPick] = useState(null); const [binId, setBinId] = useState(''); const [qty, setQty] = useState('');
  const [busy, run] = useAction();
  const storing = (bins.data || []).filter((l) => l.can_store && l.is_active);
  const choose = (r) => { setPick(r); setQty(String(r.unassigned)); setBinId(''); };
  const save = () => run(async () => {
    const out = await api('/autoparts/warehouse/put-away', { method: 'POST', body: { product_id: pick.product_id, location_id: Number(binId), qty: Number(qty), source_key: `pa-${pick.product_id}-${binId}-${Date.now()}` } });
    setPick(null); un.reload(); bins.reload();
    return out;
  }, 'Put away');
  return (
    <div className="space-y-4">
      <ListState loading={un.loading && !un.data} error={un.error} empty={un.data && un.data.length === 0} emptyLabel="Nothing is waiting. Everything received is on a shelf." />
      {un.data?.length > 0 && (
        <Panel title="Waiting for a bin" lead="Received or returned, counted in stock, but not on a shelf yet" className="!p-0">
          <Table>
            <Thead><Th>Part</Th><Th className="text-right">In stock</Th><Th className="text-right">On shelves</Th><Th className="text-right">Waiting</Th><Th /></Thead>
            <tbody>{un.data.map((r) => (<Tr key={`${r.branch_id}-${r.product_id}`}><Td>{r.name}<span className="block text-caption text-ink-500">{r.sku}</span></Td><Td className="tabular text-right">{n3(r.on_hand)}</Td><Td className="tabular text-right">{n3(r.binned)}</Td><Td className="tabular text-right font-medium">{n3(r.unassigned)}</Td>
              <Td className="text-right">{canEdit && <Button size="sm" onClick={() => choose(r)}>Put away</Button>}</Td></Tr>))}</tbody>
          </Table>
        </Panel>
      )}
      {pick && (
        <Modal title={`Put away ${pick.name}`} onClose={() => setPick(null)} footer={<><Button variant="secondary" onClick={() => setPick(null)}>Cancel</Button><Button onClick={save} loading={busy} disabled={!binId || !(Number(qty) > 0)}>Put away</Button></>}>
          <div className="space-y-4">
            <Field id="pa-bin" label="Bin"><Select id="pa-bin" value={binId} onChange={(e) => setBinId(e.target.value)}><option value="">Choose a bin</option>{storing.map((b) => <option key={b.location_id} value={b.location_id}>{b.code}{b.capacity_units ? ` (limit ${n3(b.capacity_units)})` : ''}</option>)}</Select></Field>
            <NumberField id="pa-qty" label="How many" hint={`${n3(pick.unassigned)} are waiting`} value={qty} onChange={setQty} />
          </div>
        </Modal>
      )}
    </div>
  );
};

const MoveStock = () => {
  const [term, setTerm] = useState(''); const q = useDebounced(term, 300);
  const found = useLoad(q.trim().length >= 2 ? `/autoparts/parts/lookup${qs({ q, limit: 6 })}` : null);
  const [part, setPart] = useState(null);
  const where = useLoad(part ? `/autoparts/parts/${part.product_id}/locations` : null);
  const bins = useLoad('/autoparts/locations');
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [qty, setQty] = useState('');
  const [busy, run] = useAction();
  const storing = (bins.data || []).filter((l) => l.can_store && l.is_active);
  const go = () => run(async () => { await api('/autoparts/warehouse/move', { method: 'POST', body: { product_id: part.product_id, from_location_id: Number(from), to_location_id: Number(to), qty: Number(qty), source_key: `mv-${part.product_id}-${from}-${to}-${Date.now()}` } }); setQty(''); where.reload(); }, 'Moved');
  return (
    <Panel title="Move stock between bins" lead="The stock total does not change, only where it sits.">
      <div className="space-y-4">
        <Field id="mv-part" label="Part"><Input id="mv-part" value={term} onChange={(e) => { setTerm(e.target.value); setPart(null); }} placeholder="Scan or type a name, SKU or part number" /></Field>
        {!part && found.data?.length > 0 && <ul className="rounded-lg border border-line">{found.data.map((p) => <li key={p.product_id}><button type="button" className="block w-full px-4 py-2 text-left text-small hover:bg-surface-2" onClick={() => { setPart(p); setTerm(p.name); }}>{p.name} <span className="text-ink-400">{p.sku}</span></button></li>)}</ul>}
        {part && where.data && (
          <>
            <p className="text-small text-ink-700">{where.data.bins.length ? where.data.bins.map((b) => `${b.code}: ${n3(b.available)}`).join(' · ') : 'Not on any shelf.'}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="mv-from" label="From"><Select id="mv-from" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Choose</option>{where.data.bins.map((b) => <option key={b.location_id} value={b.location_id}>{b.code}</option>)}</Select></Field>
              <Field id="mv-to" label="To"><Select id="mv-to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose</option>{storing.map((b) => <option key={b.location_id} value={b.location_id}>{b.code}</option>)}</Select></Field>
              <NumberField id="mv-qty" label="How many" value={qty} onChange={setQty} />
            </div>
            <Button onClick={go} loading={busy} disabled={!from || !to || !(Number(qty) > 0)}>Move</Button>
          </>
        )}
      </div>
    </Panel>
  );
};

const Settings = () => {
  const s = useLoad('/autoparts/warehouse/settings');
  const [f, setF] = useState(null);
  const [busy, run] = useAction();
  const cur = f || (s.data && { level_names: s.data.level_names.join(', '), count_auto_units: String(s.data.count_auto_units), safety_days: String(s.data.safety_days), review_days: String(s.data.review_days), dead_days: String(s.data.dead_days), slow_days: String(s.data.slow_days) });
  if (!cur) return <ListState loading error={s.error} />;
  const set = (k) => (v) => setF({ ...cur, [k]: v });
  const save = () => run(async () => {
    await api('/autoparts/warehouse/settings', { method: 'PUT', body: { level_names: cur.level_names.split(',').map((x) => x.trim()).filter(Boolean), count_auto_units: Number(cur.count_auto_units), safety_days: Number(cur.safety_days), review_days: Number(cur.review_days), dead_days: Number(cur.dead_days), slow_days: Number(cur.slow_days) } });
    s.reload();
  }, 'Saved');
  return (
    <Panel title="Warehouse settings">
      <div className="max-w-xl space-y-4">
        <Field id="st-levels" label="Names of the levels, from the top" hint="Warehouse, Zone, Aisle, Rack, Shelf, Bin is the usual. Use your own words."><Input id="st-levels" value={cur.level_names} onChange={(e) => set('level_names')(e.target.value)} /></Field>
        <NumberField id="st-count" label="Stock count difference anyone may apply" hint="0 means every difference needs a manager's approval" value={cur.count_auto_units} onChange={set('count_auto_units')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField id="st-safety" label="Safety days (reorder)" value={cur.safety_days} onChange={set('safety_days')} step={1} />
          <NumberField id="st-review" label="Review days (reorder)" value={cur.review_days} onChange={set('review_days')} step={1} />
          <NumberField id="st-slow" label="Slow stock after (days)" value={cur.slow_days} onChange={set('slow_days')} step={1} />
          <NumberField id="st-dead" label="Dead stock after (days)" value={cur.dead_days} onChange={set('dead_days')} step={1} />
        </div>
        <Button onClick={save} loading={busy}>Save</Button>
      </div>
    </Panel>
  );
};

export default function PartsWarehouse() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'layout';
  const setTab = (t) => setParams({ tab: t });
  const canEdit = can('warehouse');
  return (
    <div>
      <PageHeader title="Racks and bins" lead="Where every part sits, so anyone can find it and the shelf agrees with the stock." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'layout', label: 'Layout' }, { key: 'putaway', label: 'Put away' }, { key: 'move', label: 'Move stock' }, ...(can('warehouse_settings') ? [{ key: 'settings', label: 'Settings' }] : [])]} />
      {tab === 'layout' && <Layout canEdit={canEdit} />}
      {tab === 'putaway' && <PutAway canEdit={canEdit} />}
      {tab === 'move' && canEdit && <MoveStock />}
      {tab === 'settings' && <Settings />}
    </div>
  );
}
