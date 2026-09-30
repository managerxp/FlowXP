/*
 * The floor: every table at a glance, grouped by area, and the way into its
 * order. Occupancy is never a separate flag here — a table's open order comes
 * straight from tables.controller.js ("does this table have a running order"),
 * so this screen cannot drift out of sync with Orders.
 *
 * Tap a free table to start its order; tap a busy one to open it (both land
 * on /app/orders?order=ID). A strip on top says how the floor is doing, and the
 * filters narrow it to free tables, busy ones, or the ones that need someone
 * (food ready, items not sent, seated 90+ minutes). Each table's details,
 * waiter, QR code (the link a guest scans to order, see public/CustomerMenu.jsx),
 * cleaning state and removal are behind its settings button. QR stand cards
 * print for one table or all of them.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { CalendarClock, Clock, Printer, QrCode, Settings2, Sparkles, Users } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Button, Field, Input, Modal, Select, useToast } from '../components/ui.jsx';

const POLL_MS = 20000;
const LONG_MIN = 90;
const minutesSince = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
const age = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
const short = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const qrLink = (t) => `${window.location.origin}/order/${t.qr_token}`;
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

/* What a table is doing right now, in one word the floor filters on. */
const stateOf = (t) => {
  if (t.open_order_id) {
    const o = t.open_order;
    return o.ready > 0 || o.not_sent > 0 || minutesSince(o.opened_at) >= LONG_MIN ? 'attention' : 'busy';
  }
  if (t.status === 'CLEANING') return 'cleaning';
  if (t.next_reservation) return 'booked';
  return 'free';
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'free', label: 'Free', dot: 'bg-success', test: (s) => s === 'free' },
  { key: 'busy', label: 'Occupied', dot: 'bg-brand-500', test: (s) => s === 'busy' || s === 'attention' },
  { key: 'attention', label: 'Needs attention', dot: 'bg-danger', test: (s) => s === 'attention' },
  { key: 'booked', label: 'Booked soon', dot: 'bg-warning', test: (s) => s === 'booked' },
  { key: 'cleaning', label: 'Being cleaned', dot: 'bg-ink-400', test: (s) => s === 'cleaning' }
];

/* Stand cards: the table name, "scan to order" and its QR, one per table, from the browser's print dialog. */
const printQrCards = async (list, businessName) => {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write('<p style="font-family:sans-serif;padding:24px">Preparing QR cards…</p>');
  const cards = await Promise.all(list.map(async (t) => ({ t, src: await QRCode.toDataURL(qrLink(t), { width: 480, margin: 1 }) })));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  w.document.open();
  w.document.write(`<!doctype html><html><head><title>QR cards</title><style>
    body{font-family:system-ui,sans-serif;margin:0;color:#011531}
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12mm;padding:12mm}
    .card{border:1.5px solid #011531;border-radius:6mm;padding:8mm;text-align:center;break-inside:avoid}
    .biz{font-size:13pt;font-weight:600;margin:0}.name{font-size:30pt;font-weight:800;margin:2mm 0}
    img{width:55mm;height:55mm}.hint{font-size:11pt;margin:3mm 0 0}.sub{font-size:9pt;color:#555;margin:1mm 0 0}
  </style></head><body><div class="grid">${cards.map(({ t, src }) => `<div class="card"><p class="biz">${esc(businessName)}</p><p class="name">${esc(t.name)}</p><img src="${src}" alt=""><p class="hint">Scan to see the menu and order</p><p class="sub">No app needed. Your order goes straight to the kitchen.</p></div>`).join('')}</div>
  <script>window.onload=()=>{window.focus();window.print();}</script></body></html>`);
  w.document.close();
  return true;
};

const TableForm = ({ initial = {}, submitLabel, busy, onSubmit }) => {
  const [name, setName] = useState(initial.name || '');
  const [zone, setZone] = useState(initial.zone || '');
  const [seats, setSeats] = useState(initial.seats ?? '');
  const [zones] = useState(initial.zones || []);
  const dirty = name !== (initial.name || '') || zone !== (initial.zone || '') || String(seats) !== String(initial.seats ?? '');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name, zone, seats: seats === '' ? null : Number(seats) }); }} className="space-y-4">
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <Field id="table-name" label="Name or number"><Input id="table-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. T9" autoFocus={!initial.name} /></Field>
        <Field id="table-seats" label="Seats"><Input id="table-seats" type="number" min="1" max="99" value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="4" /></Field>
      </div>
      <Field id="table-zone" label="Area" hint="Tables are grouped by area on the floor, e.g. Indoor, Patio, Rooftop.">
        <Input id="table-zone" list="table-zones" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="e.g. Patio" />
        <datalist id="table-zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
      </Field>
      <Button type="submit" disabled={busy || (initial.name && !dirty)} className="w-full">{busy ? 'Saving…' : submitLabel}</Button>
    </form>
  );
};

const AddTableModal = ({ zones, onClose, onCreated }) => {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async ({ name, zone, seats }) => {
    if (!name.trim()) { setError('Enter a table name or number'); return; }
    setBusy(true); setError('');
    try { onCreated(await api('/tables', { method: 'POST', body: { name, zone: zone || null, seats } })); }
    catch (caught) { setError(caught.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a table" onClose={onClose}>
      <div className="space-y-4"><Alert>{error}</Alert><TableForm initial={{ zones }} submitLabel="Add table" busy={busy} onSubmit={create} /></div>
    </Modal>
  );
};

/* A table's settings: details, regular waiter, QR code, cleaning, removal. */
const TableSettings = ({ table, zones, waiters, businessName, onClose, onSaved }) => {
  const toast = useToast();
  const [dataUrl, setDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const link = qrLink(table);
  const occupied = Boolean(table.open_order_id);
  useEffect(() => { QRCode.toDataURL(link, { width: 320, margin: 1 }).then(setDataUrl); }, [link]);

  const patch = async (body, done) => {
    setBusy(true); setError('');
    try { await api(`/tables/${table.table_id}`, { method: 'PATCH', body }); onSaved(); if (done) toast.success(done); return true; }
    catch (caught) { setError(caught.message); return false; }
    finally { setBusy(false); }
  };
  const copy = async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const remove = async () => {
    if (!window.confirm(`Remove ${table.name}? It leaves the floor and its QR code stops working. Past bills keep their table name.`)) return;
    if (await patch({ status: 'CLOSED' }, `${table.name} removed`)) onClose();
  };

  return (
    <Modal title={`${table.name}${table.zone ? ` · ${table.zone}` : ''}`} onClose={onClose}>
      <div className="space-y-6">
        <Alert>{error}</Alert>

        <section>
          <h3 className="mb-3 text-small font-semibold text-ink-900">Details</h3>
          <TableForm key={`${table.name}|${table.zone}|${table.seats}`} initial={{ name: table.name, zone: table.zone, seats: table.seats, zones }} submitLabel="Save details" busy={busy}
                     onSubmit={({ name, zone, seats }) => patch({ name, zone: zone || null, seats }, 'Table saved')} />
        </section>

        <section className="border-t border-line pt-5">
          <Field id="table-waiter" label="Regular waiter" hint="New orders on this table go to them.">
            <Select id="table-waiter" value={table.waiter_user_id || ''} onChange={(e) => patch({ waiter_user_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No regular waiter</option>
              {waiters.map((w) => <option key={w.user_id} value={w.user_id}>{w.name}</option>)}
            </Select>
          </Field>
        </section>

        <section className="border-t border-line pt-5">
          <h3 className="text-small font-semibold text-ink-900">Order-from-table QR</h3>
          <p className="mt-0.5 text-caption text-ink-500">Guests scan it to see the menu and order from their phone. Print it and stand it on the table.</p>
          <div className="mt-3 flex items-center gap-4">
            {dataUrl ? <img src={dataUrl} alt={`QR code to order from ${table.name}`} className="h-32 w-32 rounded-lg border border-line" /> : <div className="h-32 w-32 animate-pulse rounded-lg bg-surface-3" />}
            <div className="flex flex-1 flex-col gap-2">
              <Button size="sm" onClick={() => printQrCards([table], businessName)}><Printer aria-hidden="true" className="h-4 w-4" />Print stand card</Button>
              {dataUrl && <Button size="sm" variant="secondary" href={dataUrl} download={`table-${table.name}-qr.png`}>Download QR</Button>}
              <Button variant="secondary" size="sm" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</Button>
            </div>
          </div>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          {!occupied && (table.status === 'CLEANING'
            ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => patch({ status: 'FREE' }, `${table.name} is ready for guests`)}><Sparkles aria-hidden="true" className="h-4 w-4" />Ready for guests</Button>
            : <Button variant="secondary" size="sm" disabled={busy} onClick={() => patch({ status: 'CLEANING' }, `${table.name} marked being cleaned`)}>Mark being cleaned</Button>)}
          {occupied
            ? <p className="text-caption text-ink-500">This table has a running order, so it can't be removed now.</p>
            : <button type="button" onClick={remove} disabled={busy} className="text-small font-medium text-danger hover:underline disabled:opacity-50">Remove table</button>}
        </section>
      </div>
    </Modal>
  );
};

/* One table on the floor. Every state reads in words as well as colour. */
const TableTile = ({ table, onOpen, onSettings, onClean, starting }) => {
  const o = table.open_order;
  const state = stateOf(table);
  const busy = Boolean(table.open_order_id);
  const mins = busy ? minutesSince(o.opened_at) : 0;
  const long = mins >= LONG_MIN;
  const lines = busy ? o.not_sent + o.cooking + o.ready : 0;

  const look = {
    free: 'border-line bg-surface hover:border-success',
    busy: 'border-brand-500/30 bg-brand-50 hover:border-brand-500',
    attention: 'border-brand-500/30 bg-brand-50 hover:border-brand-500',
    booked: 'border-warning/40 bg-warning/5 hover:border-warning',
    cleaning: 'border-dashed border-line-strong bg-surface-2 hover:border-ink-400'
  }[state];
  const stripe = { free: 'bg-success', busy: 'bg-brand-500', attention: long ? 'bg-danger' : 'bg-brand-500', booked: 'bg-warning', cleaning: 'bg-ink-400' }[state];

  return (
    <div className={`group relative flex min-h-[148px] flex-col overflow-hidden rounded-(--radius-card) border shadow-sm transition-colors duration-(--duration-fast) ${look}`}>
      <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${stripe}`} />
      <button type="button" onClick={onOpen} disabled={starting}
              aria-label={busy ? `Open ${table.name}, ${o.items} items, ${formatCurrency(o.estimate)}` : `Start an order on ${table.name}`}
              className="flex flex-1 flex-col p-4 pt-4.5 text-left disabled:opacity-60">
        <span className="flex items-center gap-2 pr-8">
          <span className="text-[22px] font-bold leading-none tracking-tight text-ink-900">{table.name}</span>
          {table.seats && <span className="flex items-center gap-1 rounded-md bg-surface-3/70 px-1.5 py-0.5 text-caption text-ink-700"><Users aria-hidden="true" className="h-3 w-3" />{table.seats}</span>}
        </span>

        {busy ? (
          <span className="mt-auto block pt-3">
            <span className="flex items-center justify-between gap-2 text-caption">
              <span className="tabular text-body font-bold text-ink-900">{formatCurrency(o.estimate)}</span>
              <span className={`tabular flex shrink-0 items-center gap-1 whitespace-nowrap ${long ? 'font-semibold text-danger' : 'text-ink-500'}`}><Clock aria-hidden="true" className="h-3 w-3" />{short(mins)}</span>
            </span>
            <span className="mt-0.5 block text-caption text-ink-500">{o.items} item{o.items === 1 ? '' : 's'}{table.waiter_name ? ` · ${table.waiter_name}` : ''}</span>
            {lines > 0 && (
              <span className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                {o.not_sent > 0 && <span className="bg-warning" style={{ flex: o.not_sent }} />}
                {o.cooking > 0 && <span className="bg-brand-400" style={{ flex: o.cooking }} />}
                {o.ready > 0 && <span className="bg-success" style={{ flex: o.ready }} />}
              </span>
            )}
            <span className="mt-1.5 block text-caption font-semibold">
              {o.ready > 0 ? <span className="text-success">{o.ready} ready to serve</span>
                : o.not_sent > 0 ? <span className="text-warning">{o.not_sent} not sent to the kitchen</span>
                : o.cooking > 0 ? <span className="font-medium text-ink-700">{o.cooking} cooking</span>
                : long ? <span className="text-danger">Seated {age(mins)}. Offer the bill?</span>
                : <span className="font-medium text-ink-500">Nothing ordered yet</span>}
            </span>
          </span>
        ) : state === 'booked' ? (
          <span className="mt-auto block pt-3 text-caption">
            <span className="flex items-center gap-1 font-semibold text-warning"><CalendarClock aria-hidden="true" className="h-3.5 w-3.5" />Booked {clock(table.next_reservation.reserved_at)}</span>
            <span className="block text-ink-500">{table.next_reservation.guest_name} · {table.next_reservation.party_size} people</span>
          </span>
        ) : state === 'cleaning' ? (
          <span className="mt-auto block pt-3 text-caption"><span className="font-semibold text-ink-700">Being cleaned</span></span>
        ) : (
          <span className="mt-auto block pt-3 text-caption">
            <span className="flex items-center gap-1.5 font-semibold text-success"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-success" />Free</span>
            <span className="block text-ink-500">{table.waiter_name ? `${table.waiter_name}'s table · tap to seat` : 'Tap to seat guests'}</span>
          </span>
        )}
      </button>
      {state === 'cleaning' && (
        <button type="button" onClick={onClean} className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md border border-line-strong bg-surface px-2 py-1 text-caption font-semibold text-ink-700 hover:border-success hover:text-success">
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />Ready
        </button>
      )}
      {busy && table.waiter_name && (
        <span aria-hidden="true" title={table.waiter_name} className="absolute right-11 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-surface text-[10px] font-bold text-ink-700 ring-1 ring-line">{initials(table.waiter_name)}</span>
      )}
      <button type="button" onClick={onSettings} aria-label={`${table.name} settings and QR code`}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-surface hover:text-ink-700">
        <Settings2 className="h-4 w-4" />
      </button>
    </div>
  );
};

const Stat = ({ label, value, note, tone = 'text-ink-900', className = '' }) => (
  <div className={`rounded-(--radius-card) border border-line bg-surface px-4 py-3 ${className}`}>
    <p className="text-caption font-medium text-ink-500">{label}</p>
    <p className={`tabular mt-1 text-[24px] font-bold leading-none ${tone}`}>{value}</p>
    {note && <p className="mt-1 truncate text-caption text-ink-500">{note}</p>}
  </div>
);

const TablesPage = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const [tables, setTables] = useState(null);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [settingsFor, setSettingsFor] = useState(null);
  const [starting, setStarting] = useState(null);
  const { user, business, outletId } = useAuth();
  const me = user?.user_id ?? user?.id;
  const [waiters, setWaiters] = useState([]);
  const [mineOnly, setMineOnly] = useState(false);
  const [filter, setFilter] = useState('all');
  const [zone, setZone] = useState('all');

  const load = () => api('/tables').then((rows) => { setTables(rows); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); const t = setInterval(load, POLL_MS); return () => clearInterval(t); }, []);
  useEffect(() => { api('/tables/waiters').then(setWaiters).catch(() => setWaiters([])); }, [outletId]);

  const setClean = async (t) => {
    try { await api(`/tables/${t.table_id}`, { method: 'PATCH', body: { status: 'FREE' } }); toast.success(`${t.name} is ready for guests`); load(); }
    catch (caught) { toast.error(caught.message); }
  };

  const openTable = async (t) => {
    if (t.open_order_id) { navigate(`/app/orders?order=${t.open_order_id}`); return; }
    if (t.next_reservation && !window.confirm(`${t.name} is booked for ${t.next_reservation.guest_name} at ${clock(t.next_reservation.reserved_at)}. Seat other guests anyway?`)) return;
    if (t.status === 'CLEANING' && !window.confirm(`${t.name} is being cleaned. Seat guests now?`)) return;
    setStarting(t.table_id);
    try {
      if (t.status === 'CLEANING') await api(`/tables/${t.table_id}`, { method: 'PATCH', body: { status: 'FREE' } });
      const order = await api('/orders', { method: 'POST', body: { order_type: 'DINE_IN', table_id: t.table_id } });
      navigate(`/app/orders?order=${order.order_id}`);
    } catch (caught) { toast.error(caught.message); load(); }
    finally { setStarting(null); }
  };

  const all = tables || [];
  const zoneNames = useMemo(() => [...new Set(all.map((t) => t.zone || 'Tables'))], [all]);
  const mine = mineOnly ? all.filter((t) => t.waiter_user_id === me) : all;
  const test = FILTERS.find((f) => f.key === filter)?.test;
  const shown = mine.filter((t) => (zone === 'all' || (t.zone || 'Tables') === zone) && (!test || test(stateOf(t))));
  const zones = useMemo(() => {
    const map = new Map();
    for (const t of shown) { const z = t.zone || 'Tables'; if (!map.has(z)) map.set(z, []); map.get(z).push(t); }
    return [...map.entries()];
  }, [shown]);

  // the strip counts the floor (or my tables), not the filter
  const states = mine.map(stateOf);
  const count = Object.fromEntries(FILTERS.map((f) => [f.key, f.test ? states.filter(f.test).length : mine.length]));
  const busyTables = mine.filter((t) => t.open_order_id);
  const onFloor = busyTables.reduce((s, t) => s + Number(t.open_order.estimate || 0), 0);
  const seatsFree = mine.filter((t) => stateOf(t) === 'free').reduce((s, t) => s + (t.seats || 0), 0);
  const ready = busyTables.reduce((s, t) => s + t.open_order.ready, 0);
  const longest = busyTables.length ? Math.max(...busyTables.map((t) => minutesSince(t.open_order.opened_at))) : 0;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h3 font-semibold text-ink-900">Tables</h1>
          <p className="mt-1 text-small text-ink-500">Tap a free table to seat guests, or a busy one to open its order.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" to="/app/reservations"><CalendarClock aria-hidden="true" className="h-4 w-4" />Reservations</Button>
          {all.length > 0 && <Button variant="secondary" onClick={async () => { if (!(await printQrCards(all, business?.name))) toast.error('Allow pop-ups to print the QR cards'); }}><Printer aria-hidden="true" className="h-4 w-4" />Print QR cards</Button>}
          <Button onClick={() => setShowAdd(true)}>Add table</Button>
        </div>
      </div>

      {tables && all.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Stat label="Free tables" value={<>{count.free}<span className="text-small font-medium text-ink-400"> of {mine.length}</span></>} tone="text-success" note={seatsFree ? `${seatsFree} seats free` : 'No seats free'} />
          <Stat label="Occupied" value={count.busy} tone="text-brand-700" note={count.attention ? `${count.attention} need attention` : 'All going well'} />
          <Stat label="Running bills" value={formatCurrency(onFloor)} note={busyTables.length ? 'on the floor, with GST' : 'No open bills'} />
          <Stat label="Ready to serve" value={ready} tone={ready ? 'text-success' : 'text-ink-900'} note={ready ? 'waiting at the pass' : 'Nothing waiting'} />
          <Stat className="col-span-2 md:col-span-1" label="Seated longest" value={busyTables.length ? age(longest) : '–'} tone={longest >= LONG_MIN ? 'text-danger' : 'text-ink-900'} note={longest >= LONG_MIN ? 'maybe offer the bill' : busyTables.length ? 'since the order opened' : 'No one seated'} />
        </div>
      )}

      {tables && all.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
            {FILTERS.filter((f) => f.key === 'all' || f.key === filter || count[f.key] > 0).map((f) => (
              <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-small font-medium transition-colors duration-(--duration-fast) ${filter === f.key ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400'}`}>
                {f.dot && <span aria-hidden="true" className={`h-2 w-2 rounded-full ${f.dot}`} />}
                {f.label}
                <span className={`tabular text-caption ${filter === f.key ? 'text-white/70' : 'text-ink-400'}`}>{count[f.key]}</span>
              </button>
            ))}
          </div>
          {zoneNames.length > 1 && (
            <Select aria-label="Area" value={zone} onChange={(e) => setZone(e.target.value)} className="w-auto! py-1.5!">
              <option value="all">All areas</option>
              {zoneNames.map((z) => <option key={z} value={z}>{z}</option>)}
            </Select>
          )}
          {all.some((t) => t.waiter_user_id) && (
            <label className="ml-auto flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-small text-ink-700">
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" /> My tables
            </label>
          )}
        </div>
      )}

      <Alert>{error}</Alert>
      {!tables && !error && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="h-[148px] animate-pulse rounded-(--radius-card) bg-surface-3" />)}</div>}
      {tables?.length === 0 && (
        <div className="rounded-(--radius-card) border border-dashed border-line-strong bg-surface p-10 text-center">
          <QrCode aria-hidden="true" className="mx-auto h-8 w-8 text-ink-400" />
          <p className="mt-3 text-body font-medium text-ink-900">No tables yet</p>
          <p className="mt-1 text-small text-ink-500">Add your tables to take dine-in orders and give each one its own order-from-table QR.</p>
          <Button className="mt-4" onClick={() => setShowAdd(true)}>Add the first table</Button>
        </div>
      )}
      {tables?.length > 0 && shown.length === 0 && (
        <div className="rounded-(--radius-card) border border-dashed border-line-strong bg-surface p-8 text-center">
          <p className="text-body font-medium text-ink-900">No tables match</p>
          <button type="button" onClick={() => { setFilter('all'); setZone('all'); setMineOnly(false); }} className="mt-2 text-small font-medium text-brand-600 hover:underline">Show every table</button>
        </div>
      )}

      <div className="space-y-8">
        {zones.map(([name, list]) => (
          <section key={name} aria-label={name}>
            {(zoneNames.length > 1 || zones.length > 1) && (
              <h2 className="mb-3 flex items-baseline gap-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">
                {name} <span className="tabular font-normal normal-case tracking-normal">{list.filter((t) => stateOf(t) === 'free').length} of {list.length} free</span>
              </h2>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {list.map((t) => <TableTile key={t.table_id} table={t} starting={starting === t.table_id} onOpen={() => openTable(t)} onSettings={() => setSettingsFor(t)} onClean={() => setClean(t)} />)}
            </div>
          </section>
        ))}
      </div>

      {showAdd && <AddTableModal zones={zoneNames.filter((z) => z !== 'Tables')} onClose={() => setShowAdd(false)} onCreated={(t) => { setShowAdd(false); toast.success(`${t.name} added`); load(); }} />}
      {settingsFor && tables.find((t) => t.table_id === settingsFor.table_id) && (
        <TableSettings table={tables.find((t) => t.table_id === settingsFor.table_id)} zones={zoneNames.filter((z) => z !== 'Tables')} waiters={waiters} businessName={business?.name}
                       onClose={() => setSettingsFor(null)} onSaved={load} />
      )}
    </div>
  );
};

export default TablesPage;
