/*
 * A Zomato/Swiggy/ONDC/Magicpin order waiting to be accepted — a real floating
 * pop-up (fixed position, its own stacking layer, and DRAGGABLE — drag it by
 * its red header out of the way of whatever it's covering), not a banner
 * inside a page's own scrolling content, so it stays put and visible no
 * matter which screen the admin is on or how far they have scrolled. Mounted
 * once in AppShell. Polls every 5 seconds (cheap: only businesses with
 * delivery integrations ever have a row) and rings a loud, repeating alarm
 * (see lib/printing.js ringAlarm — deliberately louder than the Kitchen
 * screen's quiet beep, which was easy to miss) until every pending order is
 * accepted or rejected. Shows the full order — every item, quantity, the
 * diner's name and the platform's own order number — right here, so a
 * missing ingredient or a closing kitchen can be judged without leaving
 * whatever the admin was doing. Accept sends it to the kitchen the same way
 * pressing "Send to kitchen" does; reject never touches it.
 */
import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, ChefHat, GripHorizontal } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { getDevicePrefs, ringAlarm, setDevicePref } from '../lib/printing.js';
import { platformName } from '../lib/business.js';
import { Button, useToast } from './ui.jsx';

const POLL_MS = 5000;
const RING_EVERY_MS = 3500;
const minutesSince = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));

/* Its own drag offset, so dragging one pending order's card never moves another's. Position resets
   when the order it's showing changes (a fresh card for a fresh order starts back at the default spot). */
const OrderPopup = ({ order, busy, onAccept, onReject }) => {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef(null);   // { startX, startY, baseX, baseY } while a drag is in progress

  const startDrag = (e) => {
    if (e.target.closest('button')) return;   // don't start a drag from a tap meant for Accept/Reject
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y };
  };
  const onDrag = (e) => {
    if (!drag.current) return;
    setPos({ x: drag.current.baseX + (e.clientX - drag.current.startX), y: drag.current.baseY + (e.clientY - drag.current.startY) });
  };
  const endDrag = (e) => { drag.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId); };

  return (
    <div role="alertdialog" aria-label={`New ${platformName(order.platform)} order`} style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
         className="pointer-events-auto w-[min(92vw,26rem)] overflow-hidden rounded-(--radius-panel) border-2 border-danger/50 bg-surface shadow-xl">
      <div onPointerDown={startDrag} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
           className="flex cursor-grab items-center gap-3 bg-danger/10 px-4 py-3 active:cursor-grabbing" title="Drag to move">
        <span className="flex h-9 w-9 shrink-0 animate-pulse items-center justify-center rounded-full bg-danger text-white"><ChefHat aria-hidden="true" className="h-4.5 w-4.5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-bold text-ink-900">New {platformName(order.platform)} order</p>
          <p className="truncate text-caption text-ink-500">
            {order.order_number}{order.external_order_number ? ` · their order ${order.external_order_number}` : ''} · {order.customer_name || 'Customer not given'}{order.customer_phone ? ` · ${order.customer_phone}` : ''} · {minutesSince(order.created_at)} min ago
          </p>
        </div>
        <GripHorizontal aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-400" />
      </div>

      <ul className="max-h-48 divide-y divide-line overflow-y-auto px-4">
        {order.items.map((i) => (
          <li key={i.order_item_id} className="flex items-start justify-between gap-3 py-2 text-small">
            <span><span className="tabular mr-1.5 font-semibold text-ink-900">{i.quantity} ×</span>{i.description}</span>
            <span className="tabular shrink-0 font-medium text-ink-700">{formatCurrency(i.quantity * i.unit_price)}</span>
          </li>
        ))}
      </ul>
      {order.notes && <p className="mx-4 mb-3 rounded-lg bg-warning/10 px-3 py-2 text-caption text-ink-900">“{order.notes}”</p>}

      <div className="flex gap-2 border-t border-line p-3">
        <Button variant="secondary" onClick={onReject} disabled={busy} className="flex-1 border-danger/40 text-danger hover:bg-danger/5">Reject</Button>
        <Button onClick={onAccept} disabled={busy} className="flex-1">{busy ? 'Working…' : 'Accept'}</Button>
      </div>
    </div>
  );
};

const IncomingDeliveryAlert = () => {
  const { business, can } = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(null);
  const [sound, setSound] = useState(() => getDevicePrefs().deliveryRingSound);
  const ringTimer = useRef(null);

  // Only restaurants/cafés ever get a delivery order, and only someone who could act on it needs to see this.
  const eligible = business && ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN', 'GAMING_CAFE', 'RACING'].includes(business.business_type) && can('billing');

  const load = () => api('/orders/pending-deliveries').then(setOrders).catch(() => {});
  useEffect(() => {
    if (!eligible) return undefined;
    load();
    const poll = setInterval(load, POLL_MS);
    return () => clearInterval(poll);
  }, [eligible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    clearInterval(ringTimer.current);
    if (!orders.length || !sound) return undefined;
    ringAlarm();
    ringTimer.current = setInterval(ringAlarm, RING_EVERY_MS);
    return () => clearInterval(ringTimer.current);
  }, [orders.length, sound]);

  const toggleSound = () => { const next = !sound; setSound(next); setDevicePref('deliveryRingSound', next); if (next) ringAlarm(); };

  const accept = async (order) => {
    setBusy(order.order_id);
    try {
      const res = await api(`/orders/${order.order_id}/accept`, { method: 'POST' });
      toast.success(`${platformName(order.platform)} order sent to the kitchen · ${res.kot_number}`);
      load();
    } catch (caught) { toast.error(caught.message); load(); }
    finally { setBusy(null); }
  };
  const reject = async (order) => {
    const reason = window.prompt(`Why turn down this ${platformName(order.platform)} order? The platform sees this.`);
    if (reason == null) return;
    setBusy(order.order_id);
    try {
      await api(`/orders/${order.order_id}/reject`, { method: 'POST', body: { reason } });
      toast.success(`${platformName(order.platform)} order turned down`);
      load();
    } catch (caught) { toast.error(caught.message); load(); }
    finally { setBusy(null); }
  };

  if (!eligible || orders.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[200] flex flex-col items-center gap-3 px-4 sm:top-20">
      <button type="button" onClick={toggleSound} aria-pressed={sound} className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-ink-900/80 px-3 py-1 text-caption font-medium text-white backdrop-blur-sm">
        {sound ? <Bell aria-hidden="true" className="h-3 w-3" /> : <BellOff aria-hidden="true" className="h-3 w-3" />}
        {sound ? 'Ringing until accepted or rejected — mute' : 'Ring muted for this device'}
      </button>
      {orders.map((order) => (
        <OrderPopup key={order.order_id} order={order} busy={busy === order.order_id} onAccept={() => accept(order)} onReject={() => reject(order)} />
      ))}
    </div>
  );
};

export default IncomingDeliveryAlert;
