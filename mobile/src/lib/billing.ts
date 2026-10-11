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


/* ── part payment and pay later ─────────────────────────────────────────── */

/** How a bill is settled at the till: all of it now, some of it now (the rest is owed), or none of it now (the customer's credit). */
export type PayHow = 'FULL' | 'PART' | 'LATER';
export type PayPlan = { ok: boolean; /** null = the whole bill; 0 = nothing now; else paise taken now */ payNowPaise: number | null; balancePaise: number; problem: string };

/**
 * What a payment screen is about to do, and why not when it cannot. Money owed needs somebody who owes it: a part payment or pay-later bill must have a customer.
 * `now` is what the cashier typed for "paying now".
 */
export const payPlan = ({ how, totalPaise, now, hasCustomer }: { how: PayHow; totalPaise: number; now: string; hasCustomer: boolean }): PayPlan => {
  if (how === 'FULL') return { ok: true, payNowPaise: null, balancePaise: 0, problem: '' };   // (a bill that comes to nothing, like a free service, is still just "paid in full")
  if (totalPaise <= 0) return { ok: false, payNowPaise: null, balancePaise: 0, problem: '' };
  if (!hasCustomer) return { ok: false, payNowPaise: how === 'LATER' ? 0 : null, balancePaise: totalPaise, problem: 'Choose the customer first: the rest of the bill is owed by them.' };
  if (how === 'LATER') return { ok: true, payNowPaise: 0, balancePaise: totalPaise, problem: '' };
  const text = now.trim();
  const paise = text === '' ? NaN : toPaise(text);
  if (!(paise > 0)) return { ok: false, payNowPaise: null, balancePaise: totalPaise, problem: text === '' ? '' : 'Enter how much is being paid now.' };
  if (paise >= totalPaise) return { ok: false, payNowPaise: null, balancePaise: 0, problem: 'That is the whole bill. Choose Pay in full.' };
  return { ok: true, payNowPaise: paise, balancePaise: totalPaise - paise, problem: '' };
};
