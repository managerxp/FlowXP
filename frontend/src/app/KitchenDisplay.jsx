/*
 * The kitchen's own screen: what has been sent to the kitchen, by station, how
 * long each line has been cooking against how long it should take, and moving
 * lines through the pass (making → ready → served).
 *
 * Polls rather than pushes — nothing in this app has a socket layer — but the
 * elapsed timers tick locally every 15 seconds so a ticket visibly ages between
 * polls. Light-themed like the rest of the product.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { beep, getDevicePrefs, setDevicePref } from '../lib/printing.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, SkeletonRows, useToast } from '../components/ui.jsx';

const POLL_MS = 8000;

const TABS = [
  { key: 'making', label: 'To make', statuses: ['PREPARING'], next: 'READY', verb: 'Mark ready' },
  { key: 'ready', label: 'Ready to serve', statuses: ['READY'], next: 'SERVED', verb: 'Mark served', back: 'PREPARING' },
  { key: 'served', label: 'Served', statuses: ['SERVED'] }
];

const URGENCY = { ok: 'text-ink-500', warning: 'font-semibold text-warning', late: 'font-bold text-danger' };
const urgencyOf = (elapsed, expected) => (!expected ? 'ok' : elapsed > expected ? 'late' : elapsed >= expected * 0.75 ? 'warning' : 'ok');
const minutesSince = (iso, now) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));

const Ticket = ({ ticket, tab, now, onAdvance, onRush }) => {
  const items = ticket.items.filter((i) => tab.statuses.includes(i.status) || (tab.key === 'making' && i.cancelled));
  const live = items.filter((i) => !i.cancelled);
  const oldest = live.length ? Math.max(...live.map((i) => minutesSince(i.sent_at, now))) : 0;
  const late = tab.key === 'making' && live.some((i) => urgencyOf(minutesSince(i.sent_at, now), i.expected_minutes) === 'late');
  const where = ticket.platform ? ticket.platform : ticket.order_type === 'TAKEAWAY' ? 'Takeaway' : null;

  return (
    <div className={`glass rounded-[--radius-card] p-4 ${ticket.priority === 'RUSH' ? 'ring-2 ring-danger' : late ? 'ring-1 ring-danger/50' : ''}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="flex flex-wrap items-center gap-1.5 font-bold text-ink-900">
            {ticket.table_name || ticket.order_number}
            {ticket.priority === 'RUSH' && <Badge tone="danger">RUSH</Badge>}
            {where && <Badge tone="brand">{where}</Badge>}
          </p>
          <p className="text-xs text-ink-400">{ticket.order_number} · sent {new Date(ticket.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
        {tab.key === 'making' && live.length > 0 && <span className={`text-sm ${late ? URGENCY.late : URGENCY.ok}`}>{oldest} min</span>}
      </div>

      <ul className="space-y-2 text-sm">
        {items.map((item) => {
          const elapsed = minutesSince(item.sent_at, now);
          const u = tab.key === 'making' && !item.cancelled ? urgencyOf(elapsed, item.expected_minutes) : null;
          return (
            <li key={item.order_item_id} className={`flex items-start justify-between gap-3 ${item.cancelled ? 'rounded-md bg-danger/10 px-2 py-1' : ''}`}>
              <span className={item.cancelled ? 'text-danger line-through' : 'text-ink-900'}>
                <span className="font-semibold">{item.quantity} ×</span> {item.description}
                {item.combo?.length > 0 && <span className="block text-xs font-medium text-ink-500">{item.combo.join(' · ')}</span>}
                {item.modifiers?.length > 0 && <span className="block text-xs font-medium text-brand-600">{item.modifiers.map((m) => m.name).join(' · ')}</span>}
                {item.kitchen_notes && <span className="block text-xs text-ink-500">“{item.kitchen_notes}”</span>}
                {item.cancelled && <span className="block text-xs font-bold no-underline">Cancelled — don't make</span>}
              </span>
              {u && item.expected_minutes && <span className={`shrink-0 text-xs ${URGENCY[u]}`}>{elapsed}/{item.expected_minutes}m</span>}
              {tab.key !== 'making' && item.prep_minutes != null && <span className="shrink-0 text-xs text-ink-400">{item.prep_minutes} min</span>}
            </li>
          );
        })}
      </ul>

      {(tab.next || onRush) && live.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {tab.next && <Button size="sm" onClick={() => onAdvance(live, tab.next)}>{tab.verb}</Button>}
          {tab.back && <Button size="sm" variant="ghost" onClick={() => onAdvance(live, tab.back)}>Back to making</Button>}
          {tab.key === 'making' && ticket.priority !== 'RUSH' && <Button size="sm" variant="ghost" onClick={() => onRush(ticket)}>Rush</Button>}
        </div>
      )}
    </div>
  );
};

/* Stations, which dishes each cooks, and how long a dish should take. */
const SetupModal = ({ onClose, onSaved }) => {
  const toast = useToast();
  const [stations, setStations] = useState([]);
  const [routing, setRouting] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => Promise.all([api('/kitchen/stations'), api('/kitchen/routing')])
    .then(([s, r]) => { setStations(s); setRouting({ default_prep_minutes: r.default_prep_minutes, dishes: r.dishes.map((d) => ({ ...d, station_id: d.station_id ?? '', prep_minutes: d.prep_minutes ?? '' })) }); })
    .catch((e) => setError(e.status === 403 ? 'You need catalogue permission to change kitchen setup.' : e.message));
  useEffect(() => { load(); }, []);

  const addStation = async (e) => {
    e.preventDefault(); setError('');
    try { await api('/kitchen/stations', { method: 'POST', body: { name } }); setName(''); load(); } catch (caught) { setError(caught.message); }
  };
  const removeStation = async (s) => {
    if (!confirm(`Remove ${s.name}? Its dishes become unassigned.`)) return;
    await api(`/kitchen/stations/${s.station_id}`, { method: 'PUT', body: { is_active: false } }); load();
  };
  const setDish = (id, field, value) => setRouting((r) => ({ ...r, dishes: r.dishes.map((d) => (d.product_id === id ? { ...d, [field]: value } : d)) }));

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api('/kitchen/routing', { method: 'PUT', body: {
        default_prep_minutes: Number(routing.default_prep_minutes),
        dishes: routing.dishes.map((d) => ({ product_id: d.product_id, station_id: d.station_id === '' ? null : Number(d.station_id), prep_minutes: d.prep_minutes === '' ? null : Number(d.prep_minutes) }))
      } });
      toast.success('Kitchen setup saved');
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Kitchen stations" onClose={onClose} wide>
      <div className="space-y-5">
        <Alert>{error}</Alert>
        <div>
          <p className="mb-2 text-sm font-semibold text-ink-900">Stations</p>
          <div className="flex flex-wrap gap-2">
            {stations.map((s) => (
              <span key={s.station_id} className="inline-flex items-center gap-2 rounded-full border border-line-strong px-3 py-1 text-sm text-ink-800">
                {s.name} <span className="text-xs text-ink-400">{s.dishes} dishes</span>
                <button type="button" aria-label={`Remove ${s.name}`} onClick={() => removeStation(s)} className="text-ink-400 hover:text-danger">✕</button>
              </span>
            ))}
            {stations.length === 0 && <span className="text-sm text-ink-500">No stations yet — one screen shows everything. Add stations like Tandoor, Curry or Cold to split the work.</span>}
          </div>
          <form onSubmit={addStation} className="mt-3 flex max-w-sm gap-2"><Input placeholder="New station, e.g. Tandoor" value={name} onChange={(e) => setName(e.target.value)} /><Button type="submit" size="sm" variant="secondary">Add</Button></form>
        </div>

        {routing && (
          <div>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
              <p className="text-sm font-semibold text-ink-900">Where each dish is cooked, and how long it should take</p>
              <div className="w-56"><Field id="default-min" label="Time when a dish has none (min)"><Input id="default-min" type="number" min="1" max="240" value={routing.default_prep_minutes} onChange={(e) => setRouting((r) => ({ ...r, default_prep_minutes: e.target.value }))} /></Field></div>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface-2 text-xs text-ink-400"><tr><th className="px-3 py-2">Dish</th><th className="px-3 py-2">Station</th><th className="w-28 px-3 py-2">Minutes</th></tr></thead>
                <tbody>
                  {routing.dishes.map((d) => (
                    <tr key={d.product_id} className="border-t border-line">
                      <td className="px-3 py-1.5 text-ink-900">{d.name} <span className="text-xs text-ink-400">{d.category}</span></td>
                      <td className="px-3 py-1.5">
                        <select aria-label={`Station for ${d.name}`} value={d.station_id} onChange={(e) => setDish(d.product_id, 'station_id', e.target.value)} className="w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm">
                          <option value="">Unassigned</option>
                          {stations.map((s) => <option key={s.station_id} value={s.station_id}>{s.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-1.5"><input aria-label={`Minutes for ${d.name}`} type="number" min="1" max="240" placeholder={String(routing.default_prep_minutes)} value={d.prep_minutes} onChange={(e) => setDish(d.product_id, 'prep_minutes', e.target.value)} className="w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-400">Changes apply to new orders. Tickets already in the kitchen keep the station and time they were sent with.</p>
          </div>
        )}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Close</Button><Button onClick={save} disabled={busy || !routing}>{busy ? 'Saving…' : 'Save setup'}</Button></div>
      </div>
    </Modal>
  );
};

const KitchenDisplay = () => {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tabKey, setTabKey] = useState('making');
  const [station, setStation] = useState('all');
  const [now, setNow] = useState(Date.now());
  const [setup, setSetup] = useState(false);
  const [sound, setSound] = useState(() => getDevicePrefs().kitchenSound);
  const seen = useRef(null);

  // A short beep when a new order arrives, and a different one when something goes past its time.
  useEffect(() => {
    if (!data) return;
    const making = data.tickets.flatMap((t) => t.items).filter((i) => i.status === 'PREPARING');
    const ids = new Set(making.map((i) => i.order_item_id));
    const late = new Set(making.filter((i) => i.urgency === 'late').map((i) => i.order_item_id));
    if (seen.current && sound) {
      if ([...ids].some((id) => !seen.current.ids.has(id))) beep('new');
      else if ([...late].some((id) => !seen.current.late.has(id))) beep('late');
    }
    seen.current = { ids, late };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSound = () => { const next = !sound; setSound(next); setDevicePref('kitchenSound', next); if (next) beep('new'); };

  const load = () => api('/kitchen/tickets').then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, []);

  const tab = TABS.find((t) => t.key === tabKey);
  const inStation = (i) => station === 'all' || (station === 'none' ? i.station_id == null : i.station_id === Number(station));
  const tickets = useMemo(() => (data ? data.tickets
    .map((t) => ({ ...t, items: t.items.filter(inStation) }))
    .filter((t) => t.items.some((i) => tab.statuses.includes(i.status) || (tab.key === 'making' && i.cancelled))) : []),
  [data, tabKey, station]); // eslint-disable-line react-hooks/exhaustive-deps

  const advance = async (items, status) => {
    try { await api('/kitchen/advance', { method: 'POST', body: { item_ids: items.map((i) => i.order_item_id), status } }); load(); }
    catch (caught) { setError(caught.message); }
  };
  const rush = async (ticket) => {
    try { await api(`/kitchen/orders/${ticket.order_id}/rush`, { method: 'POST' }); toast.success(`${ticket.table_name || ticket.order_number} marked rush`); load(); }
    catch (caught) { setError(caught.message); }
  };

  return (
    <div>
      <PageHeader
        title="Kitchen display"
        lead="Every order sent to the kitchen, by station, with how long each has been cooking."
        action={<div className="flex gap-2"><Button variant="secondary" onClick={toggleSound} aria-pressed={sound}>{sound ? '🔔 Sound on' : '🔕 Sound off'}</Button><Button variant="secondary" to="/app/kitchen/performance">Performance</Button><Button variant="secondary" onClick={() => setSetup(true)}>Stations</Button></div>}
      />

      {data?.stations.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Station">
          {data.stations.map((s) => {
            const key = s.station_id === null ? 'none' : String(s.station_id);
            return (
              <button key={key} type="button" onClick={() => setStation(key)} aria-pressed={station === key}
                      className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${station === key ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-line-strong bg-surface text-ink-700'}`}>
                {s.name}
                {s.making > 0 && <span className={`ml-2 rounded-full px-1.5 text-xs font-bold ${s.late ? 'bg-danger text-white' : 'bg-surface-3 text-ink-600'}`}>{s.making}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="mb-5 flex gap-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTabKey(t.key)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${tabKey === t.key ? 'bg-ink-900 text-white' : 'border border-line bg-surface text-ink-500 hover:border-line-strong hover:text-ink-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <ListState loading={!data && !error} error={error} empty={data && tickets.length === 0} emptyLabel="Nothing here right now." skeleton={<SkeletonRows rows={3} columns={3} />} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tickets.map((t) => <Ticket key={t.order_id} ticket={t} tab={tab} now={now} onAdvance={advance} onRush={rush} />)}
      </div>

      {setup && <SetupModal onClose={() => setSetup(false)} onSaved={() => { setSetup(false); load(); }} />}
    </div>
  );
};

export default KitchenDisplay;
