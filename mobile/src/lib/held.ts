/*
 * Bills on hold. A held bill is only a DRAFT of what the till had on screen (which items, which options, which customer): prices, stock and
 * offers are worked out again when it is resumed and charged. The shape is the same one the website's till uses, so a bill held on the
 * phone can be resumed at the counter PC and the other way round.
 *
 * Held on the server (shared by every till at the outlet) when there is a connection; kept on this phone when there is not, and shown in
 * the same list marked "on this phone". A phone-only held bill is not shared and is not sent to the server later.
 */
import { NetworkError, newKey, type Api } from './api.ts';
import { addProduct, emptyCart, linePricePaise, lineKey, lineName, totals, type Cart } from './cart.ts';
import type { Product } from './catalog.ts';
import type { Db } from './db.ts';
import type { Group } from './options.ts';
import { toPaise } from './money.ts';
import { picked as pickedOf } from './options.ts';

export type HeldLine = {
  product_id: number | null; custom: boolean; name: string; unit: string; unit_price: number; quantity: number; discount: number; tax_rate: number;
  modifier_ids: number[]; sig: string; track_inventory: boolean; current_stock: number;
};
export type HeldBill = { lines: HeldLine[]; customer_id: number | null; customer_name: string | null; coupon_code: string | null; discount: number; notes: string | null };
export type HeldRow = { hold_id: number | string; label: string | null; bill: HeldBill; item_count: number; estimate: number; created_at: string; held_by?: string | null; local?: boolean };

/** What goes to the server: the cart as the website's till would have saved it. */
export const toSnapshot = (cart: Cart, customer: { id: number; name: string } | null): HeldBill => ({
  lines: cart.lines.map((l) => ({
    product_id: l.product.product_id, custom: false, name: lineName(l), unit: l.product.unit ?? '', unit_price: linePricePaise(l) / 100, quantity: l.quantity, discount: 0,
    tax_rate: l.product.tax_rate, modifier_ids: l.modifierIds, sig: [...l.modifierIds].sort((a, b) => a - b).join(','),
    track_inventory: l.product.track_inventory, current_stock: l.product.current_stock ?? 0
  })),
  customer_id: customer?.id ?? null, customer_name: customer?.name ?? null, coupon_code: null, discount: 0, notes: null
});

export const estimateOf = (cart: Cart): number => totals(cart).totalPaise / 100;

export type Resolved = { cart: Cart; customer: { id: number; name: string } | null; skipped: string[] };

/**
 * Put a held bill back on the till. Each line is looked up in this phone's catalogue by its product id (the price is the current one, the
 * server prices the sale anyway); a line whose product is gone, or a custom line, is left out and named so the cashier knows.
 */
export const fromSnapshot = async (
  bill: HeldBill,
  find: (productId: number) => Promise<Product | undefined>,
  groupsFor: (product: Product) => Promise<Group[]>
): Promise<Resolved> => {
  let cart = emptyCart(); const skipped: string[] = [];
  for (const l of bill.lines) {
    if (l.custom || !l.product_id) { skipped.push(`${l.name || 'A custom item'} (custom items are only on the website till)`); continue; }
    const product = await find(l.product_id);
    if (!product) { skipped.push(`${l.name || `Product ${l.product_id}`} (no longer on the menu)`); continue; }
    let options;
    if (l.modifier_ids.length) {
      const groups = await groupsFor(product);
      const chosen: Record<number, number[]> = {};
      for (const g of groups) chosen[g.group_id] = g.modifiers.filter((m) => l.modifier_ids.includes(m.modifier_id)).map((m) => m.modifier_id);
      options = pickedOf(groups, chosen);
      if (options.ids.length !== l.modifier_ids.length) { skipped.push(`${l.name} (its options have changed)`); continue; }
    }
    cart = addProduct(cart, product, l.quantity, options);
  }
  return { cart, customer: bill.customer_id ? { id: bill.customer_id, name: bill.customer_name ?? 'Customer' } : null, skipped };
};

/* ── held on this phone (no connection) ─────────────────────────────────── */

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS held (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT,
    bill TEXT NOT NULL,
    estimate_paise INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

type Row = { id: number; label: string | null; bill: string; estimate_paise: number; created_at: number };
const asRow = (r: Row): HeldRow => {
  const bill = JSON.parse(r.bill) as HeldBill;
  return { hold_id: `local-${r.id}`, label: r.label, bill, item_count: bill.lines.reduce((s, l) => s + l.quantity, 0), estimate: r.estimate_paise / 100, created_at: new Date(r.created_at).toISOString(), local: true };
};

export const createHeld = (db: Db, { now = () => Date.now() }: { now?: () => number } = {}) => ({
  hold: async (bill: HeldBill, label: string | null, estimate: number) => {
    await db.run(`INSERT INTO held (label, bill, estimate_paise, created_at) VALUES (?,?,?,?)`, [label, JSON.stringify(bill), toPaise(estimate), now()]);
  },
  list: async (): Promise<HeldRow[]> => (await db.all<Row>(`SELECT * FROM held ORDER BY id`)).map(asRow),
  /** Take one back (resume) or throw it away. Resolves to the bill, or null when it is already gone. */
  take: async (holdId: string): Promise<HeldRow | null> => {
    const id = Number(String(holdId).replace('local-', ''));
    const row = (await db.all<Row>(`SELECT * FROM held WHERE id = ?`, [id]))[0];
    if (!row) return null;
    await db.run(`DELETE FROM held WHERE id = ?`, [id]);
    return asRow(row);
  },
  count: async () => Number((await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM held`))[0].n)
});
export type Held = ReturnType<typeof createHeld>;

export { lineKey };

/** Hold the bill: on the server when it can be reached (shared with the outlet's other tills), else on this phone. */
export const holdBill = async (
  { api, held, bill, label, estimate, key }: { api: Api; held: Held; bill: HeldBill; label: string | null; estimate: number; key?: string }
): Promise<'server' | 'phone'> => {
  try {
    await api.post('/held-bills', { bill, estimate, ...(label ? { label } : {}) }, { idempotencyKey: key ?? newKey() });
    return 'server';
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;      // a refusal (50 already held here) is shown, not hidden on the phone
    await held.hold(bill, label, estimate);
    return 'phone';
  }
};
