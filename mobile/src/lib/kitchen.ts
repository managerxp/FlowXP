/*
 * The kitchen display: tickets as the server sends them (GET /kitchen/tickets), sorted into "To make", "Ready to serve" and "Served" for
 * one station, with the same rules as the website's display: a dish is on time, nearly due (75% of its time gone) or late; a cancelled dish
 * stays on its own table's ticket as a "do not make" notice; "Cook now" adds up the same dish across tickets.
 */
export type Urgency = 'ok' | 'warning' | 'late';
export type KItem = {
  order_item_id: number; description: string; combo?: string[] | null; quantity: number; modifiers: { name: string }[]; kitchen_notes: string | null;
  status: 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED'; station_id: number | null; expected_minutes: number | null;
  sent_at: string; ready_at: string | null; served_at: string | null; cancelled: boolean;
};
export type KTicket = {
  order_id: number; order_number: string; order_type: string; platform: string | null; table_name: string | null; brand_name: string | null;
  priority: 'NORMAL' | 'RUSH'; sent_at: string; items: KItem[]; kot_number?: string | null;
};
export type KStation = { station_id: number | 'all' | null; name: string; making: number; late: number };
export type KitchenData = { stations: KStation[]; tickets: KTicket[] };

export const minutesSince = (iso: string, now: number): number => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));

/** Same thresholds as the server: no expected time = fine; past it = late; three quarters of it = nearly due. */
export const urgencyOf = (elapsed: number, expected: number | null): Urgency => (!expected ? 'ok' : elapsed > expected ? 'late' : elapsed >= expected * 0.75 ? 'warning' : 'ok');
export const RANK: Record<Urgency, number> = { ok: 0, warning: 1, late: 2 };

/** "12m", "1h 5m". */
export const span = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

/** How a dish being made stands against its own time: "4m left", "Due now", "3m over". */
export const dueText = (elapsed: number, expected: number | null): string | null => {
  if (!expected) return null;
  const left = expected - elapsed;
  return left > 0 ? `${left}m left` : left === 0 ? 'Due now' : `${span(-left)} over`;
};

export const dishKey = (i: Pick<KItem, 'description' | 'modifiers'>): string => `${i.description}|${(i.modifiers || []).map((m) => m.name).join(' · ')}`;

/** Where a ticket's cancelled dishes show: with To make while something there is still cooking, else with Ready, else as a notice in To make. */
export const homeOf = (t: KTicket): 'making' | 'ready' => (t.items.some((i) => i.status === 'PREPARING') ? 'making' : t.items.some((i) => i.status === 'READY') ? 'ready' : 'making');

export type Column = 'making' | 'ready' | 'served';
const STATUS_OF: Record<Column, KItem['status'][]> = { making: ['PREPARING'], ready: ['READY'], served: ['SERVED'] };

/** The items of a ticket that belong in a column (a cancelled dish goes where its ticket's home is). */
export const itemsIn = (t: KTicket, col: Column): KItem[] => t.items.filter((i) => STATUS_OF[col].includes(i.status) || (i.cancelled && col === homeOf(t)));

export const inStation = (i: KItem, station: string): boolean => station === 'all' || (station === 'none' ? i.station_id == null : i.station_id === Number(station));

export type Sorted = { making: KTicket[]; ready: KTicket[]; served: KTicket[] };

/** This station's share of every ticket, in the three columns. `gone` = cancelled dishes the cook has already acknowledged. */
export const sortTickets = (data: KitchenData | null, station: string, gone: Set<number> = new Set()): Sorted => {
  if (!data) return { making: [], ready: [], served: [] };
  const scoped = data.tickets
    .map((t) => ({ ...t, items: t.items.filter((i) => inStation(i, station) && !(i.cancelled && gone.has(i.order_item_id))) }))
    .filter((t) => t.items.length);
  const has = (t: KTicket, st: KItem['status']) => t.items.some((i) => i.status === st);
  const making = scoped.filter((t) => t.items.some((i) => i.status === 'PREPARING' || (i.cancelled && homeOf(t) === 'making')))
    .sort((a, b) => Number(has(b, 'PREPARING')) - Number(has(a, 'PREPARING')));   // a notice with nothing left to cook goes last
  return { making, ready: scoped.filter((t) => has(t, 'READY')), served: scoped.filter((t) => has(t, 'SERVED')) };
};

export type CookRow = { key: string; name: string; extra: string; qty: number; tickets: number; late: number };

/** Every dish still being made, added up across tickets: "6 x Cafe Latte (Oat)", most first. */
export const cookNow = (making: KTicket[], now: number): CookRow[] => {
  const rows = new Map<string, CookRow & { orders: Set<number> }>();
  for (const t of making) for (const i of t.items) {
    if (i.status !== 'PREPARING') continue;
    const key = dishKey(i);
    const row = rows.get(key) ?? { key, name: i.description, extra: (i.modifiers || []).map((m) => m.name).join(' · '), qty: 0, tickets: 0, late: 0, orders: new Set<number>() };
    row.qty += i.quantity; row.orders.add(t.order_id);
    if (urgencyOf(minutesSince(i.sent_at, now), i.expected_minutes) === 'late') row.late += i.quantity;
    rows.set(key, row);
  }
  return [...rows.values()].map(({ orders, ...r }) => ({ ...r, tickets: orders.size })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
};

export type Stats = { tickets: number; dishes: number; lateTickets: number; oldest: number; readyTickets: number; longestWait: number };

/** The strip across the top: how the pass is doing right now. */
export const statsOf = (s: Sorted, now: number): Stats => {
  const toMake = s.making.filter((t) => t.items.some((i) => i.status === 'PREPARING'));
  const making = toMake.flatMap((t) => t.items.filter((i) => i.status === 'PREPARING'));
  const late = toMake.filter((t) => t.items.some((i) => i.status === 'PREPARING' && urgencyOf(minutesSince(i.sent_at, now), i.expected_minutes) === 'late')).length;
  const waits = s.ready.flatMap((t) => t.items.filter((i) => i.status === 'READY').map((i) => minutesSince(i.ready_at || i.sent_at, now)));
  return {
    tickets: toMake.length, dishes: making.reduce((n, i) => n + i.quantity, 0), lateTickets: late,
    oldest: making.length ? Math.max(...making.map((i) => minutesSince(i.sent_at, now))) : 0, readyTickets: s.ready.length, longestWait: Math.max(0, ...waits)
  };
};

export type Seen = { ids: Set<number>; late: Set<number> };

/** What changed since the last look, for the alert: a dish that was not there before is "new"; one that has just gone past its time is "late". */
export const alertFor = (prev: Seen | null, data: KitchenData, now: number): { alert: 'new' | 'late' | null; seen: Seen } => {
  const making = data.tickets.flatMap((t) => t.items).filter((i) => i.status === 'PREPARING');
  const seen: Seen = { ids: new Set(making.map((i) => i.order_item_id)), late: new Set(making.filter((i) => urgencyOf(minutesSince(i.sent_at, now), i.expected_minutes) === 'late').map((i) => i.order_item_id)) };
  if (!prev) return { alert: null, seen };            // the first look is not news
  if ([...seen.ids].some((id) => !prev.ids.has(id))) return { alert: 'new', seen };
  if ([...seen.late].some((id) => !prev.late.has(id))) return { alert: 'late', seen };
  return { alert: null, seen };
};

/** A ticket's title: its table, or "Takeaway" / the delivery platform. */
export const ticketTitle = (t: KTicket): string => t.table_name ?? (t.platform ? t.platform.replace(/_/g, ' ') : t.order_type === 'DELIVERY' ? 'Delivery' : t.order_type === 'TAKEAWAY' ? 'Takeaway' : t.order_number);
