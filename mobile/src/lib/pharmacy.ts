/* The pharmacy till and stock: medicines with batches and use-by dates, a bill the server prices (earliest expiry first), receiving a delivery (GRN), and batch status. The server decides; these only shape and check what a person typed. */
import { toPaise } from './money.ts';
import type { Product } from './catalog.ts';

export type Medicine = {
  product_id: number; name: string; sku: string | null; barcode: string | null; unit: string | null; selling_price: number; mrp: number | null; tax_rate: number; manufacturer: string | null;
  strength: string | null; dosage_form: string | null; salt_composition: string | null; schedule_class: string | null;
  batch_tracking: boolean; expiry_tracking: boolean; prescription_required: boolean; track_inventory: boolean; available?: number; on_hand?: number; low?: boolean;
};
export type Batch = { batch_id: number; product_id: number; product: string; unit: string | null; batch_no: string; mfg_date: string | null; expiry_date: string | null; qty_on_hand: number; cost: number; status: 'ACTIVE' | 'QUARANTINED' | 'RECALLED' | 'BLOCKED'; branch: string };
export type PLine = { key: string; product: Medicine; quantity: number; batch: Batch | null };
export type PharmacyQuote = {
  invoice: { subtotal: number; discount: number; tax: number; total: number; invoice_id?: number };
  lines: { product_id: number; name: string; quantity: number; unit_price: number; line_total: number; batches: { batch_id: number; qty: number }[] }[];
};

let counter = 0;
const nextKey = () => `p${++counter}`;

/** Add a medicine to the bill, or one more of it if it is already there (a medicine from a chosen batch is its own line). */
export const addMedicine = (lines: PLine[], product: Medicine, quantity = 1): PLine[] => {
  const have = lines.find((l) => l.product.product_id === product.product_id && !l.batch);
  return have ? lines.map((l) => (l === have ? { ...l, quantity: l.quantity + quantity } : l)) : [...lines, { key: nextKey(), product, quantity, batch: null }];
};
export const setQuantity = (lines: PLine[], key: string, quantity: number): PLine[] => (quantity <= 0 ? lines.filter((l) => l.key !== key) : lines.map((l) => (l.key === key ? { ...l, quantity } : l)));
export const removeLine = (lines: PLine[], key: string): PLine[] => lines.filter((l) => l.key !== key);
/** Sell from one chosen batch instead of the earliest-expiry one (null goes back to automatic). */
export const pickBatch = (lines: PLine[], key: string, batch: Batch | null): PLine[] => lines.map((l) => (l.key === key ? { ...l, batch } : l));

/** What can be sold from a batch: it is active, not past its date, and has stock. */
export const sellable = (b: Batch, today: string): boolean => b.status === 'ACTIVE' && b.qty_on_hand > 0 && (!b.expiry_date || String(b.expiry_date).slice(0, 10) >= today);

/** About what the bill comes to at the shelf price (the quote is exact, with GST). */
export const roughPaise = (lines: PLine[]): number => lines.reduce((a, l) => a + Math.round(toPaise(l.product.selling_price) * l.quantity), 0);

export const itemsBody = (lines: PLine[]) => lines.map((l) => ({ product_id: l.product.product_id, quantity: l.quantity, ...(l.batch ? { batch_id: l.batch.batch_id } : {}) }));

/** The server reads the client as customerId (camel case) on the pharmacy till. */
export const quoteBody = (lines: PLine[], customerId: number | null) => ({ items: itemsBody(lines), ...(customerId ? { customerId } : {}) });

/** The sale. A prescription medicine on it is sent with the fact that the prescription was checked (the server refuses it otherwise); a sale made with
    no connection also says what total the customer was shown, so the server can flag a price that changed since the phone last synced. */
export const saleBody = (lines: PLine[], customerId: number | null, method: string, reference: string, notes: string, extra: { rxChecked?: boolean; expectedTotal?: number; payNowPaise?: number | null } = {}) => ({
  ...quoteBody(lines, customerId),
  // payNowPaise: none = the whole bill; 0 = nothing now (left unpaid, the customer's credit); else that much now and the rest is owed
  payments: extra.payNowPaise === 0 ? [] : [{ method, amount: extra.payNowPaise ? extra.payNowPaise / 100 : 'FULL', ...(reference.trim() ? { reference_number: reference.trim() } : {}) }],
  ...(notes.trim() ? { notes: notes.trim() } : {}),
  ...(extra.rxChecked && rxLines(lines).length ? { prescription_checked: true } : {}),
  ...(extra.expectedTotal != null ? { expected_total: extra.expectedTotal } : {})
});

/* ── with no internet ── */

/** A medicine as the till shows it, from the phone's own copy of the catalogue (price, stock hint, and what it is). */
export const fromProduct = (p: Product): Medicine => ({
  product_id: p.product_id, name: p.name, sku: p.sku, barcode: p.barcodes?.[0] ?? null, unit: p.unit, selling_price: p.selling_price, mrp: p.mrp, tax_rate: p.tax_rate,
  manufacturer: p.pharmacy?.manufacturer ?? null, strength: p.pharmacy?.strength ?? null, dosage_form: p.pharmacy?.dosage_form ?? null, salt_composition: p.pharmacy?.salt_composition ?? null,
  schedule_class: p.pharmacy?.schedule_class ?? null, batch_tracking: Boolean(p.pharmacy?.batch_tracking), expiry_tracking: Boolean(p.pharmacy?.expiry_tracking),
  prescription_required: Boolean(p.pharmacy?.prescription_required), track_inventory: p.track_inventory, available: p.current_stock ?? undefined
});

/** About what the bill comes to with GST added on the shelf price (the server's own figure replaces it when the sale arrives). */
export const estimate = (lines: PLine[]): { subtotalPaise: number; taxPaise: number; totalPaise: number } => {
  let subtotal = 0; let tax = 0;
  for (const l of lines) { const line = Math.round(toPaise(l.product.selling_price) * l.quantity); subtotal += line; tax += Math.round(line * (l.product.tax_rate / 100)); }
  return { subtotalPaise: subtotal, taxPaise: tax, totalPaise: subtotal + tax };
};

/** What the provisional receipt of a queued bill shows. */
export const previewOf = (lines: PLine[], method: string, paidPaise?: number | null) => {
  const t = estimate(lines);
  return { lines: lines.map((l) => ({ name: l.product.name, quantity: l.quantity, unitPricePaise: toPaise(l.product.selling_price) })), subtotalPaise: t.subtotalPaise, taxPaise: t.taxPaise, totalPaise: t.totalPaise, method, ...(paidPaise != null ? { paidPaise } : {}) };
};

/** Prescription medicines on the bill, to be checked before they are handed over. */
export const rxLines = (lines: PLine[]): PLine[] => lines.filter((l) => l.product.prescription_required);

/** The note kept on a bill with prescription medicines: that the prescription was seen, and whose it is. */
export const rxNote = (lines: PLine[], doctor: string, patient: string): string =>
  rxLines(lines).length ? `Prescription checked${doctor.trim() ? `. Doctor: ${doctor.trim()}` : ''}${patient.trim() ? `. Patient: ${patient.trim()}` : ''}` : '';

export const pharmacyProblem = (lines: PLine[], rxChecked: boolean): string => {
  if (!lines.length) return 'Add at least one medicine to the bill';
  if (rxLines(lines).length && !rxChecked) return 'Check the prescription for the marked medicines first';
  return '';
};

/** A warning before the server says it: more asked for than is on the shelf. */
export const shortBy = (l: PLine): number => (l.product.track_inventory && l.product.available != null && l.quantity > l.product.available ? Math.round((l.quantity - l.product.available) * 1000) / 1000 : 0);

/* ── use-by dates ── */
export const isRealDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** "Mar 2027" style: a month and year typed as 03/2027 or 3/27 or 2027-03 becomes the last day of that month, which is how medicines are dated. */
export const expiryFromMonth = (text: string): string | null => {
  const t = text.trim();
  let m = /^(\d{1,2})[/-](\d{4}|\d{2})$/.exec(t); let y: number; let mo: number;
  if (m) { mo = Number(m[1]); y = Number(m[2].length === 2 ? `20${m[2]}` : m[2]); }
  else { m = /^(\d{4})-(\d{1,2})$/.exec(t); if (!m) return isRealDate(t) ? t : null; y = Number(m[1]); mo = Number(m[2]); }
  if (mo < 1 || mo > 12) return null;
  const last = new Date(y, mo, 0).getDate();
  return `${y}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
};

export const daysTo = (iso: string, today: string): number => Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
export const expiryText = (iso: string | null, today: string): string => {
  if (!iso) return 'No use-by date';
  const d = daysTo(iso, today);
  return d < 0 ? `Expired ${-d} day${d === -1 ? '' : 's'} ago` : d === 0 ? 'Last day today' : d <= 90 ? `${d} days left` : `Use by ${iso.slice(0, 10)}`;
};

/* ── receiving a delivery (GRN) ── */
export type GrnLine = { product: Medicine; received: string; damaged: string; unit_cost: string; batch_no: string; expiry: string; mfg: string };
export const newGrnLine = (product: Medicine): GrnLine => ({ product, received: '', damaged: '', unit_cost: '', batch_no: '', expiry: '', mfg: '' });

export const grnLineProblem = (l: GrnLine, today: string): string => {
  const rec = Number(l.received); if (!(rec > 0)) return '';
  const name = l.product.name;
  const dmg = Number(l.damaged || 0);
  if (!(dmg >= 0) || dmg > rec) return `${name}: damaged cannot be more than received`;
  if (!(Number(l.unit_cost) >= 0) || l.unit_cost.trim() === '') return `${name}: enter the cost of one`;
  const accepted = rec - dmg;
  if (accepted > 0 && (l.product.batch_tracking || l.product.expiry_tracking) && !l.batch_no.trim()) return `${name}: enter the batch number`;
  if (accepted > 0 && l.product.expiry_tracking) {
    const e = expiryFromMonth(l.expiry);
    if (!e) return `${name}: enter the use-by date like 03/2027`;
    if (e < today) return `${name}: this batch is already expired`;
    const m = l.mfg.trim() ? expiryFromMonth(l.mfg) : null;
    if (l.mfg.trim() && !m) return `${name}: the made-on date is not a date`;
  }
  return '';
};

export const grnProblem = (lines: GrnLine[], supplierId: number | null, today: string): string => {
  if (!supplierId) return 'Choose the supplier';
  const live = lines.filter((l) => Number(l.received) > 0);
  if (!live.length) return 'Add at least one medicine, with how many came';
  for (const l of live) { const p = grnLineProblem(l, today); if (p) return p; }
  return '';
};

export const grnBody = (lines: GrnLine[], supplierId: number, invoiceNo: string, paid: string, method: string) => ({
  supplier_id: supplierId,
  ...(invoiceNo.trim() ? { supplier_invoice_no: invoiceNo.trim() } : {}),
  items: lines.filter((l) => Number(l.received) > 0).map((l) => ({
    product_id: l.product.product_id, received: Number(l.received), damaged: Number(l.damaged || 0), unit_cost: Number(l.unit_cost), tax_rate: l.product.tax_rate,
    ...(l.batch_no.trim() ? { batch_no: l.batch_no.trim() } : {}),
    ...(l.expiry.trim() ? { expiry_date: expiryFromMonth(l.expiry) } : {}),
    ...(l.mfg.trim() ? { mfg_date: expiryFromMonth(l.mfg) } : {})
  })),
  ...(Number(paid) > 0 ? { payment: { amount: Number(paid), method } } : {})
});

/* ── batch status ── */
export const BATCH_LABEL: Record<Batch['status'], string> = { ACTIVE: 'On sale', QUARANTINED: 'Held back', RECALLED: 'Recalled', BLOCKED: 'Blocked' };
export const batchActions = (s: Batch['status']): { to: Batch['status']; label: string; warn?: string }[] =>
  s === 'ACTIVE'
    ? [{ to: 'QUARANTINED', label: 'Hold back', warn: 'It is taken off sale until you put it back.' }, { to: 'RECALLED', label: 'Recall', warn: 'It is taken off sale as recalled by the maker.' }, { to: 'BLOCKED', label: 'Block', warn: 'It is blocked from sale.' }]
    : [{ to: 'ACTIVE', label: 'Put back on sale' }];
