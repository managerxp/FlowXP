/*
 * The order-ready board: a screen for a TV or tablet near the pickup counter,
 * so a customer sees their own order number move from "Preparing" to "Ready
 * to collect" without asking anyone. Built for the café/counter flow (design.md
 * §31 follow-on): a counter sale or takeaway order gets a token — its normal
 * order number, e.g. ORD-0052 — the moment it is sent to the kitchen, and this
 * board is just another read of the same /kitchen/tickets the Kitchen screen
 * already polls, filtered to orders a customer collects rather than a table a
 * waiter serves. Tapping a ready ticket marks it handed over, the same action
 * as the Kitchen screen's Ready tab, so this can also run the pickup counter
 * itself rather than only being watched.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChefHat, Maximize2, Minimize2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { beep, getDevicePrefs, setDevicePref } from '../lib/printing.js';
import BellToggle from '../components/BellToggle.jsx';
import { Alert, Button, humanize } from '../components/ui.jsx';

const POLL_MS = 8000;
const minutesSince = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));

/* A ticket belongs on this board only if someone collects it in person —
   a table is served where it sits, so dine-in never appears here. */
const isCounterOrder = (t) => t.order_type !== 'DINE_IN';

const Token = ({ ticket, ready, onCollect }) => {
  const kind = ticket.platform ? humanize(ticket.platform) : ticket.order_type === 'DELIVERY' ? 'Delivery' : 'Takeaway';
  const waited = minutesSince(ticket.sent_at);
  return (
    <li className={`overflow-hidden rounded-(--radius-card) border shadow-sm ${ready ? 'border-success/40 bg-success/5' : 'border-line bg-surface'}`}>
      {ready ? (
        <button type="button" onClick={() => onCollect(ticket)} className="flex w-full flex-col items-center px-3 py-6 text-center hover:bg-success/10">
          <span className="tabular whitespace-nowrap text-[28px] font-extrabold leading-none tracking-tight text-ink-900 sm:text-[36px]">{ticket.order_number}</span>
          <span className="mt-2 rounded-md bg-surface-3 px-2 py-0.5 text-caption font-semibold text-ink-700">{kind}</span>
          <span className="mt-3 flex items-center gap-1.5 text-small font-semibold text-success"><CheckCircle2 aria-hidden="true" className="h-4 w-4" />Tap when collected</span>
        </button>
      ) : (
        <div className="flex flex-col items-center px-3 py-6 text-center">
          <span className="tabular whitespace-nowrap text-[28px] font-extrabold leading-none tracking-tight text-ink-400 sm:text-[36px]">{ticket.order_number}</span>
          <span className="mt-2 rounded-md bg-surface-3 px-2 py-0.5 text-caption font-semibold text-ink-700">{kind}</span>
          <span className="tabular mt-3 text-small text-ink-500">{waited <= 1 ? 'Just started' : `${waited} min`}</span>
        </div>
      )}
    </li>
  );
};

const Column = ({ title, tone, tickets, ready, onCollect, empty }) => (
  <section aria-label={title} className="flex min-h-0 flex-1 flex-col">
    <h2 className={`mb-3 flex items-center gap-2 text-title font-bold ${tone}`}>
      {title} <span className="tabular rounded-full bg-surface-3 px-2.5 py-0.5 text-body font-semibold text-ink-700">{tickets.length}</span>
    </h2>
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {tickets.length === 0 ? (
        <p className="py-10 text-center text-body text-ink-400">{empty}</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {tickets.map((t) => <Token key={t.order_id} ticket={t} ready={ready} onCollect={onCollect} />)}
        </ul>
      )}
    </div>
  </section>
);

const OrderReadyBoard = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sound, setSound] = useState(() => getDevicePrefs().kitchenSound);
  const [full, setFull] = useState(false);
  const seenReady = useRef(null);

  useEffect(() => { const on = () => setFull(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', on); return () => document.removeEventListener('fullscreenchange', on); }, []);
  const toggleFull = () => { const p = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.(); p?.catch?.(() => {}); };
  const toggleSound = () => { const next = !sound; setSound(next); setDevicePref('kitchenSound', next); if (next) beep('new'); };

  const load = () => api('/kitchen/tickets').then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); const t = setInterval(load, POLL_MS); return () => clearInterval(t); }, []);

  const orders = (data?.tickets || []).filter(isCounterOrder);
  const preparing = orders.filter((t) => t.items.some((i) => i.status === 'PREPARING')).sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at));
  const ready = orders.filter((t) => !t.items.some((i) => i.status === 'PREPARING') && t.items.some((i) => i.status === 'READY')).sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at));

  // A chime the moment an order first has nothing left to do but be collected.
  useEffect(() => {
    if (!data) return;
    const ids = new Set(ready.map((t) => t.order_id));
    if (seenReady.current && sound && [...ids].some((id) => !seenReady.current.has(id))) beep('new');
    seenReady.current = ids;
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const collect = async (ticket) => {
    const items = ticket.items.filter((i) => i.status === 'READY').map((i) => i.order_item_id);
    try { await api('/kitchen/advance', { method: 'POST', body: { item_ids: items, status: 'SERVED' } }); load(); }
    catch (caught) { setError(caught.message); }
  };

  return (
    <div className={full ? 'fixed inset-0 z-[60] flex flex-col overflow-hidden bg-page p-4 sm:p-6' : 'flex min-h-[calc(100vh-7rem)] flex-col'}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h3 font-semibold text-ink-900">Order board</h1>
          <p className="text-small text-ink-500">For a screen near pickup. Customers watch their order number move across; it updates itself.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <BellToggle size="sm" label="Sound for new orders" offLabel="Sound off" onLabel="Sound on" pressed={sound} onChange={toggleSound} badge={false} background="var(--color-surface-3)" color="var(--color-ink-700)" onBackground="var(--color-brand-500)" onColor="#ffffff" />
          {!full && <Button variant="ghost" to="/app/kitchen">Back to kitchen</Button>}
          <Button variant="secondary" onClick={toggleFull} aria-label={full ? 'Leave full screen' : 'Full screen'}>{full ? <Minimize2 aria-hidden="true" className="h-4 w-4" /> : <Maximize2 aria-hidden="true" className="h-4 w-4" />}<span className="hidden sm:inline">{full ? 'Exit full screen' : 'Full screen'}</span></Button>
        </div>
      </div>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      {!data && !error ? (
        <div className="grid grid-cols-2 gap-4"><div className="h-64 animate-pulse rounded-(--radius-card) bg-surface-3" /><div className="h-64 animate-pulse rounded-(--radius-card) bg-surface-3" /></div>
      ) : orders.length === 0 && !error ? (
        <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600"><ChefHat aria-hidden="true" className="h-6 w-6" /></span>
          <p className="mt-3 text-body font-semibold text-ink-900">Nothing being collected right now</p>
          <p className="mt-1 max-w-sm text-small text-ink-500">A takeaway or counter order appears here the moment it is sent to the kitchen, until it is collected.</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
          <Column title="Preparing" tone="text-ink-700" tickets={preparing} ready={false} empty="Nothing in the kitchen right now." />
          <Column title="Ready to collect" tone="text-success" tickets={ready} ready onCollect={collect} empty="Nothing waiting to be picked up." />
        </div>
      )}
    </div>
  );
};

export default OrderReadyBoard;
