/* Buying for a wholesaler: purchase orders to a supplier (in the supplier's units: cartons, boxes), goods received against them (a delivery can be part of an order, with damaged items and batch and use-by dates), and paying the supplier. The server prices, numbers and updates stock; these only shape what is sent and read what comes back. */
import { toPaise } from './money.ts';
import { expiryFromMonth } from './pharmacy.ts';

export type POStatus = 'DRAFT' | 'ORDERED' | 'CONFIRMED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
export type PO = {
  po_id: number; po_number: string; po_date: string; status: POStatus; supplier_id: number; supplier: string; warehouse: string | null; subtotal: number; tax: number; total: number; paid: number; balance: number;
  payment_status: string; expected_date: string | null; notes: string | null; supplier_invoice_no: string | null; due_date: string | null; approved_by: string | null;
  items?: POItem[]; grns?: { grn_id: number; grn_number: string; grn_date: string; supplier_invoice_no: string | null; total_cost: number }[]; payments?: { payment_id: number; method: string; amount: number; reference: string | null; date: string }[];
};
export type POItem = {
  item_id: number; product_id: number; description: string; unit_name: string; unit_factor: number; base_unit: string | null; ordered: number; received: number; outstanding: number;
  batch_tracking: boolean; expiry_tracking: boolean; serial_tracking: boolean; unit_cost: number; tax_rate: number;
};
export type DueIn = { po_id: number; po_number: string; status: POStatus; expected_date: string | null; supplier: string; warehouse: string | null; lines: number; units: number };
export type Supplier = { supplier_id: number; name: string; phone: string | null; contact_person: string | null; payment_terms_days: number | null; outstanding?: number };
export type BuyProduct = {
  product_id: number; name: string; sku: string | null; unit: string | null; purchase_price: number; tax_rate: number; batch_tracking: boolean; expiry_tracking: boolean; serial_tracking: boolean;
  units?: { unit_name: string; factor: number; barcode: string | null }[];
};

export const PO_LABEL: Record<POStatus, string> = { DRAFT: 'Draft: not yet approved', ORDERED: 'Ordered', CONFIRMED: 'Confirmed by the supplier', PARTIAL: 'Part delivered', RECEIVED: 'Received', CANCELLED: 'Cancelled' };
export const isOpenPO = (s: POStatus): boolean => ['ORDERED', 'CONFIRMED', 'PARTIAL'].includes(s);

/** What can be done with an order, by where it is. Receiving is allowed on an ordered or part-delivered order. */
export const poActions = (s: POStatus): { id: 'approve' | 'send' | 'receive' | 'close' | 'cancel'; label: string }[] => {
  switch (s) {
    case 'DRAFT': return [{ id: 'approve', label: 'Approve and order' }, { id: 'cancel', label: 'Cancel order' }];
    case 'ORDERED': case 'CONFIRMED': return [{ id: 'receive', label: 'Receive goods' }, { id: 'send', label: 'Send to the supplier' }, { id: 'cancel', label: 'Cancel order' }];
    case 'PARTIAL': return [{ id: 'receive', label: 'Receive more goods' }, { id: 'close', label: 'Close: no more is coming' }, { id: 'send', label: 'Send to the supplier' }];
    default: return [];
  }
};

/* ── making an order ── */
export type BLine = { key: string; product: BuyProduct; unit_name: string | null; quantity: string; unit_cost: string };
let counter = 0;
const nextKey = () => `b${++counter}`;
export const addBLine = (lines: BLine[], product: BuyProduct, unit: string | null = null): BLine[] => {
  const have = lines.find((l) => l.product.product_id === product.product_id && l.unit_name === unit);
  if (have) return lines.map((l) => (l === have ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
  return [...lines, { key: nextKey(), product, unit_name: unit, quantity: '1', unit_cost: '' }];
};
export const setBQty = (lines: BLine[], key: string, quantity: string): BLine[] => lines.map((l) => (l.key === key ? { ...l, quantity } : l));
export const setBCost = (lines: BLine[], key: string, unit_cost: string): BLine[] => lines.map((l) => (l.key === key ? { ...l, unit_cost } : l));
export const setBUnit = (lines: BLine[], key: string, unit_name: string | null): BLine[] => lines.map((l) => (l.key === key ? { ...l, unit_name } : l));
export const dropBLine = (lines: BLine[], key: string): BLine[] => lines.filter((l) => l.key !== key);

/** The unit's size, for showing "1 carton = 24 pcs". */
export const factorOf = (p: BuyProduct, unit: string | null): number => (unit ? (p.units?.find((u) => u.unit_name === unit)?.factor ?? 1) : 1);
/** About what a line costs: the typed cost per unit, or the last price per piece times the unit's size; GST is added by the server. */
export const lineCostRupees = (l: BLine): number => (l.unit_cost.trim() !== '' ? Number(l.unit_cost) : l.product.purchase_price * factorOf(l.product, l.unit_name)) * (Number(l.quantity) || 0);
export const orderEstimatePaise = (lines: BLine[]): number => lines.reduce((a, l) => a + toPaise(lineCostRupees(l)), 0);

export const poProblem = (supplierId: number | null, lines: BLine[]): string => {
  if (!supplierId) return 'Choose the supplier first';
  const live = lines.filter((l) => Number(l.quantity) > 0);
  if (!live.length) return 'Add at least one product, with how many';
  if (live.some((l) => l.unit_cost.trim() !== '' && !(Number(l.unit_cost) >= 0))) return 'A cost is not a number';
  return '';
};
export const poBody = (supplierId: number, lines: BLine[], extra: { expected?: string; notes?: string } = {}) => ({
  supplier_id: supplierId,
  items: lines.filter((l) => Number(l.quantity) > 0).map((l) => ({ product_id: l.product.product_id, quantity: Number(l.quantity), ...(l.unit_name ? { unit_name: l.unit_name } : {}), ...(l.unit_cost.trim() !== '' ? { unit_cost: Number(l.unit_cost) } : {}) })),
  ...(extra.expected?.trim() ? { expected_date: extra.expected.trim() } : {}), ...(extra.notes?.trim() ? { notes: extra.notes.trim() } : {})
});

/* ── receiving goods ── */
export type RLine = {
  key: string; po_item_id: number | null; product_id: number; name: string; unit_name: string; ordered: number | null; outstanding: number | null;
  received: string; damaged: string; unit_cost: string; batch_no: string; expiry: string; mfg: string; batch_tracking: boolean; expiry_tracking: boolean; serial_tracking: boolean;
};

/** A delivery against an order starts as everything still due arriving, in the supplier's unit. */
export const linesFromPO = (po: PO): RLine[] =>
  (po.items ?? []).filter((i) => i.outstanding > 0).map((i) => ({
    key: `r${i.item_id}`, po_item_id: i.item_id, product_id: i.product_id, name: i.description, unit_name: i.unit_name, ordered: i.ordered, outstanding: i.outstanding,
    received: String(i.outstanding), damaged: '', unit_cost: '', batch_no: '', expiry: '', mfg: '', batch_tracking: i.batch_tracking, expiry_tracking: i.expiry_tracking, serial_tracking: i.serial_tracking
  }));

/** A line for a product bought with no order (a direct purchase). */
export const directLine = (p: BuyProduct, unit: string | null): RLine => ({
  key: nextKey(), po_item_id: null, product_id: p.product_id, name: p.name, unit_name: unit ?? p.unit ?? '', ordered: null, outstanding: null, received: '', damaged: '',
  unit_cost: unit ? '' : '', batch_no: '', expiry: '', mfg: '', batch_tracking: p.batch_tracking, expiry_tracking: p.expiry_tracking, serial_tracking: p.serial_tracking
});
export const editR = (lines: RLine[], key: string, patch: Partial<RLine>): RLine[] => lines.map((l) => (l.key === key ? { ...l, ...patch } : l));

export const acceptedOf = (l: RLine): number => Math.max(0, Math.round(((Number(l.received) || 0) - (Number(l.damaged) || 0)) * 1000) / 1000);

export const rLineProblem = (l: RLine, today: string, allowExcess: boolean): string => {
  const rec = Number(l.received); if (!(rec > 0)) return '';
  const dmg = Number(l.damaged || 0);
  if (!(dmg >= 0) || dmg > rec) return `${l.name}: damaged cannot be more than received`;
  if (l.unit_cost.trim() !== '' && !(Number(l.unit_cost) >= 0)) return `${l.name}: the cost is not a number`;
  if (l.po_item_id != null && !allowExcess && l.outstanding != null && acceptedOf(l) > l.outstanding + 1e-9) return `${l.name}: only ${l.outstanding} ${l.unit_name} is still due. Tick "accept extra" to take more.`;
  if (acceptedOf(l) > 0 && l.serial_tracking) return `${l.name}: needs serial numbers, which are entered on the website`;
  if (acceptedOf(l) > 0 && (l.batch_tracking || l.expiry_tracking) && !l.batch_no.trim()) return `${l.name}: enter the batch number`;
  if (acceptedOf(l) > 0 && l.expiry_tracking) {
    const e = expiryFromMonth(l.expiry);
    if (!e) return `${l.name}: enter the use-by date like 03/2027`;
    if (e < today) return `${l.name}: this batch is already expired`;
  }
  if (l.mfg.trim() && !expiryFromMonth(l.mfg)) return `${l.name}: the made-on date is not a date`;
  return '';
};

export const grnProblem = (lines: RLine[], today: string, allowExcess: boolean, supplierId: number | null, hasPO: boolean): string => {
  if (!hasPO && !supplierId) return 'Choose the supplier';
  const live = lines.filter((l) => Number(l.received) > 0);
  if (!live.length) return 'Enter how many arrived';
  for (const l of live) { const p = rLineProblem(l, today, allowExcess); if (p) return p; }
  if (!hasPO && live.some((l) => l.unit_cost.trim() === '')) return 'Enter what each item cost (there is no order to take it from)';
  return '';
};

export const grnBody = (a: { poId: number | null; supplierId: number | null; lines: RLine[]; invoiceNo: string; invoiceDate: string; allowExcess: boolean; closePO: boolean; paid: string; method: string; reference: string }) => ({
  ...(a.poId ? { po_id: a.poId } : { supplier_id: a.supplierId }),
  ...(a.invoiceNo.trim() ? { supplier_invoice_no: a.invoiceNo.trim() } : {}), ...(a.invoiceDate.trim() ? { supplier_invoice_date: a.invoiceDate.trim() } : {}),
  ...(a.allowExcess ? { allow_excess: true } : {}), ...(a.closePO ? { close_po: true } : {}),
  items: a.lines.filter((l) => Number(l.received) > 0).map((l) => ({
    ...(l.po_item_id ? { po_item_id: l.po_item_id } : {}), product_id: l.product_id, ...(l.po_item_id ? {} : { unit_name: l.unit_name }),
    received: Number(l.received), damaged: Number(l.damaged || 0), ...(l.unit_cost.trim() !== '' ? { unit_cost: Number(l.unit_cost) } : {}),
    ...(l.batch_no.trim() ? { batch_no: l.batch_no.trim() } : {}), ...(l.expiry.trim() ? { expiry_date: expiryFromMonth(l.expiry) } : {}), ...(l.mfg.trim() ? { mfg_date: expiryFromMonth(l.mfg) } : {})
  })),
  ...(Number(a.paid) > 0 ? { payment: { amount: Number(a.paid), method: a.method, ...(a.reference.trim() ? { reference_number: a.reference.trim() } : {}) } } : {})
});

/** What a delivery is short of what was ordered, for the line shown under an item: "3 carton still due". */
export const stillDue = (l: RLine): number => (l.outstanding == null ? 0 : Math.max(0, Math.round((l.outstanding - acceptedOf(l)) * 1000) / 1000));

/* ── paying the supplier ── */
export type PayMethod = 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CARD' | 'CHEQUE';
export const payProblem = (amount: string, balance: number): string => (!(Number(amount) > 0) ? 'Enter the amount paid' : Number(amount) > balance + 0.005 ? `That is more than the ${balance} still owed on this order` : '');
export const payBody = (amount: string, method: PayMethod, reference: string) => ({ amount: Number(amount), method, ...(reference.trim() ? { reference_number: reference.trim() } : {}) });
