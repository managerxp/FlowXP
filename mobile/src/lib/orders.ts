/* Table orders: what the floor and an order look like, and the sums the order screen shows. The server owns the order; these only read it. */
import { toPaise } from './money.ts';

export type TableOrderSummary = { opened_at: string; items: number; estimate: number; not_sent: number; cooking: number; ready: number };
export type TableRow = {
  table_id: number; name: string; zone: string | null; seats: number | null; status: string;
  open_order_id: number | null; open_order_number: string | null; open_order: TableOrderSummary | null;
  waiter_name: string | null; next_reservation: { reserved_at: string; guest_name: string | null; party_size: number | null } | null;
};
export type OrderItem = {
  order_item_id: number; product_id: number | null; description: string; modifiers: { name: string }[]; quantity: number; unit_price: number; line_total: number;
  tax_rate?: number; kitchen_notes: string | null; status: 'PENDING' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED'; billed: boolean;
};
export type Order = {
  order_id: number; order_number: string; order_type: string; table_id: number | null; table_name: string | null; customer_id: number | null; customer_name: string | null;
  status: string; notes: string | null; items: OrderItem[]; summary?: { items: number; lines: number; estimate: number; not_sent: number; cooking: number; ready: number };
};

export type TableState = 'free' | 'reserved' | 'new' | 'cooking' | 'ready' | 'served';

/** How a table looks on the floor: free, held for a booking, taken but nothing sent yet, cooking, something ready to carry out, or all served. */
export const tableState = (t: TableRow): TableState => {
  const o = t.open_order;
  if (!t.open_order_id || !o) return t.next_reservation || t.status === 'RESERVED' ? 'reserved' : 'free';
  if (o.ready > 0) return 'ready';
  if (o.cooking > 0) return 'cooking';
  if (o.not_sent > 0 || o.items === 0) return 'new';
  return 'served';
};

export const STATE_LABEL: Record<TableState, string> = { free: 'Free', reserved: 'Booked', new: 'Order open', cooking: 'Cooking', ready: 'Ready to serve', served: 'Served' };
export const ITEM_LABEL: Record<OrderItem['status'], string> = { PENDING: 'Not sent', PREPARING: 'Cooking', READY: 'Ready', SERVED: 'Served', CANCELLED: 'Cancelled' };

/** The lines still to be billed: not cancelled and not already on an invoice. */
export const liveItems = (o: Order): OrderItem[] => o.items.filter((i) => !i.billed && i.status !== 'CANCELLED');

export type OrderTotals = { lines: number; items: number; subtotalPaise: number; taxPaise: number; totalPaise: number; notSent: number; ready: number };

/** About what the bill will come to (price and GST per line; the server adds offers and round-off when it bills). */
export const orderTotals = (o: Order): OrderTotals => {
  let subtotal = 0; let tax = 0; let items = 0; let notSent = 0; let ready = 0;
  const live = liveItems(o);
  for (const i of live) {
    const line = Math.round(toPaise(i.unit_price) * i.quantity);
    subtotal += line; tax += Math.round(line * ((i.tax_rate ?? 0) / 100)); items += i.quantity;
    if (i.status === 'PENDING') notSent++;
    if (i.status === 'READY') ready++;
  }
  return { lines: live.length, items, subtotalPaise: subtotal, taxPaise: tax, totalPaise: subtotal + tax, notSent, ready };
};

export const itemName = (i: OrderItem) => (i.modifiers.length ? `${i.description} (${i.modifiers.map((m) => m.name).join(', ')})` : i.description);

/** Group the tables by zone for the floor; tables with no zone come first. */
export const byZone = (tables: TableRow[]): { zone: string; tables: TableRow[] }[] => {
  const groups = new Map<string, TableRow[]>();
  for (const t of tables) { const z = t.zone ?? ''; groups.set(z, [...(groups.get(z) ?? []), t]); }
  return [...groups.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))).map(([zone, list]) => ({ zone, tables: list }));
};
