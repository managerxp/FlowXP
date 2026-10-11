/*
 * Hotel set-up: room types and rooms, rate plans and seasonal rates, rooms taken out of sale, and the property's settings (check-in and check-out times, the GST slab
 * for room tariff, the booking number prefix). Everything here is per outlet: one outlet is one property.
 */
import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { HK_STATUS, MEAL_PLANS, longDate, useLoad } from '../../lib/hotel.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Textarea, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Panel, Tabs, Toggle, useAction } from '../salon/parts.jsx';
import BanquetSetup from './BanquetSetup.jsx';

const rs = (n) => formatCurrency(n);
const TABS = [{ key: 'rooms', label: 'Rooms' }, { key: 'rates', label: 'Rates' }, { key: 'blocks', label: 'Out of sale' }, { key: 'banquet', label: 'Banquet' }, { key: 'settings', label: 'Settings' }];

/* ── room types and rooms ──────────────────────────────────────────────── */

const TypeForm = ({ initial, onClose, onSaved }) => {
  const edit = Boolean(initial.room_type_id);
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [f, setF] = useState({ name: initial.name || '', code: initial.code || '', base_rate: initial.base_rate ?? '', extra_adult: initial.extra_adult ?? '', extra_child: initial.extra_child ?? '', base_adults: initial.base_adults ?? 2, max_adults: initial.max_adults ?? 2, max_children: initial.max_children ?? 1, amenities: (initial.amenities || []).join(', '), description: initial.description || '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const body = { ...f, code: f.code || f.name.slice(0, 4), base_rate: Number(f.base_rate), extra_adult: Number(f.extra_adult) || 0, extra_child: Number(f.extra_child) || 0, base_adults: Number(f.base_adults), max_adults: Number(f.max_adults), max_children: Number(f.max_children), amenities: f.amenities.split(',').map((a) => a.trim()).filter(Boolean) };
    const out = await run(() => api(edit ? `/hotel/room-types/${initial.room_type_id}` : '/hotel/room-types', { method: edit ? 'PUT' : 'POST', body }).catch((c) => { setError(c.message); throw c; }), 'Saved');
    if (out) onSaved();
  };
  return (
    <Modal title={edit ? `Edit ${initial.name}` : 'Add a room type'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="rt-n" label="Name"><Input id="rt-n" value={f.name} onChange={set('name')} required autoFocus placeholder="Deluxe, Sea view, Dormitory…" /></Field>
          <Field id="rt-c" label="Short code" hint="Shown on the calendar"><Input id="rt-c" value={f.code} onChange={set('code')} maxLength={12} placeholder="DLX" /></Field>
          <Field id="rt-r" label="Rack rate a night" hint="Before GST"><Input id="rt-r" type="number" min="0" step="any" value={f.base_rate} onChange={set('base_rate')} required /></Field>
          <Field id="rt-ba" label="Adults the rate includes"><Input id="rt-ba" type="number" min="1" value={f.base_adults} onChange={set('base_adults')} /></Field>
          <Field id="rt-ma" label="Most adults"><Input id="rt-ma" type="number" min="1" value={f.max_adults} onChange={set('max_adults')} /></Field>
          <Field id="rt-mc" label="Most children"><Input id="rt-mc" type="number" min="0" value={f.max_children} onChange={set('max_children')} /></Field>
          <Field id="rt-ea" label="Each extra adult, a night"><Input id="rt-ea" type="number" min="0" step="any" value={f.extra_adult} onChange={set('extra_adult')} /></Field>
          <Field id="rt-ec" label="Each child, a night"><Input id="rt-ec" type="number" min="0" step="any" value={f.extra_child} onChange={set('extra_child')} /></Field>
        </div>
        <Field id="rt-am" label="What is in the room" hint="Separate with commas"><Input id="rt-am" value={f.amenities} onChange={set('amenities')} placeholder="Air conditioning, TV, sea view, breakfast" /></Field>
        <Field id="rt-d" label="Description"><Textarea id="rt-d" rows={2} value={f.description} onChange={set('description')} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
      </form>
    </Modal>
  );
};

const RoomsTab = () => {
  const dialog = useDialog();
  const toast = useToast();
  const types = useLoad('/hotel/room-types');
  const rooms = useLoad('/hotel/rooms?all=1');
  const [typeForm, setTypeForm] = useState(null);
  const [bulk, setBulk] = useState(false);
  const [single, setSingle] = useState(null);
  const [busy, run] = useAction();
  const [bf, setBf] = useState({ room_type_id: '', from: '', to: '', floor: '', prefix: '' });
  const [sf, setSf] = useState({ room_no: '', floor: '', room_type_id: '' });
  const [error, setError] = useState('');
  const reload = () => { types.reload(); rooms.reload(); };

  const archiveType = async (t) => {
    if (!(await dialog.confirm({ title: `Remove ${t.name}?`, body: 'It disappears from new bookings. Past bookings keep it.', confirmLabel: 'Remove', danger: true }))) return;
    try { await api(`/hotel/room-types/${t.room_type_id}`, { method: 'DELETE' }); toast.success('Removed'); reload(); } catch (e) { toast.error(e.message); }
  };
  const saveBulk = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api('/hotel/rooms/bulk', { method: 'POST', body: { room_type_id: Number(bf.room_type_id), from: Number(bf.from), to: Number(bf.to), floor: bf.floor || undefined, prefix: bf.prefix || undefined } }).catch((c) => { setError(c.message); throw c; }));
    if (out) { toast.success(`${out.length} room${out.length === 1 ? '' : 's'} added${out.length < Number(bf.to) - Number(bf.from) + 1 ? ' (the rest already existed)' : ''}`); setBulk(false); reload(); }
  };
  const saveSingle = async (e) => {
    e.preventDefault(); setError('');
    const edit = Boolean(single.room_id);
    const out = await run(() => api(edit ? `/hotel/rooms/${single.room_id}` : '/hotel/rooms', { method: edit ? 'PUT' : 'POST', body: { room_no: sf.room_no, floor: sf.floor || undefined, room_type_id: Number(sf.room_type_id), ...(edit ? { is_active: single.is_active } : {}) } }).catch((c) => { setError(c.message); throw c; }), 'Saved');
    if (out) { setSingle(null); reload(); }
  };
  const retire = async (r) => {
    try { await api(`/hotel/rooms/${r.room_id}`, { method: 'PUT', body: { is_active: !r.is_active } }); reload(); } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="space-y-8">
      <Panel title="Room types" lead="Each type has its own rack rate and how many people it takes." action={<Button size="sm" onClick={() => setTypeForm({})}><Plus aria-hidden="true" className="h-4 w-4" />Add a type</Button>}>
        <ListState loading={types.loading && !types.data} error={types.error} empty={!types.loading && !(types.data || []).length} emptyLabel="Add your first room type, such as Deluxe or Standard." />
        {(types.data || []).length > 0 && (
          <Table><Thead><Th>Type</Th><Th className="text-right">Rack rate</Th><Th className="text-right">Extra adult</Th><Th>People</Th><Th className="text-right">Rooms</Th><Th></Th></Thead>
            <tbody>{types.data.map((t) => <Tr key={t.room_type_id}><Td><span className="font-medium text-ink-900">{t.name}</span> <span className="text-caption text-ink-500">{t.code}</span></Td><Td className="tabular text-right">{rs(t.base_rate)}</Td><Td className="tabular text-right text-ink-500">{t.extra_adult ? rs(t.extra_adult) : '—'}</Td><Td className="text-ink-500">{t.base_adults} included · up to {t.max_adults} adults, {t.max_children} children</Td><Td className="tabular text-right">{t.room_count}</Td>
              <Td className="text-right"><button type="button" aria-label={`Edit ${t.name}`} onClick={() => setTypeForm(t)} className="mr-3 text-ink-500 hover:text-ink-900"><Pencil aria-hidden="true" className="inline h-4 w-4" /></button><button type="button" aria-label={`Remove ${t.name}`} onClick={() => archiveType(t)} className="text-ink-500 hover:text-danger"><Trash2 aria-hidden="true" className="inline h-4 w-4" /></button></Td></Tr>)}</tbody></Table>
        )}
      </Panel>

      <Panel title="Rooms" lead="The rooms you can sell." action={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => { setError(''); setBf({ room_type_id: types.data?.[0]?.room_type_id || '', from: '', to: '', floor: '', prefix: '' }); setBulk(true); }} disabled={!(types.data || []).length}>Add many</Button><Button size="sm" onClick={() => { setError(''); setSf({ room_no: '', floor: '', room_type_id: types.data?.[0]?.room_type_id || '' }); setSingle({}); }} disabled={!(types.data || []).length}><Plus aria-hidden="true" className="h-4 w-4" />Add a room</Button></div>}>
        <ListState loading={rooms.loading && !rooms.data} error={rooms.error} empty={!rooms.loading && !(rooms.data || []).length} emptyLabel="No rooms yet. Add many at once, for example 101 to 110." />
        {(rooms.data || []).length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {rooms.data.map((r) => (
              <div key={r.room_id} className={`flex items-center justify-between gap-2 rounded-(--radius-control) border border-line px-3 py-2 ${r.is_active ? '' : 'opacity-50'}`}>
                <div><p className="text-small font-semibold text-ink-900">{r.room_no} {!r.is_active && <Badge>Retired</Badge>}</p><p className="text-caption text-ink-500">{r.room_type}{r.floor ? ` · floor ${r.floor}` : ''}</p></div>
                <div className="flex gap-2 text-caption"><button type="button" onClick={() => { setError(''); setSf({ room_no: r.room_no, floor: r.floor || '', room_type_id: r.room_type_id }); setSingle(r); }} className="font-medium text-brand-600 hover:underline">Edit</button><button type="button" onClick={() => retire(r)} className="text-ink-500 hover:underline">{r.is_active ? 'Retire' : 'Restore'}</button></div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {typeForm && <TypeForm initial={typeForm} onClose={() => setTypeForm(null)} onSaved={() => { setTypeForm(null); reload(); }} />}
      {bulk && (
        <Modal title="Add many rooms" onClose={() => setBulk(false)}>
          <form onSubmit={saveBulk} className="space-y-4"><Alert>{error}</Alert>
            <Field id="bk-t" label="Room type"><Select id="bk-t" value={bf.room_type_id} onChange={(e) => setBf((x) => ({ ...x, room_type_id: e.target.value }))}>{types.data.map((t) => <option key={t.room_type_id} value={t.room_type_id}>{t.name}</option>)}</Select></Field>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field id="bk-f" label="First number"><Input id="bk-f" type="number" min="0" value={bf.from} onChange={(e) => setBf((x) => ({ ...x, from: e.target.value }))} required /></Field>
              <Field id="bk-to" label="Last number"><Input id="bk-to" type="number" min="0" value={bf.to} onChange={(e) => setBf((x) => ({ ...x, to: e.target.value }))} required /></Field>
              <Field id="bk-fl" label="Floor"><Input id="bk-fl" value={bf.floor} onChange={(e) => setBf((x) => ({ ...x, floor: e.target.value }))} /></Field>
              <Field id="bk-p" label="Prefix" hint="Like A"><Input id="bk-p" value={bf.prefix} onChange={(e) => setBf((x) => ({ ...x, prefix: e.target.value }))} maxLength={6} /></Field>
            </div>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setBulk(false)}>Cancel</Button><Button type="submit" loading={busy}>Add the rooms</Button></div>
          </form>
        </Modal>
      )}
      {single && (
        <Modal title={single.room_id ? `Edit room ${single.room_no}` : 'Add a room'} onClose={() => setSingle(null)}>
          <form onSubmit={saveSingle} className="space-y-4"><Alert>{error}</Alert>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="sg-n" label="Room number"><Input id="sg-n" value={sf.room_no} onChange={(e) => setSf((x) => ({ ...x, room_no: e.target.value }))} required autoFocus /></Field>
              <Field id="sg-f" label="Floor"><Input id="sg-f" value={sf.floor} onChange={(e) => setSf((x) => ({ ...x, floor: e.target.value }))} /></Field>
              <Field id="sg-t" label="Type"><Select id="sg-t" value={sf.room_type_id} onChange={(e) => setSf((x) => ({ ...x, room_type_id: e.target.value }))}>{types.data.map((t) => <option key={t.room_type_id} value={t.room_type_id}>{t.name}</option>)}</Select></Field>
            </div>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setSingle(null)}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
};

/* ── rates ─────────────────────────────────────────────────────────────── */

const RatesTab = () => {
  const dialog = useDialog();
  const toast = useToast();
  const types = useLoad('/hotel/room-types');
  const plans = useLoad('/hotel/rate-plans');
  const seasons = useLoad('/hotel/seasonal-rates');
  const [plan, setPlan] = useState(null);
  const [season, setSeason] = useState(null);
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const reload = () => { plans.reload(); seasons.reload(); };
  const T = types.data || [];

  const savePlan = async (e) => {
    e.preventDefault(); setError('');
    const rates = Object.fromEntries(T.map((t) => [t.room_type_id, plan.rates[t.room_type_id] === '' || plan.rates[t.room_type_id] == null ? null : Number(plan.rates[t.room_type_id])]));
    const out = await run(() => api(plan.rate_plan_id ? `/hotel/rate-plans/${plan.rate_plan_id}` : '/hotel/rate-plans', { method: plan.rate_plan_id ? 'PUT' : 'POST', body: { name: plan.name, code: plan.code || plan.name.slice(0, 4), meal_plan: plan.meal_plan, is_default: plan.is_default, rates } }).catch((c) => { setError(c.message); throw c; }), 'Saved');
    if (out) { setPlan(null); reload(); }
  };
  const saveSeason = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api('/hotel/seasonal-rates', { method: 'POST', body: { room_type_id: Number(season.room_type_id), rate_plan_id: season.rate_plan_id ? Number(season.rate_plan_id) : undefined, name: season.name || undefined, from_date: season.from_date, to_date: season.to_date, rate: Number(season.rate), days_of_week: season.weekends ? [5, 6] : undefined } }).catch((c) => { setError(c.message); throw c; }), 'Seasonal rate added');
    if (out) { setSeason(null); reload(); }
  };
  const removeSeason = async (o) => {
    if (!(await dialog.confirm({ title: 'Remove this seasonal rate?', body: 'Bookings already made keep the rate they were given.', confirmLabel: 'Remove', danger: true }))) return;
    try { await api(`/hotel/seasonal-rates/${o.override_id}`, { method: 'DELETE' }); toast.success('Removed'); reload(); } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="space-y-8">
      <Panel title="Rate plans" lead="A plan is a way of selling the same room, such as room only or with breakfast. Leave a rate empty to use the room type's rack rate."
             action={<Button size="sm" onClick={() => { setError(''); setPlan({ name: '', code: '', meal_plan: 'EP', is_default: false, rates: {} }); }} disabled={!T.length}><Plus aria-hidden="true" className="h-4 w-4" />Add a plan</Button>}>
        <ListState loading={plans.loading && !plans.data} error={plans.error} empty={!plans.loading && !(plans.data || []).length} emptyLabel="Add a room type first. A “Room only” plan is made for you." />
        {(plans.data || []).length > 0 && (
          <Table><Thead><Th>Plan</Th><Th>Meals</Th>{T.map((t) => <Th key={t.room_type_id} className="text-right">{t.name}</Th>)}<Th></Th></Thead>
            <tbody>{plans.data.map((p) => <Tr key={p.rate_plan_id}><Td className="font-medium text-ink-900">{p.name} {p.is_default && <Badge tone="brand">Default</Badge>}</Td><Td>{p.meal_plan_name}</Td>{T.map((t) => <Td key={t.room_type_id} className="tabular text-right">{p.rates[t.room_type_id] != null ? rs(p.rates[t.room_type_id]) : <span className="text-ink-400">{rs(t.base_rate)}</span>}</Td>)}
              <Td className="text-right"><button type="button" onClick={() => { setError(''); setPlan({ ...p, rates: Object.fromEntries(Object.entries(p.rates)) }); }} className="text-caption font-medium text-brand-600 hover:underline">Edit</button></Td></Tr>)}</tbody></Table>
        )}
      </Panel>

      <Panel title="Seasonal rates" lead="A different rate for a stretch of dates, such as the peak season, a festival or weekends. The newest one wins where they overlap."
             action={<Button size="sm" onClick={() => { setError(''); setSeason({ room_type_id: T[0]?.room_type_id || '', rate_plan_id: '', name: '', from_date: '', to_date: '', rate: '', weekends: false }); }} disabled={!T.length}><Plus aria-hidden="true" className="h-4 w-4" />Add a seasonal rate</Button>}>
        <ListState loading={seasons.loading && !seasons.data} error={seasons.error} empty={!seasons.loading && !(seasons.data || []).length} emptyLabel="No seasonal rates. Every night uses the plan or rack rate." />
        {(seasons.data || []).length > 0 && (
          <Table><Thead><Th>Name</Th><Th>Room type</Th><Th>Plan</Th><Th>Dates</Th><Th className="text-right">Rate</Th><Th></Th></Thead>
            <tbody>{seasons.data.map((o) => <Tr key={o.override_id}><Td className="font-medium text-ink-900">{o.name || 'Seasonal rate'}</Td><Td>{o.room_type}</Td><Td>{o.rate_plan || 'Every plan'}</Td><Td className="whitespace-nowrap">{longDate(String(o.from_date).slice(0, 10))} to {longDate(String(o.to_date).slice(0, 10))}{o.days_of_week?.length ? <span className="ml-1 text-caption text-ink-500">(Fri and Sat)</span> : null}</Td><Td className="tabular text-right">{rs(o.rate)}</Td><Td className="text-right"><button type="button" aria-label="Remove" onClick={() => removeSeason(o)} className="text-ink-500 hover:text-danger"><Trash2 aria-hidden="true" className="inline h-4 w-4" /></button></Td></Tr>)}</tbody></Table>
        )}
      </Panel>

      {plan && (
        <Modal title={plan.rate_plan_id ? `Edit ${plan.name}` : 'Add a rate plan'} onClose={() => setPlan(null)} wide>
          <form onSubmit={savePlan} className="space-y-4"><Alert>{error}</Alert>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="pl-n" label="Name"><Input id="pl-n" value={plan.name} onChange={(e) => setPlan((x) => ({ ...x, name: e.target.value }))} required autoFocus placeholder="With breakfast" /></Field>
              <Field id="pl-c" label="Short code"><Input id="pl-c" value={plan.code} onChange={(e) => setPlan((x) => ({ ...x, code: e.target.value }))} maxLength={12} placeholder="CP" /></Field>
              <Field id="pl-m" label="Meals included"><Select id="pl-m" value={plan.meal_plan} onChange={(e) => setPlan((x) => ({ ...x, meal_plan: e.target.value }))}>{MEAL_PLANS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>
            </div>
            <div><p className="mb-2 text-small font-medium text-ink-900">Rate a night for each room type <span className="font-normal text-ink-500">(before GST)</span></p>
              <div className="grid gap-3 sm:grid-cols-3">{T.map((t) => <Field key={t.room_type_id} id={`pl-r-${t.room_type_id}`} label={t.name} hint={`Rack rate ${rs(t.base_rate)}`}><Input id={`pl-r-${t.room_type_id}`} type="number" min="0" step="any" value={plan.rates[t.room_type_id] ?? ''} onChange={(e) => setPlan((x) => ({ ...x, rates: { ...x.rates, [t.room_type_id]: e.target.value } }))} placeholder="Rack rate" /></Field>)}</div></div>
            <Toggle id="pl-d" checked={plan.is_default} onChange={(v) => setPlan((x) => ({ ...x, is_default: v }))} label="Use this plan when none is chosen" />
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setPlan(null)}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
          </form>
        </Modal>
      )}
      {season && (
        <Modal title="Add a seasonal rate" onClose={() => setSeason(null)}>
          <form onSubmit={saveSeason} className="space-y-4"><Alert>{error}</Alert>
            <Field id="se-n" label="Name"><Input id="se-n" value={season.name} onChange={(e) => setSeason((x) => ({ ...x, name: e.target.value }))} placeholder="Peak season, Diwali, New Year…" autoFocus /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="se-t" label="Room type"><Select id="se-t" value={season.room_type_id} onChange={(e) => setSeason((x) => ({ ...x, room_type_id: e.target.value }))}>{T.map((t) => <option key={t.room_type_id} value={t.room_type_id}>{t.name}</option>)}</Select></Field>
              <Field id="se-p" label="Plan"><Select id="se-p" value={season.rate_plan_id} onChange={(e) => setSeason((x) => ({ ...x, rate_plan_id: e.target.value }))}><option value="">Every plan</option>{(plans.data || []).map((p) => <option key={p.rate_plan_id} value={p.rate_plan_id}>{p.name}</option>)}</Select></Field>
              <Field id="se-f" label="From"><Input id="se-f" type="date" value={season.from_date} onChange={(e) => setSeason((x) => ({ ...x, from_date: e.target.value }))} required /></Field>
              <Field id="se-to" label="To (including)"><Input id="se-to" type="date" value={season.to_date} onChange={(e) => setSeason((x) => ({ ...x, to_date: e.target.value }))} required /></Field>
              <Field id="se-r" label="Rate a night" hint="Before GST"><Input id="se-r" type="number" min="0" step="any" value={season.rate} onChange={(e) => setSeason((x) => ({ ...x, rate: e.target.value }))} required /></Field>
            </div>
            <Toggle id="se-w" checked={season.weekends} onChange={(v) => setSeason((x) => ({ ...x, weekends: v }))} label="Friday and Saturday nights only" />
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setSeason(null)}>Cancel</Button><Button type="submit" loading={busy}>Add</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
};

/* ── rooms out of sale ─────────────────────────────────────────────────── */

const BlocksTab = () => {
  const dialog = useDialog();
  const toast = useToast();
  const rooms = useLoad('/hotel/rooms');
  const blocks = useLoad('/hotel/room-blocks');
  const [f, setF] = useState(null);
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api('/hotel/room-blocks', { method: 'POST', body: { room_id: Number(f.room_id), from_date: f.from_date, to_date: f.to_date, reason: f.reason || undefined } }).catch((c) => { setError(c.message); throw c; }), 'Room taken out of sale');
    if (out) { setF(null); blocks.reload(); }
  };
  const release = async (b) => {
    if (!(await dialog.confirm({ title: `Put room ${b.room_no} back on sale?`, confirmLabel: 'Put back on sale' }))) return;
    try { await api(`/hotel/room-blocks/${b.block_id}`, { method: 'DELETE' }); toast.success('Back on sale'); blocks.reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Panel title="Rooms out of sale" lead="Take a room off the calendar for repairs, painting or owner use. For a room that is out of order right now, use Rooms and housekeeping."
           action={<Button size="sm" onClick={() => { setError(''); setF({ room_id: rooms.data?.[0]?.room_id || '', from_date: '', to_date: '', reason: '' }); }}><Plus aria-hidden="true" className="h-4 w-4" />Take a room out of sale</Button>}>
      <ListState loading={blocks.loading && !blocks.data} error={blocks.error} empty={!blocks.loading && !(blocks.data || []).length} emptyLabel="No rooms are out of sale." />
      {(blocks.data || []).length > 0 && <Table><Thead><Th>Room</Th><Th>From</Th><Th>Until</Th><Th>Why</Th><Th></Th></Thead><tbody>{blocks.data.map((b) => <Tr key={b.block_id}><Td className="font-medium text-ink-900">{b.room_no}</Td><Td>{longDate(String(b.from_date).slice(0, 10))}</Td><Td>{longDate(String(b.to_date).slice(0, 10))}</Td><Td>{b.reason || '—'}</Td><Td className="text-right"><button type="button" onClick={() => release(b)} className="text-caption font-medium text-brand-600 hover:underline">Put back on sale</button></Td></Tr>)}</tbody></Table>}
      {f && (
        <Modal title="Take a room out of sale" onClose={() => setF(null)}>
          <form onSubmit={save} className="space-y-4"><Alert>{error}</Alert>
            <Field id="bl-r" label="Room"><Select id="bl-r" value={f.room_id} onChange={(e) => setF((x) => ({ ...x, room_id: e.target.value }))}>{(rooms.data || []).map((r) => <option key={r.room_id} value={r.room_id}>{r.room_no} · {r.room_type}</option>)}</Select></Field>
            <div className="grid gap-3 sm:grid-cols-2"><Field id="bl-f" label="First night"><Input id="bl-f" type="date" value={f.from_date} onChange={(e) => setF((x) => ({ ...x, from_date: e.target.value }))} required /></Field><Field id="bl-t" label="Back on sale on"><Input id="bl-t" type="date" value={f.to_date} onChange={(e) => setF((x) => ({ ...x, to_date: e.target.value }))} required /></Field></div>
            <Field id="bl-w" label="Why"><Input id="bl-w" value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} placeholder="Repainting, plumbing, owner's guests…" /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setF(null)}>Cancel</Button><Button type="submit" loading={busy}>Take out of sale</Button></div>
          </form>
        </Modal>
      )}
    </Panel>
  );
};

/* ── settings ──────────────────────────────────────────────────────────── */

const SettingsTab = () => {
  const s = useLoad('/hotel/settings');
  const [f, setF] = useState(null);
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  if (!s.data) return <ListState loading={s.loading} error={s.error} />;
  const v = f || { check_in_time: String(s.data.check_in_time).slice(0, 5), check_out_time: String(s.data.check_out_time).slice(0, 5), tax_threshold: s.data.tax_threshold, tax_low_pct: Number(s.data.tax_low_pct), tax_high_pct: Number(s.data.tax_high_pct), allow_overbooking: s.data.allow_overbooking, res_prefix: s.data.res_prefix, business_date: String(s.data.business_date).slice(0, 10) };
  const set = (k) => (e) => setF({ ...v, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setError('');
    const body = { check_in_time: v.check_in_time, check_out_time: v.check_out_time, tax_threshold: Number(v.tax_threshold), tax_low_pct: Number(v.tax_low_pct), tax_high_pct: Number(v.tax_high_pct), allow_overbooking: v.allow_overbooking, res_prefix: v.res_prefix, ...(s.data.audits === 0 ? { business_date: v.business_date } : {}) };
    const out = await run(() => api('/hotel/settings', { method: 'PUT', body }).catch((c) => { setError(c.message); throw c; }), 'Saved');
    if (out) { setF(null); s.reload(); }
  };
  return (
    <form onSubmit={save} className="max-w-3xl space-y-6">
      <Alert>{error}</Alert>
      <Panel title="Check-in and check-out">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="st-in" label="Check-in from"><Input id="st-in" type="time" value={v.check_in_time} onChange={set('check_in_time')} /></Field>
          <Field id="st-out" label="Check-out by"><Input id="st-out" type="time" value={v.check_out_time} onChange={set('check_out_time')} /></Field>
          <Field id="st-pre" label="Booking number prefix" hint="RES-00001, RES-00002…"><Input id="st-pre" value={v.res_prefix} onChange={set('res_prefix')} maxLength={8} /></Field>
        </div>
        <div className="mt-4"><Field id="st-date" label="The hotel's date today" hint={s.data.audits === 0 ? 'You can set this until you run the first night audit. After that only night audit moves it.' : 'Only night audit moves this now.'}><Input id="st-date" type="date" value={v.business_date} onChange={set('business_date')} disabled={s.data.audits > 0} /></Field></div>
      </Panel>
      <Panel title="GST on room tariff" lead="Room tariff is taxed by the rate charged for the night. Check the rates and the limit with your accountant; the law has changed more than once.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="st-th" label="Limit a night" hint="Up to this, the lower rate applies"><Input id="st-th" type="number" min="0" step="any" value={v.tax_threshold} onChange={set('tax_threshold')} /></Field>
          <Field id="st-lo" label="GST up to the limit (%)"><Input id="st-lo" type="number" min="0" max="100" step="any" value={v.tax_low_pct} onChange={set('tax_low_pct')} /></Field>
          <Field id="st-hi" label="GST above the limit (%)"><Input id="st-hi" type="number" min="0" max="100" step="any" value={v.tax_high_pct} onChange={set('tax_high_pct')} /></Field>
        </div>
      </Panel>
      <Panel title="Bookings"><Toggle id="st-ob" checked={v.allow_overbooking} onChange={(c) => setF({ ...v, allow_overbooking: c })} label="Allow more bookings than rooms" hint="Off is safer: the system refuses a booking when no room of that type is free." /></Panel>
      <Button type="submit" loading={busy}>Save settings</Button>
    </form>
  );
};

export default function HotelSetup() {
  const [tab, setTab] = useState('rooms');
  return (
    <div>
      <PageHeader title="Hotel set-up" lead="Your rooms, rates and rules. Set these once, then the front desk takes it from there." />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'rooms' && <RoomsTab />}
      {tab === 'rates' && <RatesTab />}
      {tab === 'blocks' && <BlocksTab />}
      {tab === 'banquet' && <BanquetSetup />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}
