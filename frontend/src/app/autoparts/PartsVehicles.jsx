/* Vehicles: the shop's own list of makes, models and variants (nothing is pre-loaded or guessed), a CSV import, and "find parts for a vehicle" for the counter. */
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { FIT, VEHICLE_TYPES, VEHICLE_LABEL, n3, qs, rsPaise, useLoad } from '../../lib/autoparts.js';
import { Alert, Badge, Button, Field, Input, ListState, PageHeader, Select, Table, Td, Th, Thead, Tr, Textarea } from '../../components/ui.jsx';
import { Panel, Tabs, useAction } from '../salon/parts.jsx';

const parseCsv = (text) => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v.trim()])));
};

const Manage = ({ tree, canEdit, reload }) => {
  const [make, setMake] = useState(''); const [type, setType] = useState('CAR');
  const [modelOf, setModelOf] = useState(''); const [model, setModel] = useState('');
  const [busy, run] = useAction();
  const addMake = () => run(async () => { await api('/autoparts/vehicles/makes', { method: 'POST', body: { name: make, vehicle_type: type } }); setMake(''); reload(); }, 'Make added');
  const addModel = () => run(async () => { await api('/autoparts/vehicles/models', { method: 'POST', body: { make_id: Number(modelOf), name: model } }); setModel(''); reload(); }, 'Model added');
  return (
    <div className="space-y-5">
      {canEdit && (
        <Panel title="Add to the list" lead="Type them in, or import a file on the next tab.">
          <div className="flex flex-wrap items-end gap-6">
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (make.trim()) addMake(); }}>
              <Field id="vm-make" label="New make"><Input id="vm-make" value={make} onChange={(e) => setMake(e.target.value)} placeholder="Maruti Suzuki" /></Field>
              <Field id="vm-type" label="For"><Select id="vm-type" value={type} onChange={(e) => setType(e.target.value)}>{VEHICLE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
              <Button type="submit" loading={busy} disabled={!make.trim()}>Add make</Button>
            </form>
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (modelOf && model.trim()) addModel(); }}>
              <Field id="vm-of" label="Make"><Select id="vm-of" value={modelOf} onChange={(e) => setModelOf(e.target.value)}><option value="">Choose</option>{tree.map((m) => <option key={m.make_id} value={m.make_id}>{m.name} ({VEHICLE_LABEL[m.vehicle_type]})</option>)}</Select></Field>
              <Field id="vm-model" label="New model"><Input id="vm-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Swift" /></Field>
              <Button type="submit" loading={busy} disabled={!modelOf || !model.trim()}>Add model</Button>
            </form>
          </div>
        </Panel>
      )}
      <ListState empty={tree.length === 0} emptyLabel="No vehicles yet. Add a make, or import a file." />
      {tree.map((mk) => (
        <Panel key={mk.make_id} title={mk.name} lead={VEHICLE_LABEL[mk.vehicle_type]}>
          {mk.models.length === 0 ? <p className="text-small text-ink-500">No models yet.</p> : (
            <ul className="divide-y divide-line text-small">
              {mk.models.map((m) => (
                <li key={m.model_id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="font-medium">{m.name}</span>
                  <span className="text-ink-500">{m.variants.length} variant{m.variants.length === 1 ? '' : 's'} · {m.parts} part{m.parts === 1 ? '' : 's'} on record</span></li>
              ))}
            </ul>
          )}
        </Panel>
      ))}
    </div>
  );
};

const Import = ({ reload }) => {
  const [text, setText] = useState(''); const [out, setOut] = useState(null); const [error, setError] = useState('');
  const [busy, run] = useAction();
  const go = (commit) => run(async () => {
    setError('');
    try { const rows = parseCsv(text); if (!rows.length) throw new Error('Paste the file with its header row: make, model, vehicle_type, variant, engine_type, engine_cc, fuel, year_from, year_to'); const r = await api('/autoparts/vehicles/import', { method: 'POST', body: { rows, commit } }); setOut(r); if (commit && r.ok) { setText(''); reload(); } } catch (e) { setError(e.message); }
  }, null);
  return (
    <Panel title="Import vehicles" lead="Paste a CSV. Nothing is saved unless every row is valid, and rows that are already there are skipped.">
      <div className="space-y-3">
        <Alert>{error}</Alert>
        <Textarea aria-label="Vehicles CSV" rows={8} value={text} onChange={(e) => { setText(e.target.value); setOut(null); }} placeholder={'make,model,vehicle_type,variant,engine_type,engine_cc,fuel,year_from,year_to\nMaruti Suzuki,Swift,CAR,VXi,K12,1197,PETROL,2018,2023'} />
        <div className="flex gap-2"><Button variant="secondary" loading={busy} disabled={!text.trim()} onClick={() => go(false)}>Check</Button><Button loading={busy} disabled={!out?.ok} onClick={() => go(true)}>Import</Button></div>
        {out && (out.ok ? <p className="text-small text-success">{out.committed ? `Imported: ${out.makes} makes, ${out.models} models, ${out.variants} variants (${out.skipped} already there).` : `${out.checked} rows are valid.`}</p>
          : <ul className="text-small text-danger">{out.problems.map((p, i) => <li key={i}>Row {p.row}: {p.message}</li>)}</ul>)}
      </div>
    </Panel>
  );
};

const Find = ({ tree }) => {
  const [model, setModel] = useState(''); const [year, setYear] = useState(''); const [search, setSearch] = useState('');
  const models = tree.flatMap((mk) => mk.models.map((m) => ({ id: m.model_id, label: `${mk.name} ${m.name}` })));
  const res = useLoad(model ? `/autoparts/vehicles/parts${qs({ model_id: model, year, search, limit: 100 })}` : null, { paged: true });
  return (
    <Panel title="Find parts for a vehicle" lead="Only parts with a fitment record are listed, each labelled. A part marked as not fitting is left out.">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field id="fv-model" label="Vehicle"><Select id="fv-model" value={model} onChange={(e) => setModel(e.target.value)}><option value="">Choose a model</option>{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
        <Field id="fv-year" label="Year"><div className="w-24"><Input id="fv-year" type="number" value={year} onChange={(e) => setYear(e.target.value)} /></div></Field>
        <Field id="fv-search" label="Part"><Input id="fv-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="brake pad" /></Field>
      </div>
      <ListState loading={res.loading && !res.data} error={res.error} empty={model && res.data && res.data.length === 0} emptyLabel="No parts recorded for this vehicle." />
      {res.data?.length > 0 && (
        <>
          <Table>
            <Thead><Th>Part</Th><Th>Fitment</Th><Th className="text-right">Price</Th><Th className="text-right">Stock</Th></Thead>
            <tbody>
              {res.data.map((p) => (
                <Tr key={p.product_id}><Td><span className="font-medium">{p.name}</span><span className="block text-caption text-ink-500">{p.sku}{p.oem_part_no ? ` · OEM ${p.oem_part_no}` : ''}{p.brand_name ? ` · ${p.brand_name}` : ''}</span></Td>
                  <Td><Badge tone={FIT[p.fitment].tone}>{FIT[p.fitment].label}</Badge>{p.warning && <span className="block text-caption text-warning">{p.warning}</span>}</Td>
                  <Td className="tabular text-right">{rsPaise(p.selling_price_paise)}</Td><Td className={`tabular text-right ${p.stock <= 0 ? 'text-danger' : ''}`}>{n3(p.stock)}</Td></Tr>
              ))}
            </tbody>
          </Table>
          {res.meta?.excluded_not_fit > 0 && <p className="mt-3 text-caption text-ink-500">{res.meta.excluded_not_fit} part{res.meta.excluded_not_fit === 1 ? ' is' : 's are'} recorded as not fitting this vehicle and not shown.</p>}
        </>
      )}
    </Panel>
  );
};

export default function PartsVehicles() {
  const { can } = useAuth();
  const [tab, setTab] = useState('find');
  const veh = useLoad('/autoparts/vehicles');
  const tree = veh.data || [];
  return (
    <div>
      <PageHeader title="Vehicles" lead="The makes and models you sell parts for, and which parts fit them." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'find', label: 'Find parts' }, { key: 'list', label: 'Makes and models' }, ...(can('parts_catalog') ? [{ key: 'import', label: 'Import' }] : [])]} />
      <ListState loading={veh.loading && !veh.data} error={veh.error} />
      {veh.data && tab === 'find' && <Find tree={tree} />}
      {veh.data && tab === 'list' && <Manage tree={tree} canEdit={can('parts_catalog')} reload={veh.reload} />}
      {veh.data && tab === 'import' && <Import reload={veh.reload} />}
    </div>
  );
}
