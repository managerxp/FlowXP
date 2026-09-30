/*
 * The kitchen's own screen: what has been sent to the kitchen, by station, how
 * long each ticket has been cooking against how long it should take, and moving
 * lines through the pass (making → ready → served).
 *
 * Polls rather than pushes — nothing in this app has a socket layer — but the
 * timers tick locally every 15 seconds so a ticket visibly ages between polls.
 *
 * Built to be read from across a kitchen (design.md §31): the table or takeaway
 * number and the time are the biggest things on a ticket, with a bar that fills
 * towards its due time; then the dishes and their options; then one big action.
 * A strip on top says how the pass is doing, and "Cook now" adds up every dish
 * still to make (7 Butter Naan across 3 tickets) — tap one to find its tickets.
 * A mis-tap can be undone for a few seconds. Full screen for a kitchen TV.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, Check, ChefHat, Flame, Maximize2, Minimize2, Undo2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { beep, getDevicePrefs, setDevicePref } from '../lib/printing.js';
import { Alert, Button, Field, Input, Modal, SkeletonRows, humanize, useToast } from '../components/ui.jsx';

const POLL_MS = 8000;
const UNDO_MS = 7000;

const TABS = [
  { key: 'making', label: 'To make', statuses: ['PREPARING'], next: 'READY' },
  { key: 'ready', label: 'Ready to serve', short: 'Ready', statuses: ['READY'], next: 'SERVED', back: 'PREPARING' },
  { key: 'served', label: 'Served', statuses: ['SERVED'] }
];

const TONE = {
  ok: { bar: 'bg-success', text: 'text-ink-900', head: 'bg-surface', label: 'On time', labelText: 'text-success' },
  warning: { bar: 'bg-warning', text: 'text-warning', head: 'bg-warning/5', label: 'Nearly due', labelText: 'text-warning' },
  late: { bar: 'bg-danger', text: 'text-danger', head: 'bg-danger/5', label: 'Late', labelText: 'text-danger' }
};
const RANK = { ok: 0, warning: 1, late: 2 };
const urgencyOf = (elapsed, expected) => (!expected ? 'ok' : elapsed > expected ? 'late' : elapsed >= expected * 0.75 ? 'warning' : 'ok');
const minutesSince = (iso, now) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dishKey = (i) => `${i.description}|${(i.modifiers || []).map((m) => m.name).join(' · ')}`;

const Minutes = ({ value, className = '' }) => (
  <span className={`tabular leading-none ${className}`}>
    {value >= 60 ? <>{Math.floor(value / 60)}<span className="text-small font-medium"> h </span>{value % 60}</> : value}
    <span className="text-small font-medium"> min</span>
  </span>
);

/* How a line on the "To make" tab stands against its own time. */
const LineDue = ({ elapsed, expected }) => {
  if (!expected) return null;
  const left = expected - elapsed;
  const u = urgencyOf(elapsed, expected);
  const text = left > 0 ? `${left} min left` : left === 0 ? 'Due now' : `${-left} min over`;
  return <span className={`tabular shrink-0 pt-0.5 text-caption ${u === 'late' ? 'font-semibold text-danger' : u === 'warning' ? 'font-semibold text-warning' : 'text-ink-400'}`}>{text}</span>;
};

const Ticket = ({ ticket, tab, now, stationName, dimmed, focusKey, onAdvance, onRush }) => {
  const items = ticket.items.filter((i) => tab.statuses.includes(i.status) || (tab.key === 'making' && i.cancelled));
  const live = items.filter((i) => !i.cancelled);
  const away = ticket.order_type !== 'DINE_IN';
  const kind = ticket.platform ? humanize(ticket.platform) : ticket.order_type === 'TAKEAWAY' ? 'Takeaway' : ticket.order_type === 'DELIVERY' ? 'Delivery' : 'Dine-in';
  const title = ticket.table_name || ticket.order_number;
  const rush = ticket.priority === 'RUSH';
  const making = tab.key === 'making';

  // the ticket is as late as its latest dish; the bar fills towards the longest dish's time
  const elapsed = live.length ? Math.max(...live.map((i) => minutesSince(i.sent_at, now))) : 0;
  const worst = making ? live.reduce((w, i) => { const u = urgencyOf(minutesSince(i.sent_at, now), i.expected_minutes); return RANK[u] > RANK[w] ? u : w; }, 'ok') : 'ok';
  const due = Math.max(0, ...live.map((i) => i.expected_minutes || 0));
  const tone = TONE[worst];
  const waiting = tab.key === 'ready' && live.length ? Math.max(...live.map((i) => minutesSince(i.ready_at || i.sent_at, now))) : 0;
  const servedAt = tab.key === 'served' && live.length ? live.map((i) => i.served_at).filter(Boolean).sort().pop() : null;

  return (
    <article className={`flex flex-col overflow-hidden rounded-(--radius-card) border bg-surface shadow-sm transition-opacity duration-(--duration-fast) ${rush ? 'border-danger ring-2 ring-danger' : worst === 'late' ? 'border-danger/50' : 'border-line'} ${dimmed ? 'opacity-35' : ''}`}>
      <header className={`px-4 pb-3 pt-3.5 ${rush ? 'bg-danger/5' : making ? tone.head : tab.key === 'ready' ? 'bg-success/5' : 'bg-surface-2'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[24px] font-bold leading-tight tracking-tight text-ink-900">{title}</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-caption text-ink-500">
              <span className={`rounded-md px-1.5 py-0.5 font-semibold ${away ? 'bg-ink-900 text-white' : 'bg-surface-3 text-ink-700'}`}>{kind}</span>
              {ticket.brand_name && <span className="rounded-md bg-brand-50 px-1.5 py-0.5 font-semibold text-brand-700">{ticket.brand_name}</span>}
              {rush && <span className="inline-flex items-center gap-1 rounded-md bg-danger px-1.5 py-0.5 font-semibold text-white"><Flame aria-hidden="true" className="h-3 w-3" />Rush</span>}
              <span className="tabular">{ticket.table_name ? `${ticket.order_number} · ` : ''}{clock(ticket.sent_at)}</span>
            </p>
          </div>
          {making && live.length > 0 && (
            <div className="shrink-0 text-right">
              <Minutes value={elapsed} className={`text-[28px] font-bold ${tone.text}`} />
              <p className={`mt-1 text-caption font-semibold ${tone.labelText}`}>{tone.label}{due ? ` · ${due} min dish` : ''}</p>
            </div>
          )}
          {tab.key === 'ready' && live.length > 0 && (
            <div className="shrink-0 text-right">
              <Minutes value={waiting} className={`text-[28px] font-bold ${waiting >= 5 ? 'text-warning' : 'text-success'}`} />
              <p className={`mt-1 text-caption font-semibold ${waiting >= 5 ? 'text-warning' : 'text-success'}`}>{waiting >= 5 ? 'Getting cold' : 'Waiting'}</p>
            </div>
          )}
          {servedAt && <p className="tabular shrink-0 pt-1 text-small text-ink-500">{away ? 'Handed over' : 'Served'} {clock(servedAt)}</p>}
        </div>
        {making && due > 0 && live.length > 0 && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3" role="presentation">
            <div className={`h-full rounded-full ${tone.bar} transition-[width] duration-(--duration-slow)`} style={{ width: `${Math.min(100, Math.round((elapsed / due) * 100))}%` }} />
          </div>
        )}
      </header>

      <ul className="flex-1 divide-y divide-line border-t border-line px-2">
        {items.map((item) => {
          const tappable = making && !item.cancelled;
          const Row = tappable ? 'button' : 'div';
          const station = stationName?.get(item.station_id);
          const focused = focusKey && dishKey(item) === focusKey && item.status === 'PREPARING';
          return (
            <li key={item.order_item_id}>
              <Row
                {...(tappable ? { type: 'button', onClick: () => onAdvance([item], 'READY', `${title}: ${item.description} ready`), 'aria-label': `Mark ${item.quantity} ${item.description} ready` } : {})}
                className={`group flex w-full items-start gap-3 px-2 py-2.5 text-left ${tappable ? 'rounded-lg hover:bg-success/5' : ''} ${item.cancelled ? 'bg-danger/5' : ''} ${focused ? 'bg-brand-50' : ''}`}
              >
                {tappable && <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-line-strong text-transparent group-hover:border-success group-hover:bg-success group-hover:text-white"><Check className="h-4 w-4" /></span>}
                {tab.key !== 'making' && <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-success/10 text-success"><Check className="h-4 w-4" /></span>}
                <span className="min-w-0 flex-1">
                  <span className={`block text-body leading-snug ${item.cancelled ? 'text-danger line-through' : 'text-ink-900'}`}>
                    <span className="tabular mr-1 inline-block min-w-[1.75rem] rounded bg-ink-900 px-1 text-center text-small font-bold leading-6 text-white">{item.quantity}</span>
                    <span className="font-medium">{item.description}</span>
                  </span>
                  {item.combo?.length > 0 && <span className="block text-small text-ink-500">{item.combo.join(' · ')}</span>}
                  {item.modifiers?.length > 0 && <span className="block text-small font-semibold text-brand-700">{item.modifiers.map((m) => m.name).join(' · ')}</span>}
                  {item.kitchen_notes && <span className="mt-1 block rounded bg-warning/10 px-1.5 py-0.5 text-small font-semibold text-ink-900">“{item.kitchen_notes}”</span>}
                  {item.cancelled && <span className="block text-small font-semibold text-danger">Cancelled. Don't make.</span>}
                  {station && !item.cancelled && <span className="block text-caption text-ink-400">{station}</span>}
                </span>
                {tappable && <LineDue elapsed={minutesSince(item.sent_at, now)} expected={item.expected_minutes} />}
                {!making && item.prep_minutes != null && <span className="tabular shrink-0 pt-0.5 text-caption text-ink-400">took {item.prep_minutes} min</span>}
              </Row>
            </li>
          );
        })}
      </ul>

      {tab.next && live.length > 0 && (
        <footer className="flex gap-2 border-t border-line p-3">
          {making
            ? <Button size="lg" className="flex-1" onClick={() => onAdvance(live, 'READY', `${title} ready`)}><Check aria-hidden="true" className="h-5 w-5" />{live.length > 1 ? 'All ready' : 'Ready'}</Button>
            : <Button size="lg" className="flex-1 bg-success! hover:bg-success/90!" onClick={() => onAdvance(live, 'SERVED', `${title} ${away ? 'handed over' : 'served'}`)}>{away ? 'Handed over' : 'Served'}</Button>}
          {tab.back && <Button size="lg" variant="secondary" onClick={() => onAdvance(live, tab.back, `${title} back to the kitchen`)}>Back</Button>}
          {making && !rush && <Button size="lg" variant="secondary" onClick={() => onRush(ticket)} aria-label={`Rush ${title}`}><Flame aria-hidden="true" className="h-4 w-4 text-danger" />Rush</Button>}
        </footer>
      )}
    </article>
  );
};

/* A column's own heading — label, live count, and (for "To make") how many are late,
   so the two sections read at a glance without needing to tap into either one. */
const ColumnHeader = ({ label, count, late, innerRef }) => (
  <div ref={innerRef} className="mb-3 flex scroll-mt-4 items-center gap-2">
    <h2 className="text-body font-bold text-ink-900">{label}</h2>
    <span className={`tabular rounded-full px-2 py-0.5 text-caption font-semibold ${late ? 'bg-danger text-white' : 'bg-surface-3 text-ink-700'}`}>{count}</span>
    {late > 0 && <span className="text-caption font-semibold text-danger">{late} late</span>}
  </div>
);

const EmptyColumn = ({ title, lead }) => (
  <div className="flex flex-col items-center rounded-(--radius-card) border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success/10 text-success"><ChefHat aria-hidden="true" className="h-5 w-5" /></span>
    <p className="mt-3 text-small font-semibold text-ink-900">{title}</p>
    <p className="mt-1 max-w-xs text-caption text-ink-500">{lead}</p>
  </div>
);

/* Every dish still to make on this station, added up across tickets. */
const CookNow = ({ rows, focusKey, onFocus, compact }) => {
  if (!rows.length) return null;
  if (compact) {
    return (
      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1 xl:hidden" aria-label="Cook now">
        {rows.map((r) => (
          <button key={r.key} type="button" aria-pressed={focusKey === r.key} onClick={() => onFocus(focusKey === r.key ? null : r.key)}
                  className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-small ${focusKey === r.key ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink-700'}`}>
            <span className="tabular font-bold text-ink-900">{r.qty}</span>{r.name}{r.extra && <span className="text-ink-400">{r.extra}</span>}
          </button>
        ))}
      </div>
    );
  }
  return (
    <aside className="sticky top-4 hidden self-start rounded-(--radius-card) border border-line bg-surface xl:block">
      <div className="border-b border-line px-4 py-3">
        <p className="text-small font-semibold text-ink-900">Cook now</p>
        <p className="text-caption text-ink-500">Every dish still to make. Tap one to find its tickets.</p>
      </div>
      <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
        {rows.map((r) => (
          <li key={r.key}>
            <button type="button" aria-pressed={focusKey === r.key} onClick={() => onFocus(focusKey === r.key ? null : r.key)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${focusKey === r.key ? 'bg-brand-50' : 'hover:bg-surface-2'}`}>
              <span className={`tabular w-9 shrink-0 text-[20px] font-bold leading-none ${r.late ? 'text-danger' : 'text-ink-900'}`}>{r.qty}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-small font-medium text-ink-900">{r.name}</span>
                <span className="block truncate text-caption text-ink-500">{r.extra ? `${r.extra} · ` : ''}{r.tickets} {r.tickets === 1 ? 'ticket' : 'tickets'}{r.late ? ` · ${r.late} late` : ''}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
};

const Stat = ({ label, value, note, tone = 'text-ink-900', onClick }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag {...(onClick ? { type: 'button', onClick } : {})} className={`rounded-(--radius-card) border border-line bg-surface px-4 py-3 text-left ${onClick ? 'hover:border-line-strong' : ''}`}>
      <p className="text-caption font-medium text-ink-500">{label}</p>
      <p className={`tabular mt-1 text-[26px] font-bold leading-none ${tone}`}>{value}</p>
      {note && <p className="mt-1 truncate text-caption text-ink-500">{note}</p>}
    </Tag>
  );
};

/* Stations, which dishes each cooks, and how long a dish should take. */
const SetupModal = ({ onClose, onSaved }) => {
  const toast = useToast();
  const [stations, setStations] = useState([]);
  const [routing, setRouting] = useState(null);
  const [name, setName] = useState('');
  const [outletOnly, setOutletOnly] = useState(false);
  const { outlets, outletId } = useAuth();
  const canScope = outlets.length > 1 && outletId != null && outletId !== 'all';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => Promise.all([api('/kitchen/stations'), api('/kitchen/routing')])
    .then(([s, r]) => { setStations(s); setRouting({ default_prep_minutes: r.default_prep_minutes, dishes: r.dishes.map((d) => ({ ...d, station_id: d.station_id ?? '', prep_minutes: d.prep_minutes ?? '' })) }); })
    .catch((e) => setError(e.status === 403 ? 'You need catalogue permission to change kitchen setup.' : e.message));
  useEffect(() => { load(); }, []);

  const addStation = async (e) => {
    e.preventDefault(); setError('');
    try { await api('/kitchen/stations', { method: 'POST', body: { name, outlet_only: canScope && outletOnly } }); setName(''); load(); } catch (caught) { setError(caught.message); }
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
              <span key={s.station_id} className="inline-flex items-center gap-2 rounded-lg border border-line-strong px-3 py-1 text-sm text-ink-900">
                {s.name} <span className="text-xs text-ink-400">{s.outlet_name ? `${s.outlet_name} only · ` : ''}{s.dishes} dishes</span>
                <button type="button" aria-label={`Remove ${s.name}`} onClick={() => removeStation(s)} className="text-ink-400 hover:text-danger">✕</button>
              </span>
            ))}
            {stations.length === 0 && <span className="text-sm text-ink-500">No stations yet — one screen shows everything. Add stations like Tandoor, Curry or Cold to split the work.</span>}
          </div>
          <form onSubmit={addStation} className="mt-3 flex max-w-sm gap-2"><Input placeholder="New station, e.g. Tandoor" value={name} onChange={(e) => setName(e.target.value)} /><Button type="submit" size="sm" variant="secondary">Add</Button></form>
          {canScope && <label className="mt-2 flex items-center gap-2 text-xs text-ink-600"><input type="checkbox" checked={outletOnly} onChange={(e) => setOutletOnly(e.target.checked)} /> Only for this outlet (otherwise every outlet has it). A dish sent to "Grill" is cooked at the Grill of the outlet it was ordered at.</label>}
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
  const [showServed, setShowServed] = useState(false);
  const [station, setStation] = useState('all');
  const [focusKey, setFocusKey] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [setup, setSetup] = useState(false);
  const [sound, setSound] = useState(() => getDevicePrefs().kitchenSound);
  const [undo, setUndo] = useState(null);
  const undoTimer = useRef(null);
  const seen = useRef(null);
  const makingHead = useRef(null);
  const readyHead = useRef(null);
  const scrollTo = (ref) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const [full, setFull] = useState(false);
  useEffect(() => { const on = () => setFull(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', on); return () => document.removeEventListener('fullscreenchange', on); }, []);
  const toggleFull = () => { const p = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.(); p?.catch?.(() => {}); };

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
    return () => { clearInterval(poll); clearInterval(tick); clearTimeout(undoTimer.current); };
  }, []);

  const [makingTab, readyTab, servedTab] = TABS;
  const stationName = useMemo(() => new Map((data?.stations || []).filter((s) => typeof s.station_id === 'number').map((s) => [s.station_id, s.name])), [data]);
  const inStation = (i) => station === 'all' || (station === 'none' ? i.station_id == null : i.station_id === Number(station));
  // this station's share of every ticket
  const scoped = useMemo(() => (data ? data.tickets.map((t) => ({ ...t, items: t.items.filter(inStation) })).filter((t) => t.items.length) : []), [data, station]); // eslint-disable-line react-hooks/exhaustive-deps
  const has = (t, statuses) => t.items.some((i) => statuses.includes(i.status));
  // Both stages shown together, always — a cook glances at one screen instead of tapping between tabs.
  // "To make" also carries a cancelled-only ticket (nothing left to cook, but the "don't make this" notice still matters).
  const makingTickets = scoped.filter((t) => t.items.some((i) => i.status === 'PREPARING' || i.cancelled));
  const readyTickets = scoped.filter((t) => has(t, ['READY']));
  const servedTickets = scoped.filter((t) => has(t, ['SERVED']));

  const toMake = scoped.filter((t) => has(t, ['PREPARING']));
  const makingItems = toMake.flatMap((t) => t.items.filter((i) => i.status === 'PREPARING'));
  const lateTickets = toMake.filter((t) => t.items.some((i) => i.status === 'PREPARING' && urgencyOf(minutesSince(i.sent_at, now), i.expected_minutes) === 'late')).length;
  const oldest = makingItems.length ? Math.max(...makingItems.map((i) => minutesSince(i.sent_at, now))) : 0;
  const longestWait = Math.max(0, ...readyTickets.flatMap((t) => t.items.filter((i) => i.status === 'READY').map((i) => minutesSince(i.ready_at || i.sent_at, now))));
  const count = { making: toMake.length, ready: readyTickets.length, served: servedTickets.length };

  const cookNow = useMemo(() => {
    const rows = new Map();
    for (const t of toMake) for (const i of t.items) {
      if (i.status !== 'PREPARING') continue;
      const key = dishKey(i);
      const row = rows.get(key) || { key, name: i.description, extra: (i.modifiers || []).map((m) => m.name).join(' · '), qty: 0, orders: new Set(), late: 0 };
      row.qty += i.quantity; row.orders.add(t.order_id);
      if (urgencyOf(minutesSince(i.sent_at, now), i.expected_minutes) === 'late') row.late += i.quantity;
      rows.set(key, row);
    }
    return [...rows.values()].map((r) => ({ ...r, tickets: r.orders.size })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  }, [scoped, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const focus = cookNow.some((r) => r.key === focusKey) ? focusKey : null;

  const advance = async (items, status, label) => {
    const from = items[0].status;
    try {
      await api('/kitchen/advance', { method: 'POST', body: { item_ids: items.map((i) => i.order_item_id), status } });
      clearTimeout(undoTimer.current);
      setUndo({ label, items, from });
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
      load();
    } catch (caught) { setError(caught.message); }
  };
  const undoLast = async () => {
    const last = undo; setUndo(null); clearTimeout(undoTimer.current);
    try { await api('/kitchen/advance', { method: 'POST', body: { item_ids: last.items.map((i) => i.order_item_id), status: last.from } }); load(); }
    catch (caught) { setError(caught.message); }
  };
  const rush = async (ticket) => {
    try { await api(`/kitchen/orders/${ticket.order_id}/rush`, { method: 'POST' }); toast.success(`${ticket.table_name || ticket.order_number} marked rush`); load(); }
    catch (caught) { setError(caught.message); }
  };


  return (
    <div className={full ? 'fixed inset-0 z-[60] overflow-y-auto bg-page p-4 sm:p-6' : ''}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h3 font-semibold text-ink-900">Kitchen</h1>
          <p className="text-small text-ink-500">Tap a dish when it is ready, or the whole ticket at once. Oldest first; rush on top.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={toggleSound} aria-pressed={sound}>{sound ? <Bell aria-hidden="true" className="h-4 w-4" /> : <BellOff aria-hidden="true" className="h-4 w-4 text-danger" />}{sound ? 'Sound on' : 'Sound off'}</Button>
          {!full && <Button variant="ghost" to="/app/kitchen/performance">Performance</Button>}
          {!full && <Button variant="ghost" onClick={() => setSetup(true)}>Stations</Button>}
          {!full && <Button variant="ghost" to="/app/kitchen/board">Order board</Button>}
          <Button variant="secondary" className="max-sm:hidden" onClick={toggleFull} aria-label={full ? 'Leave full screen' : 'Full screen'}>{full ? <Minimize2 aria-hidden="true" className="h-4 w-4" /> : <Maximize2 aria-hidden="true" className="h-4 w-4" />}<span className="hidden sm:inline">{full ? 'Exit full screen' : 'Full screen'}</span></Button>
        </div>
      </div>

      {data && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="To make" value={count.making} note={makingItems.length ? `${makingItems.reduce((n, i) => n + i.quantity, 0)} dishes` : 'All clear'} onClick={() => scrollTo(makingHead)} />
          <Stat label="Late" value={lateTickets} tone={lateTickets ? 'text-danger' : 'text-success'} note={lateTickets ? `${lateTickets === 1 ? 'ticket is' : 'tickets are'} past time` : 'Nothing late'} onClick={() => scrollTo(makingHead)} />
          <Stat label="Oldest ticket" value={<Minutes value={oldest} />} note={makingItems.length ? 'since it was sent' : 'No tickets'} tone={lateTickets ? 'text-danger' : 'text-ink-900'} />
          <Stat label="Ready, waiting" value={count.ready} tone={longestWait >= 5 ? 'text-warning' : 'text-ink-900'} note={count.ready ? `longest ${longestWait} min` : 'Nothing waiting'} onClick={() => scrollTo(readyHead)} />
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        {data?.stations.length > 1 && (
          <div role="group" aria-label="Station" className="flex flex-wrap gap-1.5">
            {data.stations.map((st) => {
              const key = st.station_id === null ? 'none' : String(st.station_id);
              return (
                <button key={key} type="button" onClick={() => setStation(key)} aria-pressed={station === key}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-small font-medium ${station === key ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400'}`}>
                  {st.name}
                  {st.making > 0 && <span className={`tabular rounded px-1.5 text-caption font-semibold ${st.late ? 'bg-danger text-white' : 'bg-surface-3 text-ink-700'}`} title={st.late ? `${st.making} to make, ${st.late} late` : `${st.making} to make`}>{st.making}</span>}
                </button>
              );
            })}
          </div>
        )}
        <button type="button" onClick={() => setShowServed((v) => !v)} aria-pressed={showServed}
                className={`ml-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-small font-medium ${showServed ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400'}`}>
          {showServed ? 'Hide served' : 'Show served'}
          {count.served > 0 && <span className={`tabular rounded px-1.5 text-caption ${showServed ? 'bg-brand-100' : 'bg-surface-3'}`}>{count.served}</span>}
        </button>
      </div>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {!data && !error && <SkeletonRows rows={3} columns={3} />}

      {data && (
        <div className={cookNow.length ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_280px] xl:gap-5' : ''}>
          <div>
            <CookNow rows={cookNow} focusKey={focus} onFocus={setFocusKey} compact />

            {/* One screen, not two tabs: a cook sees what to cook and what's waiting to go out at the same glance. */}
            <div className="grid gap-5 lg:grid-cols-2">
              <section>
                <ColumnHeader innerRef={makingHead} label="To make" count={count.making} late={lateTickets} />
                {makingTickets.length === 0 ? (
                  <EmptyColumn title="Nothing to cook right now" lead="New orders appear here the moment they are sent, with a beep if sound is on." />
                ) : (
                  <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
                    {makingTickets.map((t) => (
                      <Ticket key={t.order_id} ticket={t} tab={makingTab} now={now} stationName={station === 'all' && stationName.size ? stationName : null}
                              focusKey={focus} dimmed={focus && !t.items.some((i) => i.status === 'PREPARING' && dishKey(i) === focus)}
                              onAdvance={advance} onRush={rush} />
                    ))}
                  </div>
                )}
              </section>

              <section>
                <ColumnHeader innerRef={readyHead} label="Ready to serve" count={count.ready} />
                {readyTickets.length === 0 ? (
                  <EmptyColumn title="Nothing waiting to go out" lead="Dishes you mark ready wait here until they are served or handed over." />
                ) : (
                  <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
                    {readyTickets.map((t) => (
                      <Ticket key={t.order_id} ticket={t} tab={readyTab} now={now} stationName={station === 'all' && stationName.size ? stationName : null}
                              onAdvance={advance} onRush={rush} />
                    ))}
                  </div>
                )}
              </section>
            </div>

            {showServed && (
              <section className="mt-5">
                <ColumnHeader label="Served" count={count.served} />
                {servedTickets.length === 0 ? (
                  <EmptyColumn title="Nothing served yet" lead="Tickets served in the last two hours show here." />
                ) : (
                  <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
                    {servedTickets.map((t) => (
                      <Ticket key={t.order_id} ticket={t} tab={servedTab} now={now} stationName={station === 'all' && stationName.size ? stationName : null}
                              onAdvance={advance} onRush={rush} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
          <CookNow rows={cookNow} focusKey={focus} onFocus={setFocusKey} />
        </div>
      )}

      {undo && (
        <div role="status" className="fixed inset-x-0 bottom-5 z-[70] flex justify-center px-4">
          <div className="flex items-center gap-4 rounded-lg bg-ink-900 py-2 pl-4 pr-2 text-small text-white shadow-lg">
            <span className="flex items-center gap-2"><Check aria-hidden="true" className="h-4 w-4 text-success" />{undo.label}</span>
            <button type="button" onClick={undoLast} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold text-white hover:bg-white/10"><Undo2 aria-hidden="true" className="h-4 w-4" />Undo</button>
          </div>
        </div>
      )}

      {setup && <SetupModal onClose={() => setSetup(false)} onSaved={() => { setSetup(false); load(); }} />}
    </div>
  );
};

export default KitchenDisplay;
