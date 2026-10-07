/*
 * The bill being made. Everything here is a PREVIEW: price (plus the options chosen) x quantity plus GST, less any offers the server
 * reported, so the cashier sees about what the customer will pay. The server prices the sale for real (offers, round-off, coupons) and
 * its invoice is what the receipt shows.
 */
import { toPaise } from './money.ts';
import type { Product } from './catalog.ts';
import type { Picked } from './options.ts';

/** `key` tells lines apart: the same drink with different options is a different line. */
export type Line = { key: string; product: Product; quantity: number; modifierIds: number[]; modifierNames: string[]; deltaPaise: number };
export type Cart = { lines: Line[] };

export const emptyCart = (): Cart => ({ lines: [] });

export const lineKey = (productId: number, modifierIds: number[]) => `${productId}:${[...modifierIds].sort((a, b) => a - b).join(',')}`;
export const lineName = (l: Line) => (l.modifierNames.length ? `${l.product.name} (${l.modifierNames.join(', ')})` : l.product.name);
export const linePricePaise = (l: Line) => toPaise(l.product.selling_price) + l.deltaPaise;

/** Add one (or `by`) of a product with the chosen options; adding the same again raises the quantity of its line. */
export const addProduct = (cart: Cart, product: Product, by = 1, options?: Picked): Cart => {
  const modifierIds = options?.ids ?? [];
  const key = lineKey(product.product_id, modifierIds);
  if (cart.lines.some((l) => l.key === key)) return { lines: cart.lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + by } : l)) };
  return { lines: [...cart.lines, { key, product, quantity: by, modifierIds, modifierNames: options?.names ?? [], deltaPaise: options?.deltaPaise ?? 0 }] };
};

/** Set a line's quantity; zero or less removes it. */
export const setQuantity = (cart: Cart, key: string, quantity: number): Cart => ({
  lines: quantity > 0 ? cart.lines.map((l) => (l.key === key ? { ...l, quantity } : l)) : cart.lines.filter((l) => l.key !== key)
});

export type Totals = { itemCount: number; subtotalPaise: number; offersPaise: number; taxPaise: number; totalPaise: number };

/** `offers`: what the server said each line saves, in paise, by line key. An offer is taken off BEFORE GST, as the server does. */
export const totals = (cart: Cart, offers: Map<string, number> = new Map()): Totals => {
  let subtotal = 0; let saved = 0; let tax = 0; let count = 0;
  for (const l of cart.lines) {
    const line = Math.round(linePricePaise(l) * l.quantity);
    const off = Math.min(line, offers.get(l.key) ?? 0);
    subtotal += line; saved += off;
    tax += Math.round((line - off) * (l.product.tax_rate / 100));
    count += l.quantity;
  }
  return { itemCount: count, subtotalPaise: subtotal, offersPaise: saved, taxPaise: tax, totalPaise: subtotal - saved + tax };
};

/** What POST /invoices takes: ids, quantities and chosen option ids only. The server prices every line itself. */
export const saleBody = (cart: Cart, payment: { method: string; reference?: string }, { kitchen = false }: { kitchen?: boolean } = {}) => ({
  items: cart.lines.map((l) => ({ product_id: l.product.product_id, quantity: l.quantity, ...(l.modifierIds.length ? { modifier_ids: l.modifierIds } : {}) })),
  payment: { method: payment.method, amount: 'FULL', ...(payment.reference ? { reference_number: payment.reference } : {}) },
  apply_promotions: true,
  ...(kitchen ? { send_to_kitchen: true } : {})
});

/** A UPI payment link for the customer's phone to scan: the business's UPI ID, the amount, and the bill as the note. */
export const upiLink = (vpa: string, name: string, totalPaise: number, note: string): string =>
  `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(name)}&am=${(totalPaise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;

/** The shops that make food to order: their counter sale can go to the kitchen (or barista) screen and comes back with a token. */
export const KITCHEN_TYPES = ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN'];
