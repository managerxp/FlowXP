/* Money out and goods back: returning items from a bill, logging an expense, receiving stock from a supplier. The choices a screen offers and the bodies it sends; the server does the sums. */
import { toPaise } from './money.ts';

export type ReturnLine = { item_id: number; description: string; quantity: number; remaining: number; unit_total: number; tax_rate: number; tracks_stock: boolean };
export type ReturnOptions = { can_issue: boolean; balance_due: number; refundable: number; items: ReturnLine[] };
export type Refund = 'CASH' | 'UPI' | 'CARD' | 'NONE';
export const REFUND_LABEL: Record<Refund, string> = { CASH: 'Cash back', UPI: 'UPI back', CARD: 'Card back', NONE: 'No money back' };

/** What a return sends: the chosen lines and how many, why, whether the goods go back on the shelf, and how any money is paid back. */
export const returnBody = (lines: ReturnLine[], chosen: Record<number, number>, reason: string, refund: Refund, restock: boolean) => ({
  reason: reason.trim(),
  items: lines.filter((l) => (chosen[l.item_id] ?? 0) > 0).map((l) => ({ item_id: l.item_id, quantity: Math.min(chosen[l.item_id], l.remaining) })),
  ...(refund === 'NONE' ? {} : { refund: { method: refund } }),
  restock
});

/** About what the customer gets back for the chosen lines (the server works out discount and GST exactly). */
export const returnEstimatePaise = (lines: ReturnLine[], chosen: Record<number, number>): number =>
  lines.reduce((a, l) => a + Math.round(toPaise(l.unit_total) * Math.min(chosen[l.item_id] ?? 0, l.remaining)), 0);

export const returnProblem = (lines: ReturnLine[], chosen: Record<number, number>, reason: string): string => {
  if (!lines.some((l) => (chosen[l.item_id] ?? 0) > 0)) return 'Choose at least one item to return';
  if (!reason.trim()) return 'Say why it is being returned';
  return '';
};

export const EXPENSE_CATEGORIES = ['Rent', 'Salary', 'Electricity', 'Supplies', 'Transport', 'Repairs', 'Other'];
export const EXPENSE_METHODS: { id: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER'; label: string }[] = [{ id: 'CASH', label: 'Cash' }, { id: 'UPI', label: 'UPI' }, { id: 'CARD', label: 'Card' }, { id: 'BANK_TRANSFER', label: 'Bank' }];
export type Expense = { expense_id: number; category: string; amount: number; payment_method: string; expense_date: string; description: string | null };

export const expenseProblem = (category: string, amount: string): string => {
  if (!category.trim()) return 'Choose what it was for';
  if (!(Number(amount) > 0)) return 'Enter the amount';
  return '';
};

export type Supplier = { supplier_id: number; name: string; phone: string | null; payable_balance: number; open_orders: number; last_po_date: string | null };
export type ReceiveLine = { product_id: number; name: string; quantity: string; unit_cost: string; tax_rate: number; expiry: string };

/** What receiving stock sends. A line with no quantity is left out; an expiry date goes only if typed. */
export const receiveBody = (lines: ReceiveLine[], supplierId: number | null, billNo: string, paid: string, method: string) => ({
  ...(supplierId ? { supplier_id: supplierId } : {}),
  ...(billNo.trim() ? { supplier_invoice_no: billNo.trim() } : {}),
  items: lines.filter((l) => Number(l.quantity) > 0).map((l) => ({
    product_id: l.product_id, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) || 0, tax_rate: l.tax_rate, ...(l.expiry.trim() ? { expiry_date: l.expiry.trim() } : {})
  })),
  ...(Number(paid) > 0 ? { payment: { amount: Number(paid), method } } : {})
});

export const receiveProblem = (lines: ReceiveLine[]): string => {
  const live = lines.filter((l) => Number(l.quantity) > 0);
  if (!live.length) return 'Add at least one item, with how many came';
  if (live.some((l) => l.unit_cost.trim() !== '' && !(Number(l.unit_cost) >= 0))) return 'The cost of an item is not a number';
  return '';
};

/** What this delivery comes to before GST, for the line at the bottom of the screen. */
export const receiveTotalPaise = (lines: ReceiveLine[]): number =>
  lines.reduce((a, l) => a + (Number(l.quantity) > 0 ? Math.round(Number(l.quantity) * toPaise(Number(l.unit_cost) || 0)) : 0), 0);
