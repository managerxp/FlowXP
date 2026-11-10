/* Three smaller gaps closed on the phone: salon stock (alerts, batches, adding stock with an expiry), auto-parts reports and trade prices, and the wholesale report list.
   The server works everything out; these are the shapes and the small checks the screens need. */

/* ── salon stock ───────────────────────────────────────────────────────── */
export type StockItem = { product_id: number; name: string; unit: string | null; stock?: number; min_stock?: number; batch_no?: string | null; expiry_date?: string | null; days_to_expiry?: number; remaining?: number };
export type SalonAlerts = {
  counts: { low_stock: number; out_of_stock: number; expiring_soon: number; expired: number; negative_stock: number; unusual_consumption: number };
  low_stock: StockItem[]; out_of_stock: StockItem[]; negative_stock: StockItem[]; expiring_soon: StockItem[]; expired: StockItem[];
};
export type SalonBatch = { batch_id: number; product_id: number; product: string; unit: string | null; batch_no: string | null; expiry_date: string | null; days_to_expiry: number | null; remaining: number; status: 'OK' | 'EXPIRED' | 'NO_EXPIRY' };

export const ALERT_GROUPS: { key: keyof Omit<SalonAlerts, 'counts'>; title: string; tone: 'warn' | 'bad' }[] = [
  { key: 'out_of_stock', title: 'Finished', tone: 'bad' }, { key: 'low_stock', title: 'Running low', tone: 'warn' }, { key: 'expiring_soon', title: 'Expiring soon', tone: 'warn' },
  { key: 'expired', title: 'Expired', tone: 'bad' }, { key: 'negative_stock', title: 'Stock count is below zero', tone: 'bad' }
];
export const alertTotal = (a: Pick<SalonAlerts, 'counts'> | null | undefined): number => (a ? a.counts.low_stock + a.counts.out_of_stock + a.counts.expiring_soon + a.counts.expired + a.counts.negative_stock : 0);
export const expiryText = (days: number | null | undefined): string => (days == null ? '' : days < 0 ? `Expired ${-days} day${days === -1 ? '' : 's'} ago` : days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`);

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const addStockProblem = (productId: number | null, qty: number, expiry: string): string =>
  !productId ? 'Choose the item.' : !(qty > 0) ? 'Type how many came in.' : expiry && !isDate(expiry) ? 'Write the expiry like 2026-12-31, or leave it empty.' : '';
export const addStockBody = (productId: number, qty: number, batchNo: string, expiry: string, cost: string) => ({
  product_id: productId, quantity: qty, reason: 'ADJUSTMENT', ...(batchNo.trim() ? { batch_no: batchNo.trim() } : {}), ...(expiry ? { expiry_date: expiry } : {}), ...(Number(cost) > 0 ? { unit_cost: Number(cost) } : {})
});

/* ── auto-parts reports and trade prices ───────────────────────────────── */
export type Mover = { product_id: number; name: string; sku: string | null; class: 'FAST' | 'MEDIUM' | 'SLOW' | 'DEAD' | 'NONE'; on_hand: number; sold_30: number; sold_90: number; idle_days?: number | null; stock_cost_paise: number };
export type Reorder = { product_id: number; name: string; sku: string | null; supplier: string | null; on_hand: number; on_order: number; suggested_qty: number; est_cost_paise: number; rule?: string };
export type AgeBucket = { label: string; parts: number; units: number; cost_paise: number };
export type Valuation = { categories: { category: string; parts: number; units: number; cost_paise: number; sell_paise: number }[]; total_cost_paise: number; total_sell_paise: number };
export type PriceList = { price_list_id: number; name: string; discount_pct: number; items: number; customers: number };
export type Reservation = { reservation_id: number; part: string; sku: string | null; customer: string | null; qty: number; open_qty: number; status: string };

export const MOVER_TEXT: Record<string, string> = { FAST: 'Sells fast', MEDIUM: 'Steady', SLOW: 'Slow', DEAD: 'Not selling', NONE: 'New' };
export const priceListProblem = (name: string, pct: string): string => (name.trim().length < 2 ? 'Give the price list a name.' : !(Number(pct) >= 0 && Number(pct) <= 100) || pct.trim() === '' ? 'Type the discount as a percent from 0 to 100.' : '');
export const priceListBody = (name: string, pct: string) => ({ name: name.trim(), discount_pct: Number(pct) });

/* ── wholesale reports ─────────────────────────────────────────────────── */
export type ReportDef = { key: string; label: string; group: string; description: string; period?: boolean; filters?: string[] };
export type ReportCol = { key: string; label: string; type: 'money' | 'number' | 'percent' | 'date' | 'text' | string };
export type ReportOut = { columns: ReportCol[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> | null; note?: string };

export const groupReports = (defs: ReportDef[]): { name: string; items: ReportDef[] }[] => {
  const by = new Map<string, ReportDef[]>();
  for (const d of defs) by.set(d.group, [...(by.get(d.group) ?? []), d]);
  return [...by.entries()].map(([name, items]) => ({ name, items }));
};
export const cell = (type: string, v: unknown): string => {
  if (v == null || v === '') return '';
  if (type === 'money') return `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  if (type === 'number') return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  if (type === 'percent') return `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
  return String(v);
};
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const periodFor = (id: 'today' | 'month' | 'last30', today = new Date()): { from: string; to: string } => {
  const from = id === 'today' ? today : id === 'month' ? new Date(today.getFullYear(), today.getMonth(), 1) : new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
  return { from: iso(from), to: iso(today) };
};
export const reportPath = (def: Pick<ReportDef, 'key' | 'period'>, p: { from: string; to: string }): string => `/wholesale/reports/${def.key}?${def.period ? `from=${p.from}&` : ''}to=${p.to}`;

export const rs = (paise: number | string | null | undefined): string => `₹${Math.round(Number(paise || 0) / 100).toLocaleString('en-IN')}`;
