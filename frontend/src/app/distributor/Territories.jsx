/*
 * Territories and beats. Region → Territory → Area is the map of where the retailers are; a beat is one salesperson's
 * route on one weekday — an ordered list of retailers. Retailers are placed in an area (or higher) and put on beats here;
 * every sales report can then be cut by region, territory, area or beat.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapPinned, Pencil, Plus, Trash } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { CHILD_LEVEL, TERRITORY_LEVELS, WEEKDAYS, plural, useLoad } from '../../lib/distributor.js';
import { Badge, Button, EmptyState, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr, useDialog } from '../../components/ui.jsx';
import { Panel, Tabs, Toolbar, useAction } from '../wholesale/parts.jsx';
import { RetailerPicker, SalespersonSelect, TerritorySelect, useSalespeople, useTerritories } from './parts.jsx';

/* ── territories ──────────────────────────────────────────────────────────── */

const NodeForm = ({ node, parent, level, onClose, onSaved }) => {
  const [name, setName] = useState(node?.name || '');
  const [code, setCode] = useState(node?.code || '');
  const [busy, run] = useAction();
  const save = async (e) => {
    e.preventDefault();
    const r = await run(() => api(node ? `/distributor/territories/${node.territory_id}` : '/distributor/territories', { method: node ? 'PUT' : 'POST', body: node ? { name, code: code || null } : { name, code: code || null, level, parent_id: parent?.territory_id ?? null } }), node ? 'Saved' : `${TERRITORY_LEVELS[level]} added`);
    if (r) onSaved();
  };
  return (
    <Modal title={node ? `Rename ${TERRITORY_LEVELS[node.level].toLowerCase()}` : `Add a ${TERRITORY_LEVELS[level].toLowerCase()}${parent ? ` to ${parent.name}` : ''}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field id="tn-name" label="Name"><Input id="tn-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={120} /></Field>
        <Field id="tn-code" label="Short code" hint="Optional, for your own reference"><Input id="tn-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} disabled={name.trim().length < 2}>Save</Button></div>
      </form>
    </Modal>
  );
};

const AssignModal = ({ onClose, onDone }) => {
  const [territory, setTerritory] = useState('');
  const [rep, setRep] = useState('');
  const [chosen, setChosen] = useState([]);
  const [setRepToo, setSetRepToo] = useState(false);
  const [busy, run] = useAction();
  const save = async () => {
    const body = { customer_ids: chosen.map((c) => c.customer_id), ...(territory !== '' ? { territory_id: territory } : {}), ...(setRepToo ? { salesperson_id: rep === '' ? null : rep } : {}) };
    const r = await run(() => api('/distributor/customers/assign', { method: 'POST', body }), 'Retailers assigned');
    if (r) onDone(r.assigned);
  };
  return (
    <Modal title="Assign retailers" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-small text-ink-500">Put many retailers in a territory, and optionally under one salesperson, in one go.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TerritorySelect id="as-terr" value={territory} onChange={setTerritory} label="Territory or area" emptyLabel="Leave as it is" />
          <div>
            <SalespersonSelect id="as-rep" value={rep} onChange={(v) => { setRep(v); setSetRepToo(true); }} label="Salesperson" emptyLabel="Leave as it is" />
            {setRepToo && rep === '' && <p className="mt-1 text-caption text-warning">Applying this takes the salesperson off the retailers.</p>}
          </div>
        </div>
        <RetailerPicker value={chosen} onChange={setChosen} max={2000} />
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!chosen.length || (territory === '' && !setRepToo)}>Assign {chosen.length || ''}</Button></div>
      </div>
    </Modal>
  );
};

const Tree = () => {
  const { can } = useAuth();
  const dialog = useDialog();
  const { territories, reload } = useTerritories();
  const [form, setForm] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [busy, run] = useAction();
  const canEdit = can('territories');
  const children = (id) => territories.filter((t) => t.parent_id === id);
  const regions = territories.filter((t) => t.level === 'REGION');
  const remove = async (t) => { if (await dialog.confirm({ title: `Delete ${t.name}?`, body: 'Only an empty one can be deleted. Otherwise mark it inactive.', confirmLabel: 'Delete', danger: true })) { const r = await run(() => api(`/distributor/territories/${t.territory_id}`, { method: 'DELETE' }), 'Deleted'); if (r) reload(); } };
  const Node = ({ t, depth }) => (
    <li>
      <div className="flex flex-wrap items-center gap-2 border-b border-line py-2" style={{ paddingLeft: `${depth * 24}px` }}>
        <span className="font-medium text-ink-900">{t.name}</span><Badge tone={t.level === 'REGION' ? 'brand' : 'neutral'}>{TERRITORY_LEVELS[t.level]}</Badge>
        {t.status === 'INACTIVE' && <Badge tone="warning">Inactive</Badge>}
        <span className="text-caption text-ink-500">{plural(t.customers, 'retailer')}{t.beats ? ` · ${plural(t.beats, 'beat')}` : ''}{t.salespeople ? ` · ${plural(t.salespeople, 'salesperson', 'salespeople')}` : ''}</span>
        {canEdit && <span className="ml-auto flex gap-1">
          {CHILD_LEVEL[t.level] && <Button variant="ghost" size="sm" onClick={() => setForm({ parent: t, level: CHILD_LEVEL[t.level] })}><Plus aria-hidden="true" className="h-4 w-4" />{TERRITORY_LEVELS[CHILD_LEVEL[t.level]]}</Button>}
          <button type="button" aria-label={`Rename ${t.name}`} onClick={() => setForm({ node: t })} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-ink-900"><Pencil aria-hidden="true" className="h-4 w-4" /></button>
          <button type="button" aria-label={`Delete ${t.name}`} disabled={busy} onClick={() => remove(t)} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-danger"><Trash aria-hidden="true" className="h-4 w-4" /></button>
        </span>}
      </div>
      {children(t.territory_id).length > 0 && <ul>{children(t.territory_id).map((c) => <Node key={c.territory_id} t={c} depth={depth + 1} />)}</ul>}
    </li>
  );
  return (
    <div>
      <Toolbar>{canEdit && <><Button onClick={() => setForm({ level: 'REGION' })}><Plus aria-hidden="true" className="h-4 w-4" />Add region</Button><Button variant="secondary" onClick={() => setAssigning(true)}>Assign retailers</Button></>}</Toolbar>
      {regions.length === 0 ? <EmptyState icon={MapPinned} title="No territories yet" body="Start with a region (say, Hyderabad), then add territories and areas inside it." action={canEdit ? <Button onClick={() => setForm({ level: 'REGION' })}>Add a region</Button> : undefined} />
        : <Panel title="Where your retailers are" lead="Region → Territory → Area. Retailer counts include everything inside."><ul>{regions.map((t) => <Node key={t.territory_id} t={t} depth={0} />)}</ul></Panel>}
      {form && <NodeForm node={form.node} parent={form.parent} level={form.level} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
      {assigning && <AssignModal onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); reload(); }} />}
    </div>
  );
};

/* ── beats ────────────────────────────────────────────────────────────────── */

const BeatForm = ({ beat, onClose, onSaved }) => {
  const editing = Boolean(beat?.beat_id);
  const detail = useLoad(editing ? `/distributor/beats/${beat.beat_id}` : null);
  const [f, setF] = useState(() => ({ name: beat?.name || '', weekday: beat?.weekday ?? '', territory_id: beat?.territory_id ?? '', salesperson_id: beat?.salesperson_id ?? '', status: beat?.status || 'ACTIVE' }));
  const [chosen, setChosen] = useState(null);
  const [busy, run] = useAction();
  const list = chosen ?? (detail.data?.customers || []).map((c) => ({ customer_id: c.customer_id, name: c.name, city: c.city, phone: c.phone }));
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const save = async () => {
    const body = { name: f.name, weekday: f.weekday === '' ? null : Number(f.weekday), territory_id: f.territory_id === '' ? null : f.territory_id, salesperson_id: f.salesperson_id === '' ? null : f.salesperson_id, status: f.status, customer_ids: list.map((c) => c.customer_id) };
    const r = await run(() => api(editing ? `/distributor/beats/${beat.beat_id}` : '/distributor/beats', { method: editing ? 'PUT' : 'POST', body }), editing ? 'Beat saved' : 'Beat created');
    if (r) onSaved();
  };
  return (
    <Modal title={editing ? `Beat: ${beat.name}` : 'New beat'} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="bf-name" label="Beat name"><Input id="bf-name" value={f.name} onChange={set('name')} autoFocus maxLength={120} placeholder="Monday – Ameerpet" /></Field>
          <Field id="bf-day" label="Day of the week"><Select id="bf-day" value={f.weekday} onChange={set('weekday')}><option value="">Any day</option>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field>
          <TerritorySelect id="bf-terr" value={f.territory_id} onChange={set('territory_id')} label="Area it covers" />
          <SalespersonSelect id="bf-rep" value={f.salesperson_id} onChange={set('salesperson_id')} label="Salesperson" />
          {editing && <Field id="bf-status" label="Status"><Select id="bf-status" value={f.status} onChange={set('status')}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></Field>}
        </div>
        <Field id="bf-retailers" label="Retailers on this beat" hint="A retailer can be on one beat per weekday"><RetailerPicker value={list} onChange={setChosen} ordered /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={f.name.trim().length < 2}>{editing ? 'Save beat' : 'Create beat'}</Button></div>
      </div>
    </Modal>
  );
};

const Beats = () => {
  const { can } = useAuth();
  const people = useSalespeople();
  const [day, setDay] = useState('');
  const [rep, setRep] = useState('');
  const [open, setOpen] = useState(null);
  const [stamp, setStamp] = useState(0);
  const query = new URLSearchParams({ ...(day !== '' ? { weekday: day } : {}), ...(rep !== '' ? { salesperson_id: rep } : {}), k: stamp }).toString();
  const { data, loading, error } = useLoad(`/distributor/beats?${query}`);
  return (
    <div>
      <Toolbar>
        <Select aria-label="Day" className="w-40" value={day} onChange={(e) => setDay(e.target.value)}><option value="">Every day</option>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>
        {can('territories') && <Select aria-label="Salesperson" className="w-48" value={rep} onChange={(e) => setRep(e.target.value)}><option value="">All salespeople</option>{people.map((p) => <option key={p.salesperson_id} value={p.salesperson_id}>{p.name}</option>)}</Select>}
        {can('territories') && <Button className="ml-auto" onClick={() => setOpen({})}><Plus aria-hidden="true" className="h-4 w-4" />New beat</Button>}
      </Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={MapPinned} emptyLabel="No beats" emptyBody="A beat is a salesperson’s route on one day: the retailers to visit, in order." emptyAction={can('territories') ? <Button onClick={() => setOpen({})}>Create a beat</Button> : undefined} />
      {data?.length > 0 && <Table><Thead><Th>Beat</Th><Th>Day</Th><Th>Area</Th><Th>Salesperson</Th><Th className="text-right">Retailers</Th></Thead>
        <tbody>{data.map((b) => <Tr key={b.beat_id} onClick={() => setOpen(b)}><Td className="font-medium text-brand-700">{b.name}{b.status === 'INACTIVE' && <Badge tone="warning">Inactive</Badge>}</Td><Td>{b.weekday_name || '—'}</Td><Td>{b.territory || '—'}</Td><Td>{b.salesperson || <span className="text-ink-400">Unassigned</span>}</Td><Td className="text-right tabular">{b.customers}</Td></Tr>)}</tbody></Table>}
      {open && <BeatForm beat={open.beat_id ? open : null} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); setStamp((n) => n + 1); }} />}
    </div>
  );
};

const Territories = () => {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'territories';
  return (
    <div>
      <PageHeader title="Territories & beats" lead="Where your retailers are, and the routes your salespeople walk." />
      <Tabs tabs={[{ key: 'territories', label: 'Territories' }, { key: 'beats', label: 'Beats' }]} value={tab} onChange={(k) => setParams(k === 'territories' ? {} : { tab: k }, { replace: true })} />
      {tab === 'territories' ? <Tree /> : <Beats />}
    </div>
  );
};

export default Territories;
