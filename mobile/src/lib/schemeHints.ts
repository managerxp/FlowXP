/* Offers for the shop in front of the rep, readable with no signal. The list of schemes a shop qualifies for is kept on the phone when it was last online; the server still prices
   every order and decides what applies. A hint says what the offer is and how far the order is from it. */
import { unitFactor, type FLine } from './field.ts';

export type Scheme = {
  scheme_id: number; name: string; kind: 'BUY_X_GET_Y' | 'QTY_DISCOUNT' | 'VALUE_DISCOUNT'; description: string; buy_product_id: number | null; buy_brand_id: number | null; buy_category_id: number | null;
  buy_scope: 'PRODUCT' | 'BRAND' | 'CATEGORY' | 'PRINCIPAL' | 'ALL'; buy_unit_name: string | null; buy_min_qty: number | null; min_value: number | null; free_qty: number | null; free_unit_name: string | null;
  repeat: boolean; discount_pct: number | null; discount: number | null; days_left: number | null; status: string; starts_on?: string | null; ends_on: string | null;
};
export type Kept = { at: number; schemes: Scheme[] };

export const schemeKey = (business: number | null, customer: number): string => `schemes:${business}:${customer}`;
export const parseKept = (raw: string | null): Kept | null => { try { const v = JSON.parse(raw || 'null') as Kept | null; return v && Array.isArray(v.schemes) ? v : null; } catch { return null; } };

/** Only offers that are running on this day (a list kept yesterday may hold one that has since ended). */
export const live = (schemes: Scheme[], today: string): Scheme[] =>
  schemes.filter((s) => s.status !== 'INACTIVE' && s.status !== 'EXPIRED' && (!s.ends_on || String(s.ends_on).slice(0, 10) >= today) && (!s.starts_on || String(s.starts_on).slice(0, 10) <= today));

export type Hint = { scheme: Scheme; text: string; reached: boolean };

/** How many of the scheme's own unit the order has of the scheme's product. Only an offer for one named product can be counted from the phone; a brand or category offer needs the whole product list. */
const have = (s: Scheme, lines: FLine[]): number | null => {
  if (s.buy_scope !== 'PRODUCT' || s.buy_product_id == null) return null;
  const mine = lines.filter((l) => l.product.product_id === s.buy_product_id);
  if (!mine.length) return 0;
  const per = unitFactor(mine[0].product, s.buy_unit_name);
  const base = mine.reduce((a, l) => a + (Number(l.quantity) || 0) * unitFactor(l.product, l.unit_name), 0);
  return Math.round((base / per) * 1000) / 1000;
};

/** A hint for each running offer: what it is, and for a one-product offer how many more to add. */
export const hints = (schemes: Scheme[], lines: FLine[], today: string): Hint[] =>
  live(schemes, today).map((s) => {
    const n = have(s, lines);
    if (n == null || !s.buy_min_qty) return { scheme: s, text: s.description, reached: false };
    const unit = s.buy_unit_name ? ` ${s.buy_unit_name}` : '';
    if (n >= s.buy_min_qty) return { scheme: s, text: `${s.description}. This order qualifies.`, reached: true };
    const more = Math.round((s.buy_min_qty - n) * 1000) / 1000;
    return { scheme: s, text: `${s.description}. Add ${more}${unit} more to get it.`, reached: false };
  });

/** When the list was kept, in words: "just now", "3 h ago". */
export const keptText = (at: number, now = Date.now()): string => {
  const m = Math.round((now - at) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/* ── keeping the lists ── */
type Getter = { get: <T>(path: string) => Promise<T> };
type Kv = { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void> };
export const FRESH_MS = 6 * 3600000;

/** Ask the server which offers a shop qualifies for and keep the answer on the phone. Returns what it kept, or null when the server could not be reached. */
export const keepSchemes = async (api: Getter, kv: Kv, business: number | null, customerId: number, today: string, now = Date.now()): Promise<Kept | null> => {
  try {
    const schemes = await api.get<Scheme[]>(`/distributor/schemes/eligible?customer_id=${customerId}&date=${today}`);
    const kept: Kept = { at: now, schemes };
    await kv.set(schemeKey(business, customerId), JSON.stringify(kept));
    return kept;
  } catch { return null; }
};

/** Keep the lists for the shops on a route, a few at a time, skipping any kept within the last few hours. A failure stops quietly: it is only a convenience. */
export const keepForRoute = async (api: Getter, kv: Kv, business: number | null, customerIds: number[], today: string, now = Date.now(), parallel = 3): Promise<number> => {
  let done = 0; let stop = false;
  const queue = [...customerIds];
  const worker = async () => {
    while (!stop) {
      const id = queue.shift(); if (id == null) return;
      const have = parseKept(await kv.get(schemeKey(business, id)));
      if (have && now - have.at < FRESH_MS) continue;
      if (await keepSchemes(api, kv, business, id, today, now)) done++; else stop = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker));
  return done;
};
