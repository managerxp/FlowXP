/* Set-up: zones and stations, what time costs (rates), offers (fixed time bundles), the games list and the lounge's own settings. */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Archive, Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { DAYS, KINDS, KIND_LABEL, duration, rs, rsShort, useLoad } from '../../lib/gaming.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, Tabs, Toggle, useAction } from '../salon/parts.jsx';

/* ── stations ─────────────────────────────────────────────────────────────── */

const StationForm = ({ station, zones, onClose, onSaved }) => {
  const [f, setF] = useState(station ? { name: station.name, kind: station.kind, label: station.label || '', max_players: String(station.max_players), zone_id: station.zone_id ? String(station.zone_id) : '' } : { name: '', kind: 'CONSOLE', label: '', max_players: '4', zone_id: zones[0] ? String(zones[0].zone_id) : '' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = () => run(async () => {
    setError('');
    const body = { name: f.name, kind: f.kind, label: f.label || null, max_players: Number(f.max_players), zone_id: f.zone_id ? Number(f.zone_id) : null };
    try { onSaved(await api(station ? `/gaming/stations/${station.station_id}` : '/gaming/stations', { method: station ? 'PUT' : 'POST', body })); } catch (e) { setError(e.message); }
  }, null);
  return (
    <Modal title={station ? `Edit ${station.name}` : 'Add a station'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.name.trim()}>{station ? 'Save' : 'Add station'}</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="sf-name" label="Name" hint="What the staff call it: PS5-1, Room A, Pool 2"><Input id="sf-name" value={f.name} onChange={set('name')} autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="sf-kind" label="Kind"><Select id="sf-kind" value={f.kind} onChange={set('kind')}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field id="sf-zone" label="Zone"><Select id="sf-zone" value={f.zone_id} onChange={set('zone_id')}><option value="">No zone</option>{zones.map((z) => <option key={z.zone_id} value={z.zone_id}>{z.name}</option>)}</Select></Field>
          <Field id="sf-label" label="What it is (optional)" hint="PS5, Xbox Series X, 8-ball"><Input id="sf-label" value={f.label} onChange={set('label')} maxLength={40} /></Field>
          <NumberField id="sf-max" label="Most players" value={f.max_players} onChange={(v) => setF((x) => ({ ...x, max_players: v }))} min={1} step={1} />
        </div>
      </div>
    </Modal>
  );
};

const Stations = () => {
  const toast = useToast();
  const st = useLoad('/gaming/stations');
  const zn = useLoad('/gaming/zones');
  const [editing, setEditing] = useState(null);
  const [zoneName, setZoneName] = useState('');
  const [busy, run] = useAction();
  const reload = () => { st.reload(); zn.reload(); };
  const addZone = () => run(async () => { await api('/gaming/zones', { method: 'POST', body: { name: zoneName } }); setZoneName(''); zn.reload(); }, 'Zone added');
  const renameZone = (z) => { const name = window.prompt('Zone name', z.name); if (name && name.trim() && name !== z.name) run(async () => { await api(`/gaming/zones/${z.zone_id}`, { method: 'PUT', body: { name } }); reload(); }, 'Renamed'); };
  const removeZone = (z) => run(async () => { await api(`/gaming/zones/${z.zone_id}`, { method: 'DELETE' }); zn.reload(); }, 'Zone removed');
  const outOfService = (s) => {
    if (s.status === 'OUT_OF_SERVICE') return run(async () => { await api(`/gaming/stations/${s.station_id}/status`, { method: 'POST', body: { out_of_service: false } }); st.reload(); }, `${s.name} is back in service`);
    const note = window.prompt('What is wrong? (shown on the board)', '');
    if (note === null) return undefined;
    return run(async () => { await api(`/gaming/stations/${s.station_id}/status`, { method: 'POST', body: { out_of_service: true, note } }); st.reload(); }, `${s.name} taken out of service`);
  };
  const archive = (s) => { if (window.confirm(`Retire ${s.name}? Its history stays.`)) run(async () => { await api(`/gaming/stations/${s.station_id}/archive`, { method: 'POST' }); st.reload(); }, 'Retired'); };

  return (
    <div className="space-y-5">
      <Panel title="Zones" lead="The groups on the board: Console lounge, Private rooms, Pool and snooker">
        <div className="flex flex-wrap items-center gap-2">
          {(zn.data || []).map((z) => (
            <span key={z.zone_id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-1 pl-3 pr-1 text-small">
              {z.name}<span className="text-ink-400">{z.stations}</span>
              <Button size="sm" variant="ghost" aria-label={`Rename ${z.name}`} onClick={() => renameZone(z)}><Pencil aria-hidden="true" className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" aria-label={`Remove ${z.name}`} onClick={() => removeZone(z)}><Trash2 aria-hidden="true" className="h-3.5 w-3.5" /></Button>
            </span>
          ))}
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (zoneName.trim()) addZone(); }}>
            <Input aria-label="New zone" className="w-44" placeholder="New zone" value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
            <Button type="submit" size="sm" variant="secondary" loading={busy} disabled={!zoneName.trim()}><Plus aria-hidden="true" className="h-4 w-4" />Add</Button>
          </form>
        </div>
      </Panel>
      <Panel title="Stations" lead="Each one has its own table, so food and drink for it sit on the same bill as its time" action={<Button size="sm" onClick={() => setEditing('new')}><Plus aria-hidden="true" className="h-4 w-4" />Add station</Button>}>
        <ListState loading={st.loading && !st.data} error={st.error} empty={st.data && !st.data.length} emptyLabel="No stations yet" emptyBody="Add your first PS5, room or table." />
        {st.data?.length > 0 && (
          <ul className="divide-y divide-line">
            {st.data.map((s) => (
              <li key={s.station_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-small font-medium text-ink-900">{s.name}{s.status === 'OUT_OF_SERVICE' && <span className="ml-2"><Badge tone="neutral">Out of service</Badge></span>}</p>
                  <p className="text-caption text-ink-500">{KIND_LABEL[s.kind]}{s.label ? ` · ${s.label}` : ''} · {s.zone_name || 'No zone'} · up to {s.max_players}{s.status_note ? ` · ${s.status_note}` : ''}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}><Pencil aria-hidden="true" className="h-4 w-4" />Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => outOfService(s)}><Wrench aria-hidden="true" className="h-4 w-4" />{s.status === 'OUT_OF_SERVICE' ? 'Back in service' : 'Out of service'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => archive(s)}><Archive aria-hidden="true" className="h-4 w-4" />Retire</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {editing && <StationForm station={editing === 'new' ? null : editing} zones={zn.data || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast.success('Saved'); reload(); }} />}
    </div>
  );
};

/* ── rates ────────────────────────────────────────────────────────────────── */

const BLOCKS = [['1', 'By the minute'], ['15', 'Every 15 minutes'], ['30', 'Every 30 minutes'], ['60', 'Every hour']];

const tiersText = (r) => (r.tiers || []).map((t) => `${t.players} player${t.players === 1 ? '' : 's'} ${rsShort(t.hour)}/hr`).join(' · ');
const rateSummary = (r) => [r.bill_time ? tiersText(r) : null, r.unit_price > 0 ? `${rsShort(r.unit_price)} per ${r.unit_label || 'frame'}` : null].filter(Boolean).join(' · ') || 'No price set';

const RateForm = ({ rate, zones, stations, onClose, onSaved }) => {
  const scopeOf = (r) => (r?.station_id ? `station:${r.station_id}` : r?.zone_id ? `zone:${r.zone_id}` : r?.kind ? `kind:${r.kind}` : 'all');
  const [f, setF] = useState(() => rate ? {
    name: rate.name, scope: scopeOf(rate), bill_time: rate.bill_time, tiers: rate.tiers.map((t) => ({ players: String(t.players), hour: String(t.hour) })), extra: rate.extra_player_hour == null ? '' : String(rate.extra_player_hour),
    block: String(rate.block_minutes), grace: String(rate.grace_minutes), min: String(rate.min_minutes), unitLabel: rate.unit_label || '', unitPrice: rate.unit_price ? String(rate.unit_price) : '',
    bands: rate.bands.map((b) => ({ name: b.name, days: b.days, from: b.from, to: b.to, pct: String(b.multiplier_pct ?? 100) }))
  } : { name: '', scope: 'kind:CONSOLE', bill_time: true, tiers: [{ players: '1', hour: '' }], extra: '', block: '1', grace: '0', min: '0', unitLabel: '', unitPrice: '', bands: [] });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const setTier = (i, k, v) => setF((x) => ({ ...x, tiers: x.tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)) }));
  const setBand = (i, patch) => setF((x) => ({ ...x, bands: x.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const unitOnly = !f.bill_time;

  const save = () => run(async () => {
    setError('');
    const [kind, id] = f.scope.split(':');
    const body = {
      name: f.name, kind: kind === 'kind' ? id : null, zone_id: kind === 'zone' ? Number(id) : null, station_id: kind === 'station' ? Number(id) : null,
      bill_time: f.bill_time, tiers: f.bill_time ? f.tiers.filter((t) => t.hour !== '').map((t) => ({ players: Number(t.players), hour: Number(t.hour) })) : [],
      extra_player_hour: f.extra === '' ? null : Number(f.extra), block_minutes: Number(f.block), grace_minutes: Number(f.grace), min_minutes: Number(f.min),
      unit_label: f.unitLabel || null, unit_price: f.unitPrice === '' ? 0 : Number(f.unitPrice),
      bands: f.bands.map((b) => ({ name: b.name, days: b.days, from: b.from, to: b.to, multiplier_pct: Number(b.pct) }))
    };
    try { onSaved(await api(rate ? `/gaming/rates/${rate.rate_id}` : '/gaming/rates', { method: rate ? 'PUT' : 'POST', body })); } catch (e) { setError(e.message); }
  }, null);

  return (
    <Modal wide title={rate ? `Edit ${rate.name}` : 'New rate'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.name.trim()}>{rate ? 'Save rate' : 'Add rate'}</Button></>}>
      <div className="space-y-5">
        <Alert>{error}</Alert>
        {rate && <p className="rounded-(--radius-control) bg-surface-2 px-3.5 py-2.5 text-small text-ink-500">Sessions already running keep the rate they started with. A change applies to the next session.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="rf-name" label="Name"><Input id="rf-name" value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder="PS5 hourly, Pool by the frame" autoFocus /></Field>
          <Field id="rf-scope" label="Applies to" hint="A station's own rate beats its zone's, which beats its kind's">
            <Select id="rf-scope" value={f.scope} onChange={(e) => set('scope')(e.target.value)}>
              <option value="all">Every station</option>
              <optgroup label="A kind of station">{KINDS.map(([v, l]) => <option key={v} value={`kind:${v}`}>{l}</option>)}</optgroup>
              {zones.length > 0 && <optgroup label="A zone">{zones.map((z) => <option key={z.zone_id} value={`zone:${z.zone_id}`}>{z.name}</option>)}</optgroup>}
              {stations.length > 0 && <optgroup label="One station">{stations.map((s) => <option key={s.station_id} value={`station:${s.station_id}`}>{s.name}</option>)}</optgroup>}
            </Select>
          </Field>
        </div>
        <Toggle id="rf-time" checked={f.bill_time} onChange={set('bill_time')} label="Charge for the time on the clock" hint="Off for a table charged only per frame or game" />

        {f.bill_time && (
          <fieldset className="space-y-3 rounded-(--radius-card) border border-line p-4">
            <legend className="px-1 text-small font-medium text-ink-700">Price per hour, by number of players</legend>
            {f.tiers.map((t, i) => (
              <div key={i} className="flex flex-wrap items-end gap-3">
                <div className="w-28"><NumberField id={`rf-tp-${i}`} label={i === 0 ? 'Players' : null} value={t.players} onChange={(v) => setTier(i, 'players', v)} min={1} step={1} /></div>
                <div className="w-40"><NumberField id={`rf-th-${i}`} label={i === 0 ? 'Per hour' : null} value={t.hour} onChange={(v) => setTier(i, 'hour', v)} prefix="₹" /></div>
                {f.tiers.length > 1 && <Button type="button" size="sm" variant="ghost" aria-label="Remove this price" onClick={() => setF((x) => ({ ...x, tiers: x.tiers.filter((_, j) => j !== i) }))}><Trash2 aria-hidden="true" className="h-4 w-4" /></Button>}
              </div>
            ))}
            <div className="flex flex-wrap items-end gap-4">
              <Button type="button" size="sm" variant="secondary" onClick={() => setF((x) => ({ ...x, tiers: [...x.tiers, { players: String(Number(x.tiers.at(-1)?.players || 0) + 1), hour: '' }] }))}><Plus aria-hidden="true" className="h-4 w-4" />Another price</Button>
              <div className="w-56"><NumberField id="rf-extra" label="Each extra player past the last row" value={f.extra} onChange={set('extra')} prefix="₹" hint="Blank: the last row's price" /></div>
            </div>
            <p className="text-caption text-ink-500">Three players pay the next row up (a row for 4 covers 3 and 4).</p>
          </fieldset>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          {f.bill_time && <Field id="rf-block" label="Billed" hint="Time over a block is rounded up"><Select id="rf-block" value={f.block} onChange={(e) => set('block')(e.target.value)}>{BLOCKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>}
          {f.bill_time && <NumberField id="rf-grace" label="Grace" suffix="min" value={f.grace} onChange={set('grace')} min={0} step={1} hint="Not billed if within this much over" />}
          {f.bill_time && <NumberField id="rf-min" label="Minimum" suffix="min" value={f.min} onChange={set('min')} min={0} step={1} hint="The least ever billed" />}
        </div>

        <fieldset className="space-y-3 rounded-(--radius-card) border border-line p-4">
          <legend className="px-1 text-small font-medium text-ink-700">Per frame or game (pool, snooker, table games)</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="rf-ul" label="What you count"><Input id="rf-ul" value={f.unitLabel} onChange={(e) => set('unitLabel')(e.target.value)} placeholder="frame" maxLength={20} /></Field>
            <NumberField id="rf-up" label="Price each" value={f.unitPrice} onChange={set('unitPrice')} prefix="₹" hint={unitOnly ? 'Required when the clock is not charged' : 'Added to the time'} />
          </div>
        </fieldset>

        {f.bill_time && (
          <fieldset className="space-y-3 rounded-(--radius-card) border border-line p-4">
            <legend className="px-1 text-small font-medium text-ink-700">Peak and happy-hour times</legend>
            {f.bands.map((b, i) => (
              <div key={i} className="space-y-2 rounded-(--radius-control) bg-surface-2 p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-40"><Field id={`rf-bn-${i}`} label="Name"><Input id={`rf-bn-${i}`} value={b.name} onChange={(e) => setBand(i, { name: e.target.value })} /></Field></div>
                  <Field id={`rf-bf-${i}`} label="From"><Input id={`rf-bf-${i}`} type="time" value={b.from} onChange={(e) => setBand(i, { from: e.target.value })} /></Field>
                  <Field id={`rf-bt-${i}`} label="To"><Input id={`rf-bt-${i}`} type="time" value={b.to} onChange={(e) => setBand(i, { to: e.target.value })} /></Field>
                  <div className="w-36"><NumberField id={`rf-bp-${i}`} label="Price is" suffix="%" value={b.pct} onChange={(v) => setBand(i, { pct: v })} min={10} step={5} hint="of the normal price" /></div>
                  <Button type="button" size="sm" variant="ghost" aria-label="Remove this time" onClick={() => setF((x) => ({ ...x, bands: x.bands.filter((_, j) => j !== i) }))}><Trash2 aria-hidden="true" className="h-4 w-4" /></Button>
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
                  {DAYS.map(([d, l]) => <button key={d} type="button" aria-pressed={b.days.includes(d)} onClick={() => setBand(i, { days: b.days.includes(d) ? b.days.filter((n) => n !== d) : [...b.days, d] })} className={`rounded-full border px-2.5 py-1 text-caption font-medium ${b.days.includes(d) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink-700'}`}>{l}</button>)}
                </div>
              </div>
            ))}
            <Button type="button" size="sm" variant="secondary" onClick={() => setF((x) => ({ ...x, bands: [...x.bands, { name: 'Evening', days: [0, 1, 2, 3, 4, 5, 6], from: '18:00', to: '23:00', pct: '120' }] }))}><Plus aria-hidden="true" className="h-4 w-4" />Add a peak time</Button>
            <p className="text-caption text-ink-500">120% is a fifth more than normal; 80% is a fifth off (a happy hour).</p>
          </fieldset>
        )}
      </div>
    </Modal>
  );
};

const Rates = () => {
  const toast = useToast();
  const rates = useLoad('/gaming/rates');
  const zn = useLoad('/gaming/zones');
  const st = useLoad('/gaming/stations');
  const [editing, setEditing] = useState(null);
  const [busy, run] = useAction();
  const scope = (r) => (r.station_id ? (st.data || []).find((s) => s.station_id === r.station_id)?.name || 'One station' : r.zone_id ? `Zone: ${(zn.data || []).find((z) => z.zone_id === r.zone_id)?.name || ''}` : r.kind ? KIND_LABEL[r.kind] : 'Every station');
  const remove = (r) => { if (window.confirm(`Switch off ${r.name}? Sessions already running keep it.`)) run(async () => { await api(`/gaming/rates/${r.rate_id}`, { method: 'DELETE' }); rates.reload(); }, 'Switched off'); };
  return (
    <Panel title="Rates" lead="What time costs. A station with no rate cannot start a session." action={<Button size="sm" onClick={() => setEditing('new')}><Plus aria-hidden="true" className="h-4 w-4" />New rate</Button>}>
      <ListState loading={rates.loading && !rates.data} error={rates.error} empty={rates.data && !rates.data.length} emptyLabel="No rates yet" emptyBody="Add one for your consoles, for example 1 player ₹100 an hour, 2 players ₹150." />
      {rates.data?.length > 0 && (
        <ul className="divide-y divide-line">
          {rates.data.map((r) => (
            <li key={r.rate_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-small font-medium text-ink-900">{r.name} <span className="ml-1 font-normal text-ink-500">for {scope(r)}</span></p>
                <p className="text-caption text-ink-500">{rateSummary(r)}{r.bill_time && r.block_minutes > 1 ? ` · billed every ${r.block_minutes} min` : ''}{r.bill_time && r.min_minutes ? ` · minimum ${r.min_minutes} min` : ''}{r.bands.length ? ` · ${r.bands.length} peak time${r.bands.length === 1 ? '' : 's'}` : ''}</p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(r)}><Pencil aria-hidden="true" className="h-4 w-4" />Edit</Button>
                <Button size="sm" variant="ghost" loading={busy} onClick={() => remove(r)}><Trash2 aria-hidden="true" className="h-4 w-4" />Switch off</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <RateForm rate={editing === 'new' ? null : editing} zones={zn.data || []} stations={st.data || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast.success('Saved'); rates.reload(); }} />}
    </Panel>
  );
};

/* ── offers (bundles) ─────────────────────────────────────────────────────── */

const BundleForm = ({ bundle, kind = 'SESSION', onClose, onSaved }) => {
  const pack = kind === 'PACK';
  const [f, setF] = useState(bundle ? { name: bundle.name, hours: String(bundle.minutes / 60), price: String(bundle.price), players: String(bundle.players), kinds: bundle.kinds || [], valid: bundle.valid_days ? String(bundle.valid_days) : '' } : { name: '', hours: pack ? '10' : '3', price: '', players: '1', kinds: [], valid: pack ? '90' : '' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (k) => setF((x) => ({ ...x, kinds: x.kinds.includes(k) ? x.kinds.filter((n) => n !== k) : [...x.kinds, k] }));
  const save = () => run(async () => {
    setError('');
    const body = { name: f.name, kind, minutes: Math.round(Number(f.hours) * 60), price: Number(f.price), players: Number(f.players), kinds: f.kinds, valid_days: pack && f.valid !== '' ? Number(f.valid) : null };
    try { onSaved(await api(bundle ? `/gaming/bundles/${bundle.bundle_id}` : '/gaming/bundles', { method: bundle ? 'PUT' : 'POST', body })); } catch (e) { setError(e.message); }
  }, null);
  return (
    <Modal title={bundle ? `Edit ${bundle.name}` : pack ? 'New hour pack' : 'New offer'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.name.trim() || f.price === '' || !(Number(f.hours) > 0)}>{bundle ? 'Save' : pack ? 'Add pack' : 'Add offer'}</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="bf-name" label="Name"><Input id="bf-name" value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder="3 hours, Weekend special" autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField id="bf-hours" label="Hours" value={f.hours} onChange={set('hours')} min={0.25} step="any" />
          <NumberField id="bf-price" label="Price (before GST)" value={f.price} onChange={set('price')} prefix="₹" />
          {pack ? <NumberField id="bf-valid" label="Good for" suffix="days" value={f.valid} onChange={set('valid')} min={1} step={1} hint="Blank: never expires" /> : <NumberField id="bf-players" label="Players covered" value={f.players} onChange={set('players')} min={1} step={1} />}
        </div>
        <Field id="bf-kinds" label="For which stations" hint="None ticked: any">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Station kinds">
            {KINDS.map(([k]) => <button key={k} type="button" aria-pressed={f.kinds.includes(k)} onClick={() => toggle(k)} className={`rounded-full border px-3 py-1 text-caption font-medium ${f.kinds.includes(k) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink-700'}`}>{KIND_LABEL[k]}</button>)}
          </div>
        </Field>
        <p className="text-caption text-ink-500">{pack ? 'A pack is prepaid hours the player spends over several visits. Minutes beyond what is left are charged at the rate of the station.' : 'An offer is time sold as a block at one price. Stopping early refunds nothing; time over is charged at the rate of the station.'}</p>
      </div>
    </Modal>
  );
};

const Offers = ({ kind = 'SESSION' }) => {
  const toast = useToast();
  const pack = kind === 'PACK';
  const b = useLoad(`/gaming/bundles?kind=${kind}`);
  const [editing, setEditing] = useState(null);
  const [busy, run] = useAction();
  const remove = (x) => run(async () => { await api(`/gaming/bundles/${x.bundle_id}`, { method: 'DELETE' }); b.reload(); }, 'Switched off');
  return (
    <Panel title={pack ? 'Hour packs' : 'Offers'} lead={pack ? 'Prepaid hours sold to a player and played from the board: 10 hours for ₹800' : 'Fixed time at a set price, started from the board: 3 hours for ₹250'} action={<Button size="sm" onClick={() => setEditing('new')}><Plus aria-hidden="true" className="h-4 w-4" />{pack ? 'New pack' : 'New offer'}</Button>}>
      <ListState loading={b.loading && !b.data} error={b.error} empty={b.data && !b.data.length} emptyLabel={pack ? 'No hour packs yet' : 'No offers yet'} emptyBody={pack ? 'Packs are optional.' : 'Offers are optional. Without one, every session is paid by the time used.'} />
      {b.data?.length > 0 && (
        <ul className="divide-y divide-line">
          {b.data.map((x) => (
            <li key={x.bundle_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1"><p className="text-small font-medium text-ink-900">{x.name}</p><p className="text-caption text-ink-500">{duration(x.minutes * 60)} for {rs(x.price)}{pack ? (x.valid_days ? ` · good for ${x.valid_days} days` : ' · no expiry') : ` · ${x.players} player${x.players === 1 ? '' : 's'}`}{x.kinds ? ` · ${x.kinds.map((k) => KIND_LABEL[k]).join(', ')}` : ''}</p></div>
              <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEditing(x)}><Pencil aria-hidden="true" className="h-4 w-4" />Edit</Button><Button size="sm" variant="ghost" loading={busy} onClick={() => remove(x)}><Trash2 aria-hidden="true" className="h-4 w-4" />Switch off</Button></div>
            </li>
          ))}
        </ul>
      )}
      {editing && <BundleForm kind={kind} bundle={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast.success('Saved'); b.reload(); }} />}
    </Panel>
  );
};

/* ── games and settings ───────────────────────────────────────────────────── */

const Games = () => {
  const g = useLoad('/gaming/games');
  const [name, setName] = useState('');
  const [busy, run] = useAction();
  const add = () => run(async () => { await api('/gaming/games', { method: 'POST', body: { name } }); setName(''); g.reload(); }, null);
  const remove = (x) => run(async () => { await api(`/gaming/games/${x.game_id}`, { method: 'DELETE' }); g.reload(); }, null);
  return (
    <Panel title="Games" lead="A short list to pick from when you start a session, so you can see what is played most">
      <form className="mb-4 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add(); }}>
        <Input aria-label="New game" className="max-w-xs" placeholder="FIFA 26, Tekken 8, GTA V" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" size="sm" loading={busy} disabled={!name.trim()}><Plus aria-hidden="true" className="h-4 w-4" />Add</Button>
      </form>
      <ListState loading={g.loading && !g.data} error={g.error} empty={g.data && !g.data.length} emptyLabel="No games yet" />
      <div className="flex flex-wrap gap-2">
        {(g.data || []).map((x) => <span key={x.game_id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-1 pl-3 pr-1 text-small">{x.name}<Button size="sm" variant="ghost" aria-label={`Remove ${x.name}`} onClick={() => remove(x)}><Trash2 aria-hidden="true" className="h-3.5 w-3.5" /></Button></span>)}
      </div>
    </Panel>
  );
};

const Settings = () => {
  const { hasFeature } = useAuth();
  const s = useLoad('/gaming/settings');
  const [f, setF] = useState(null);
  const [rules, setRules] = useState([]);
  const [busy, run] = useAction();
  useEffect(() => { if (s.data) setF({ alert_minutes: String(s.data.alert_minutes), hold_minutes: String(s.data.hold_minutes), noshow_minutes: String(s.data.noshow_minutes), gst_rate: String(s.data.gst_rate) }); setRules((s.data.topup_bonus || []).map((r) => ({ min: String(r.min), bonus: String(r.bonus) }))); }, [s.data]);
  const save = () => run(async () => { await api('/gaming/settings', { method: 'PUT', body: { ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)])), ...(hasFeature('gaming_wallet') ? { topup_bonus: rules.filter((r) => r.min !== '' && r.bonus !== '').map((r) => ({ min: Number(r.min), bonus: Number(r.bonus) })) } : {}) } }); s.reload(); }, 'Settings saved');
  return (
    <Panel title="Settings">
      <ListState loading={s.loading && !f} error={s.error} />
      {f && (
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField id="gs-alert" label="Warn when this much time is left" suffix="min" value={f.alert_minutes} onChange={(v) => setF((x) => ({ ...x, alert_minutes: v }))} min={1} step={1} hint="The tile turns amber and staff get a notification" />
          <NumberField id="gs-gst" label="GST on gaming time" suffix="%" value={f.gst_rate} onChange={(v) => setF((x) => ({ ...x, gst_rate: v }))} min={0} step="any" hint="Usually 18%. Food and drink use their own rates." />
          <NumberField id="gs-hold" label="Hold a booked station for" suffix="min" value={f.hold_minutes} onChange={(v) => setF((x) => ({ ...x, hold_minutes: v }))} min={0} step={1} hint="Before a booking, the station shows as booked" />
          <NumberField id="gs-noshow" label="Mark a no-show after" suffix="min" value={f.noshow_minutes} onChange={(v) => setF((x) => ({ ...x, noshow_minutes: v }))} min={0} step={1} />
          {hasFeature('gaming_wallet') && (
            <fieldset className="space-y-3 rounded-(--radius-card) border border-line p-4 sm:col-span-2">
              <legend className="px-1 text-small font-medium text-ink-700">Wallet top-up bonus</legend>
              {rules.map((r, i) => (
                <div key={i} className="flex flex-wrap items-end gap-3">
                  <div className="w-44"><NumberField id={`tb-min-${i}`} label={i === 0 ? 'When they pay at least' : null} prefix="₹" value={r.min} onChange={(v) => setRules((x) => x.map((y, j) => (j === i ? { ...y, min: v } : y)))} /></div>
                  <div className="w-44"><NumberField id={`tb-bonus-${i}`} label={i === 0 ? 'They get extra' : null} prefix="₹" value={r.bonus} onChange={(v) => setRules((x) => x.map((y, j) => (j === i ? { ...y, bonus: v } : y)))} /></div>
                  <Button type="button" size="sm" variant="ghost" aria-label="Remove this bonus" onClick={() => setRules((x) => x.filter((_, j) => j !== i))}><Trash2 aria-hidden="true" className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="secondary" onClick={() => setRules((x) => [...x, { min: '500', bonus: '50' }])}><Plus aria-hidden="true" className="h-4 w-4" />Add a bonus</Button>
              <p className="text-caption text-ink-500">Pay ₹500, get ₹50 extra. A top-up earns the highest bonus it reaches.</p>
            </fieldset>
          )}
          <div className="sm:col-span-2"><Button onClick={save} loading={busy}>Save settings</Button></div>
        </div>
      )}
    </Panel>
  );
};

export default function GamingSetup() {
  const { hasFeature } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'stations';
  const tabs = [{ key: 'stations', label: 'Stations' }, { key: 'rates', label: 'Rates' }, { key: 'offers', label: 'Offers' }, { key: 'games', label: 'Games' }, { key: 'settings', label: 'Settings' }];
  return (
    <div>
      <PageHeader title="Stations and rates" lead="What you have, and what time costs." />
      <Tabs value={tab} onChange={(k) => setParams({ tab: k }, { replace: true })} tabs={tabs} />
      {tab === 'stations' && <Stations />}
      {tab === 'rates' && <Rates />}
      {tab === 'offers' && <div className="space-y-5"><Offers />{hasFeature('gaming_wallet') && <Offers kind="PACK" />}</div>}
      {tab === 'games' && <Games />}
      {tab === 'settings' && <Settings />}
    </div>
  );
}
