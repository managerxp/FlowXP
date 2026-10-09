import { lineName, linePricePaise, totals, type Cart } from './cart.ts';
import { itemName, liveItems, orderTotals, type Order } from './orders.ts';
import { toPaise } from './money.ts';

/* Small helpers that make billing quicker: which items sell most at this till, the order and memory of payment methods, and cash amounts to tap. Pure logic, kept on the phone. */

export type Usage = Record<string, { n: number; t: number }>;

/** One more sale of this item: counted, and stamped with when. */
export const bump = (usage: Usage, productId: number, now: number): Usage => {
  const k = String(productId);
  return { ...usage, [k]: { n: (usage[k]?.n ?? 0) + 1, t: now } };
};

/** The items that sell most here, then the most recent: what goes on the Popular shelf. */
export const popular = (usage: Usage, limit = 12): number[] =>
  Object.entries(usage).sort(([, a], [, b]) => b.n - a.n || b.t - a.t).slice(0, limit).map(([id]) => Number(id));

/** Keep the memory small: only the busiest items are remembered. */
export const trim = (usage: Usage, keep = 60): Usage => Object.fromEntries(Object.entries(usage).sort(([, a], [, b]) => b.n - a.n || b.t - a.t).slice(0, keep));

export const parseUsage = (raw: string | null): Usage => { try { const v = JSON.parse(raw || '{}') as Usage; return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

export type Method = 'CASH' | 'UPI' | 'CARD';
/** UPI first, then cash, then card: how most customers in India pay. */
export const METHOD_ORDER: Method[] = ['UPI', 'CASH', 'CARD'];
export const isMethod = (v: string | null): v is Method => v === 'CASH' || v === 'UPI' || v === 'CARD';

/** Amounts a customer is likely to hand over for a bill: the exact amount, then the next round notes above it. Paise in, paise out. */
export const cashSuggestions = (totalPaise: number): number[] => {
  if (totalPaise <= 0) return [];
  const out = [totalPaise];
  for (const step of [50, 100, 500, 2000]) {
    const up = Math.ceil(totalPaise / (step * 100)) * step * 100;
    if (up > out[out.length - 1]) out.push(up);
  }
  return out.slice(0, 4);
};

/* ── the bill, as the pay screen lists it (the same for the till's bill and for a table's order) ── */

export type SummaryRow = { name: string; qty: number; paise: number };
export type Summary = { rows: SummaryRow[]; items: number; subtotalPaise: number; offersPaise: number; taxPaise: number; totalPaise: number };

export const cartSummary = (cart: Cart, offers: Map<string, number> = new Map()): Summary => {
  const t = totals(cart, offers);
  return { rows: cart.lines.map((l) => ({ name: lineName(l), qty: l.quantity, paise: Math.round(linePricePaise(l) * l.quantity) })), items: t.itemCount, subtotalPaise: t.subtotalPaise, offersPaise: t.offersPaise, taxPaise: t.taxPaise, totalPaise: t.totalPaise };
};

export const orderSummary = (o: Order): Summary => {
  const t = orderTotals(o);
  return { rows: liveItems(o).map((i) => ({ name: itemName(i), qty: i.quantity, paise: Math.round(toPaise(i.unit_price) * i.quantity) })), items: t.items, subtotalPaise: t.subtotalPaise, offersPaise: 0, taxPaise: t.taxPaise, totalPaise: t.totalPaise };
};
