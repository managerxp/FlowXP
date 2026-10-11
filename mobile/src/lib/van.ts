/* Van sales: the stock a rep carries, and a sale made from it at a shop. With no signal the sale is kept on the phone and sent later; the stock shown is what the van held at the last look less what was sold since. */
import { toPaise } from './money.ts';
import { pieceRupees, unitFactor, type FLine } from './field.ts';
import type { Product } from './catalog.ts';
import type { Action } from './actions.ts';

export type Vehicle = { vehicle_id: number; vehicle_no: string; driver_name: string | null; route: string | null; status: string; items?: number; stock_value?: number };
export type VanStockRow = { stock_id: number; product_id: number; product: string; unit: string | null; batch_no: string | null; expiry_date: string | null; qty: number; units?: { unit_name: string; factor: number }[] };
export type VanDetail = Vehicle & { stock: VanStockRow[]; today: { sales: number; value: number } };
export type OnVan = { product_id: number; name: string; unit: string | null; qty: number; batches: { batch_no: string | null; expiry_date: string | null; qty: number }[]; units: { unit_name: string; factor: number }[] };

/** What the van holds, by product (every batch added up), most-stocked last so a low item is easy to see. */
export const stockByProduct = (rows: VanStockRow[]): OnVan[] => {
  const by = new Map<number, OnVan>();
  for (const r of rows) {
    const e = by.get(r.product_id) ?? { product_id: r.product_id, name: r.product, unit: r.unit, qty: 0, batches: [], units: r.units ?? [] };
    e.qty = Math.round((e.qty + r.qty) * 1000) / 1000; e.batches.push({ batch_no: r.batch_no, expiry_date: r.expiry_date, qty: r.qty });
    by.set(r.product_id, e);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
};

/** Sales made on this phone but not yet sent, as base units per product, so the van's stock is not shown as more than it is. */
export const pendingOnVan = (actions: Pick<Action, 'path' | 'body' | 'state'>[], vehicleId: number, factorOf: (productId: number, unit: string | null) => number): Map<number, number> => {
  const out = new Map<number, number>();
  for (const a of actions) {
    if (a.state === 'sent' || a.path !== `/distributor/vehicles/${vehicleId}/sell`) continue;
    for (const l of ((a.body as { lines?: { product_id: number; quantity: number; unit_name?: string }[] }).lines ?? [])) {
      out.set(l.product_id, Math.round(((out.get(l.product_id) ?? 0) + l.quantity * factorOf(l.product_id, l.unit_name ?? null)) * 1000) / 1000);
    }
  }
  return out;
};

export const leftOnVan = (p: OnVan, pending: Map<number, number>): number => Math.max(0, Math.round((p.qty - (pending.get(p.product_id) ?? 0)) * 1000) / 1000);

/** How many base units a line takes off the van. */
export const baseQty = (l: FLine): number => (Number(l.quantity) || 0) * unitFactor(l.product, l.unit_name);

/** Lines asking for more than the van holds (offline the server still records the sale and flags it, but the rep should know). */
export const overVan = (lines: FLine[], left: Map<number, number>): { name: string; short: number }[] => {
  const asked = new Map<number, { name: string; qty: number }>();
  for (const l of lines) { const e = asked.get(l.product.product_id) ?? { name: l.product.name, qty: 0 }; e.qty += baseQty(l); asked.set(l.product.product_id, e); }
  return [...asked].flatMap(([id, e]) => { const have = left.get(id) ?? 0; return e.qty > have + 1e-9 ? [{ name: e.name, short: Math.round((e.qty - have) * 1000) / 1000 }] : []; });
};

export type PayMode = 'FULL' | 'PART' | 'CREDIT';
export const PAY_LABEL: Record<PayMode, string> = { FULL: 'Paid in full', PART: 'Part paid', CREDIT: 'On credit' };

/** The kind of bill: paid on the spot is a cash bill; anything left to pay is a credit sale with the shop's terms. */
export const invoiceKind = (mode: PayMode): 'CASH' | 'CREDIT' => (mode === 'FULL' ? 'CASH' : 'CREDIT');

export const vanSaleProblem = (customerId: number | null, lines: FLine[], mode: PayMode, paid: string, method: string, reference: string): string => {
  if (!customerId) return 'Choose the shop first';
  const live = lines.filter((l) => Number(l.quantity) > 0);
  if (!live.length) return 'Add at least one product, with how many';
  if (mode === 'PART' && !(Number(paid) > 0)) return 'Enter how much was paid';
  if (mode !== 'CREDIT' && ['UPI', 'BANK_TRANSFER', 'CHEQUE'].includes(method) && !reference.trim()) return method === 'CHEQUE' ? 'Enter the cheque number' : 'Enter the transaction reference';
  return '';
};

/** What a van sale sends: the shop, the products, how it was paid, and the total the shop was shown (the server prices it and flags a difference). */
export const vanSaleBody = (a: { customerId: number; lines: FLine[]; mode: PayMode; paid: string; method: string; reference: string; expectedTotal: number; visitRef?: string; notes?: string }) => ({
  customer_id: a.customerId,
  lines: a.lines.filter((l) => Number(l.quantity) > 0).map((l) => ({ product_id: l.product.product_id, quantity: Number(l.quantity), ...(l.unit_name ? { unit_name: l.unit_name } : {}) })),
  invoice_kind: invoiceKind(a.mode), expected_total: a.expectedTotal,
  ...(a.mode === 'CREDIT' ? {} : { payment: { amount: a.mode === 'FULL' ? 'FULL' : Number(a.paid), method: a.method, ...(a.reference.trim() ? { reference_number: a.reference.trim() } : {}) } }),
  ...(a.visitRef ? { visit_ref: a.visitRef } : {}), ...(a.notes?.trim() ? { notes: a.notes.trim() } : {})
});

/** A van line's price from the phone's own copy: the wholesale price per piece times the unit's size. */
export const lineRupees = (p: Product, unit: string | null): number => pieceRupees(p) * unitFactor(p, unit);
export const lineTotalPaise = (l: FLine): number => Math.round(toPaise(lineRupees(l.product, l.unit_name)) * (Number(l.quantity) || 0));
