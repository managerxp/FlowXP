/* Wholesale and distribution: customers who buy on credit, sales orders priced for each customer, and collecting what they owe. The server prices, checks credit and reserves stock; these only shape what is sent and read what comes back. */
import { toPaise } from './money.ts';

export type Credit = { limit: number; outstanding: number; overdue?: number; available: number | null; level?: 'OK' | 'WARN' | 'BLOCK' | string; reasons?: string[]; utilization_pct?: number | null };
export type WCustomer = {
  customer_id: number; name: string; phone: string | null; gstin: string | null; customer_type: string; city: string | null; contact_person: string | null;
  credit_limit: number; payment_terms_days: number | null; salesperson: string | null; price_list: string | null; price_list_id?: number | null; outstanding?: number; overdue?: number; total_invoiced?: number; credit?: Credit;
};
export type OpenInvoice = { invoice_id: number; invoice_number: string; invoice_date: string; due_date: string; days_overdue: number; total: number; balance: number };
export type LedgerLine = { date: string; type: string; ref: string | null; description: string | null; debit: number; credit: number; balance: number };

export type WProduct = {
  product_id: number; name: string; sku: string | null; unit: string | null; selling_price: number; wholesale_price: number; tax_rate: number; moq: number; available?: number; on_hand?: number;
  track_inventory: boolean; units?: { unit_name: string; factor: number; barcode: string | null }[]; pack_size?: string | null;
};
export type WLine = { key: string; product: WProduct; unit_name: string | null; quantity: string };
export type WPreviewLine = { line_no: number; product_id: number; product: string; unit_name: string; quantity: number; price: number; price_source: string; discount_pct: number; tax_rate: number; is_free: boolean; line_total: number; available: number; short: number };
export type WPreview = {
  lines: WPreviewLine[]; subtotal: number; tax: number; total: number; approval_needed: boolean; scheme_discount: number;
  schemes: { scheme: string; kind: string; discount: number }[]; scheme_hints?: string[];
  credit: { level: string; reasons: string[]; limit: number; outstanding: number; available: number | null };
};
export type WOrderStatus = 'DRAFT' | 'PENDING' | 'CONFIRMED' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'PACKED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED' | 'REJECTED';
export type WOrder = {
  order_id: number; order_number: string; order_date: string; status: WOrderStatus; customer_id: number; customer: string; customer_phone: string | null; total: number; subtotal: number; tax: number;
  lines?: number; expected_delivery: string | null; customer_po: string | null; notes: string | null; approval_needed: boolean; cancel_reason: string | null; reject_reason: string | null; payment_terms_days: number | null;
  items?: { item_id: number; product: string; quantity: number; unit_name: string; price: number; discount_pct: number; tax_rate: number; is_free: boolean; reserved: number; shipped: number; open: number; backorder: number }[];
  shipments?: { challan_number: string | null; status: string; invoice_number: string | null; total_paise: number | null }[];
  credit?: { level: string; reasons: string[]; limit: number; outstanding: number; available: number | null } | null;
};

export const STATUS_LABEL: Record<WOrderStatus, string> = {
  DRAFT: 'Draft', PENDING: 'Waiting for approval', CONFIRMED: 'Confirmed', PARTIALLY_FULFILLED: 'Part sent', FULFILLED: 'Sent', PACKED: 'Packed', DISPATCHED: 'On the way', DELIVERED: 'Delivered', CANCELLED: 'Cancelled', REJECTED: 'Turned down'
};
/** Orders still being worked, and ones that are finished (for the list's two tabs). */
export const OPEN_STATUSES: WOrderStatus[] = ['DRAFT', 'PENDING', 'CONFIRMED', 'PARTIALLY_FULFILLED', 'PACKED', 'DISPATCHED'];
export const isOpen = (s: WOrderStatus): boolean => OPEN_STATUSES.includes(s);

/** What a person can do next with an order, in the words the screen shows. Cancelling is possible only before anything was sent. */
export const orderActions = (o: Pick<WOrder, 'status'>): { id: 'submit' | 'confirm' | 'cancel'; label: string }[] => {
  switch (o.status) {
    case 'DRAFT': return [{ id: 'submit', label: 'Send for approval' }, { id: 'confirm', label: 'Confirm' }, { id: 'cancel', label: 'Cancel order' }];
    case 'PENDING': return [{ id: 'confirm', label: 'Confirm' }, { id: 'cancel', label: 'Cancel order' }];
    case 'CONFIRMED': return [{ id: 'cancel', label: 'Cancel order' }];
    default: return [];
  }
};

/* ── building an order ── */
let counter = 0;
const nextKey = () => `w${++counter}`;

/** Add a product (a second tap on the same product and unit adds one more). */
export const addLine = (lines: WLine[], product: WProduct, unit: string | null = null): WLine[] => {
  const have = lines.find((l) => l.product.product_id === product.product_id && l.unit_name === unit);
  if (have) return lines.map((l) => (l === have ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
  return [...lines, { key: nextKey(), product, unit_name: unit, quantity: String(Math.max(1, product.moq || 1)) }];
};
export const setQty = (lines: WLine[], key: string, quantity: string): WLine[] => lines.map((l) => (l.key === key ? { ...l, quantity } : l));
export const setUnit = (lines: WLine[], key: string, unit: string | null): WLine[] => lines.map((l) => (l.key === key ? { ...l, unit_name: unit } : l));
export const dropLine = (lines: WLine[], key: string): WLine[] => lines.filter((l) => l.key !== key);

export const linesBody = (lines: WLine[]) => lines.filter((l) => Number(l.quantity) > 0).map((l) => ({ product_id: l.product.product_id, quantity: Number(l.quantity), ...(l.unit_name ? { unit_name: l.unit_name } : {}) }));

export const previewBody = (customerId: number, lines: WLine[]) => ({ customer_id: customerId, lines: linesBody(lines) });

export const orderBody = (customerId: number, lines: WLine[], extra: { submit?: boolean; customerPo?: string; notes?: string; expectedDelivery?: string } = {}) => ({
  customer_id: customerId, lines: linesBody(lines),
  ...(extra.submit ? { submit: true } : {}),
  ...(extra.customerPo?.trim() ? { customer_po: extra.customerPo.trim() } : {}),
  ...(extra.notes?.trim() ? { notes: extra.notes.trim() } : {}),
  ...(extra.expectedDelivery?.trim() ? { expected_delivery: extra.expectedDelivery.trim() } : {})
});

export const orderProblem = (customerId: number | null, lines: WLine[]): string => {
  if (!customerId) return 'Choose the customer first';
  if (!lines.some((l) => Number(l.quantity) > 0)) return 'Add at least one product, with how many';
  const below = lines.find((l) => Number(l.quantity) > 0 && Number(l.quantity) < (l.product.moq || 0) && !l.unit_name);
  if (below) return `${below.product.name}: the minimum order is ${below.product.moq} ${below.product.unit ?? ''}`.trim();
  return '';
};

/** Shorthand for a line the customer asked for more of than the warehouse can cover right now. */
export const shortLines = (p: WPreview | null): WPreviewLine[] => (p ? p.lines.filter((l) => l.short > 0) : []);

/** Credit in a few plain words: fine, near the limit, or over it. */
export const creditText = (c: { level: string; reasons: string[]; limit: number; outstanding: number; available: number | null } | null | undefined): { tone: 'ok' | 'warn' | 'bad'; text: string } => {
  if (!c) return { tone: 'ok', text: '' };
  const tone = c.level === 'BLOCK' ? 'bad' : c.level === 'WARN' ? 'warn' : 'ok';
  return { tone, text: c.reasons?.length ? c.reasons.join('. ') : tone === 'ok' ? 'Within the credit limit' : 'Check the credit limit' };
};

/* ── collecting money ── */
export type Method = 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CARD' | 'CHEQUE';
export const METHOD_LABEL: Record<Method, string> = { CASH: 'Cash', UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CARD: 'Card', CHEQUE: 'Cheque' };
export const needsReference = (m: Method): boolean => m === 'UPI' || m === 'BANK_TRANSFER' || m === 'CHEQUE';

export const collectProblem = (customerId: number | null, amount: string, method: Method, reference: string): string => {
  if (!customerId) return 'Choose the customer first';
  if (!(Number(amount) > 0)) return 'Enter the amount received';
  if (needsReference(method) && !reference.trim()) return method === 'CHEQUE' ? 'Enter the cheque number' : 'Enter the transaction reference';
  return '';
};

export const collectBody = (customerId: number, amount: string, method: Method, reference: string, extra: { chequeDate?: string; bank?: string; notes?: string; invoiceId?: number | null } = {}) => ({
  customer_id: customerId, amount: Number(amount), method,
  ...(reference.trim() ? { reference: reference.trim() } : {}),
  ...(method === 'CHEQUE' && extra.chequeDate?.trim() ? { cheque_date: extra.chequeDate.trim() } : {}),
  ...(extra.bank?.trim() ? { bank: extra.bank.trim() } : {}),
  ...(extra.notes?.trim() ? { notes: extra.notes.trim() } : {}),
  // paying one particular invoice puts it all there; otherwise the oldest invoices are settled first and any extra is kept as an advance
  ...(extra.invoiceId ? { allocations: [{ invoice_id: extra.invoiceId, amount: Number(amount) }] } : { allocate: 'OLDEST' })
});

/** How a payment will be spread over what is owed, oldest first, and what is left over (kept as the customer's advance). */
export const spread = (open: OpenInvoice[], amount: number): { invoice: OpenInvoice; pay: number }[] & { advance?: number } => {
  let left = Math.round(amount * 100); const out: { invoice: OpenInvoice; pay: number }[] & { advance?: number } = [];
  for (const inv of open) {
    if (left <= 0) break;
    const take = Math.min(left, Math.round(inv.balance * 100));
    if (take > 0) { out.push({ invoice: inv, pay: take / 100 }); left -= take; }
  }
  out.advance = left / 100;
  return out;
};

export const owedPaise = (c: Pick<WCustomer, 'outstanding'>): number => toPaise(c.outstanding ?? 0);

export const ledgerText = (l: LedgerLine): string => `${l.type.replace(/_/g, ' ').toLowerCase()}${l.ref ? ` ${l.ref}` : ''}${l.description ? `: ${l.description}` : ''}`;
