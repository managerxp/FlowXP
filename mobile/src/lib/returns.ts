/* Returns, both ways, for a wholesaler: a shop sends goods back (a credit note on their bill, and what happens to the goods), or goods go back to a supplier (a debit note, less owed to them). The server works out tax and balances exactly; these only shape what is sent and check what a person typed. */
import { toPaise } from './money.ts';

export type Reason = 'DAMAGED' | 'WRONG_PRODUCT' | 'EXCESS_QUANTITY' | 'EXPIRED' | 'CUSTOMER_REJECTION' | 'QUALITY' | 'OTHER';
export const REASON_LABEL: Record<Reason, string> = { DAMAGED: 'Damaged', WRONG_PRODUCT: 'Wrong product', EXCESS_QUANTITY: 'Too many sent', EXPIRED: 'Expired', CUSTOMER_REJECTION: 'The shop refused it', QUALITY: 'Quality problem', OTHER: 'Other' };
export const REASONS = Object.keys(REASON_LABEL) as Reason[];
export type Disposition = 'RESTOCK' | 'DAMAGED' | 'EXPIRED' | 'NONE';
export const DISPOSITION_LABEL: Record<Disposition, string> = { RESTOCK: 'Back on the shelf', DAMAGED: 'Damaged: not for sale', EXPIRED: 'Expired', NONE: 'Not coming back to us' };

export type ReturnRow = {
  return_id: number; return_number: string; kind: 'SALE' | 'PURCHASE'; reason: Reason; notes: string | null; created_at: string; invoice_number: string | null; cn_number: string | null; cn_total: number | null;
  po_number: string | null; dn_number: string | null; dn_total: number | null; customer: string | null; supplier: string | null;
};
export type ReturnDetail = ReturnRow & { items: { product: string; quantity: number; unit_name: string | null; disposition: Disposition; batch_no: string | null }[] };
export type InvoiceRow = { invoice_id: number; invoice_number: string; invoice_date: string; total: number; balance_due: number; payment_status: string; status: string };
export type ReturnableItem = {
  item_id: number; product_id: number; description: string; unit_name: string | null; quantity: number; credited: number; returnable: number; unit_price: number; tax_rate: number; tracks_stock: boolean;
  batches: { batch_id: number; batch_no: string; expiry_date: string | null; qty_base: number }[];
};
export type Returnable = { invoice_id: number; invoice_number: string; status: string; balance_due: number; items: ReturnableItem[] };

/* ── a shop sends goods back ── */
export type SLine = { item: ReturnableItem; qty: string; disposition: Disposition; batchId: number | null };
export const defaultDisposition = (r: Reason | null): Disposition => (r === 'DAMAGED' ? 'DAMAGED' : r === 'EXPIRED' ? 'EXPIRED' : 'RESTOCK');
export const startLines = (r: Returnable, reason: Reason | null): SLine[] => r.items.filter((i) => i.returnable > 0).map((item) => ({ item, qty: '', disposition: defaultDisposition(reason), batchId: item.batches.length === 1 ? item.batches[0].batch_id : null }));
export const editS = (lines: SLine[], itemId: number, patch: Partial<SLine>): SLine[] => lines.map((l) => (l.item.item_id === itemId ? { ...l, ...patch } : l));
/** Changing the reason moves lines the person has not touched to the usual place for that reason (damaged goods are not restocked). */
export const withReason = (lines: SLine[], from: Reason | null, to: Reason): SLine[] => lines.map((l) => (l.disposition === defaultDisposition(from) ? { ...l, disposition: defaultDisposition(to) } : l));

/** Goods put back on the shelf from a batch-tracked item must say which batch when the bill took them from several. */
export const needsBatch = (l: SLine): boolean => l.item.tracks_stock && l.disposition === 'RESTOCK' && l.item.batches.length > 1 && l.batchId == null;

export const salesReturnProblem = (lines: SLine[], reason: Reason | null): string => {
  if (!reason) return 'Say why it is coming back';
  const live = lines.filter((l) => Number(l.qty) > 0);
  if (!live.length) return 'Enter how many of what is coming back';
  for (const l of live) {
    if (Number(l.qty) > l.item.returnable + 1e-9) return `${l.item.description}: only ${l.item.returnable} ${l.item.unit_name ?? ''} can still be returned`.replace(/\s+$/, '');
    if (needsBatch(l)) return `${l.item.description}: choose which batch it belongs to`;
  }
  return '';
};
export const salesReturnBody = (invoiceId: number, lines: SLine[], reason: Reason, notes: string, refundMethod: string | null) => ({
  invoice_id: invoiceId, reason, ...(notes.trim() ? { notes: notes.trim() } : {}),
  items: lines.filter((l) => Number(l.qty) > 0).map((l) => ({ invoice_item_id: l.item.item_id, quantity: Number(l.qty), disposition: l.disposition, ...(l.batchId ? { batch_id: l.batchId } : {}) })),
  ...(refundMethod ? { refund: { method: refundMethod } } : {})
});
/** About what the credit note comes to (price and GST of what is coming back; the server's figure, with discounts, replaces it). */
export const creditEstimatePaise = (lines: SLine[]): number => lines.reduce((a, l) => { const q = Number(l.qty) || 0; const net = Math.round(toPaise(l.item.unit_price) * q); return a + net + Math.round(net * l.item.tax_rate / 100); }, 0);

/* ── goods go back to a supplier ── */
export type PRItem = { item_id: number; description: string; unit_name: string; received: number; product_id: number };
export type PRLine = { item: PRItem; qty: string };
export const startPurchaseLines = (items: PRItem[]): PRLine[] => items.filter((i) => i.received > 0).map((item) => ({ item, qty: '' }));
export const editP = (lines: PRLine[], itemId: number, qty: string): PRLine[] => lines.map((l) => (l.item.item_id === itemId ? { ...l, qty } : l));
export const purchaseReturnProblem = (lines: PRLine[], reason: Reason | null): string => {
  if (!reason) return 'Say why it is going back';
  const live = lines.filter((l) => Number(l.qty) > 0);
  if (!live.length) return 'Enter how many are going back';
  const over = live.find((l) => Number(l.qty) > l.item.received + 1e-9);
  return over ? `${over.item.description}: only ${over.item.received} ${over.item.unit_name} arrived` : '';
};
export const purchaseReturnBody = (poId: number, lines: PRLine[], reason: Reason, notes: string) => ({
  po_id: poId, reason, ...(notes.trim() ? { notes: notes.trim() } : {}), items: lines.filter((l) => Number(l.qty) > 0).map((l) => ({ po_item_id: l.item.item_id, quantity: Number(l.qty) }))
});

export const REFUNDS = [{ id: '', label: 'No money back: take it off what they owe' }, { id: 'CASH', label: 'Cash back' }, { id: 'UPI', label: 'UPI back' }, { id: 'BANK_TRANSFER', label: 'Bank transfer' }];
/** A one-line summary of what a return did, from the server's answer. */
export const sentence = (r: { return_number: string; credit_note_total?: number; refunded?: number; unrefunded?: number; debit_note_total?: number; credit_with_supplier?: number }, money: (n: number) => string): string =>
  r.credit_note_total != null
    ? `${r.return_number}: credit note for ${money(r.credit_note_total)}${r.refunded ? `, ${money(r.refunded)} paid back` : ''}${r.unrefunded && r.unrefunded > 0 ? `, ${money(r.unrefunded)} kept as credit` : ''}.`
    : `${r.return_number}: debit note for ${money(r.debit_note_total ?? 0)}${r.credit_with_supplier ? `, ${money(r.credit_with_supplier)} credit with the supplier` : ''}. Stock is taken off.`;
