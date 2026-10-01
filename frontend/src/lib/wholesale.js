/*
 * Helpers shared by the wholesale screens: loading and formatting (the same ones the salon screens use — one
 * implementation of "load this path", "make a query string" and "save a CSV"), the words and tones for every
 * status a wholesale document can be in, and a small CSV reader for imports.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from './api.js';

export { addDays, dateText, longDate, qs, saveCsv, todayIn, toNumber, useDebounced, useLoad } from './salon.js';

export const money = (n) => formatCurrency(n);
/** 1,234.5 — a quantity, never a currency. */
export const qty = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
export const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-IN')} ${Number(n) === 1 ? one : many}`;
export const pct = (n) => (n == null ? '—' : `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`);

/* ── statuses: label + tone for the Badge ─────────────────────────────────── */

export const ORDER_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' }, PENDING: { label: 'Pending approval', tone: 'warning' }, CONFIRMED: { label: 'Confirmed', tone: 'brand' },
  PARTIALLY_FULFILLED: { label: 'Partly shipped', tone: 'warning' }, FULFILLED: { label: 'Fulfilled', tone: 'success' }, PACKED: { label: 'Packed', tone: 'brand' },
  DISPATCHED: { label: 'Dispatched', tone: 'brand' }, DELIVERED: { label: 'Delivered', tone: 'success' }, CANCELLED: { label: 'Cancelled', tone: 'neutral' }
};
export const PICK_STATUS = {
  PENDING: { label: 'To pick', tone: 'warning' }, PICKING: { label: 'Picking', tone: 'warning' }, PICKED: { label: 'Picked', tone: 'brand' }, PACKING: { label: 'Packing', tone: 'brand' },
  PACKED: { label: 'Packed', tone: 'brand' }, DISPATCHED: { label: 'Dispatched', tone: 'success' }, CANCELLED: { label: 'Cancelled', tone: 'neutral' }
};
export const DELIVERY_STATUS = {
  PENDING: { label: 'Awaiting driver', tone: 'warning' }, ASSIGNED: { label: 'Assigned', tone: 'brand' }, OUT_FOR_DELIVERY: { label: 'Out for delivery', tone: 'brand' },
  DELIVERED: { label: 'Delivered', tone: 'success' }, FAILED: { label: 'Failed', tone: 'danger' }, RETURNED: { label: 'Returned', tone: 'neutral' }
};
export const PO_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' }, ORDERED: { label: 'Ordered', tone: 'brand' }, CONFIRMED: { label: 'Confirmed', tone: 'brand' }, PARTIAL: { label: 'Part received', tone: 'warning' },
  RECEIVED: { label: 'Received', tone: 'success' }, CANCELLED: { label: 'Cancelled', tone: 'neutral' }
};
export const TRANSFER_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' }, IN_TRANSIT: { label: 'In transit', tone: 'warning' }, RECEIVED: { label: 'Received', tone: 'success' }, CANCELLED: { label: 'Cancelled', tone: 'neutral' }
};
export const PAY_STATUS = { PAID: { label: 'Paid', tone: 'success' }, PARTIAL: { label: 'Part paid', tone: 'warning' }, UNPAID: { label: 'Unpaid', tone: 'danger' } };
export const CUSTOMER_TYPES = { RETAILER: 'Retailer', DEALER: 'Dealer', DISTRIBUTOR: 'Distributor', BUSINESS: 'Business', CORPORATE: 'Corporate', OTHER: 'Other' };
export const PAYMENT_METHODS = { CASH: 'Cash', UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CARD: 'Card', CHEQUE: 'Cheque', OTHER: 'Other' };
export const RETURN_REASONS = {
  DAMAGED: 'Damaged', WRONG_PRODUCT: 'Wrong product', EXCESS_QUANTITY: 'Excess quantity', EXPIRED: 'Expired', CUSTOMER_REJECTION: 'Customer rejection', QUALITY: 'Quality issue', OTHER: 'Other'
};
export const PRICE_SOURCE = { CUSTOMER: 'Customer price', LIST: 'Price list', PROMOTION: 'Promotion', MANUAL: 'Set by hand' };
export const priceSourceText = (src) => {
  if (!src) return '';
  const [base, ...rest] = String(src).split('+');
  const label = PRICE_SOURCE[base] || (base.startsWith('TIER:') ? `${CUSTOMER_TYPES[base.slice(5)] || base.slice(5)} price` : base);
  return rest.includes('DISC') ? `${label} less standing discount` : label;
};

/* ── data ─────────────────────────────────────────────────────────────────── */

/** The warehouses this person can use: [{ branch_id, name, ... }]. */
export const useWarehouses = () => {
  const [rows, setRows] = useState(null);
  useEffect(() => { let live = true; api('/wholesale/warehouses').then((r) => { if (live) setRows(r); }).catch(() => { if (live) setRows([]); }); return () => { live = false; }; }, []);
  return rows;
};

/** Every page of a paged list, for an export. */
export const fetchAll = async (path, { pageSize = 200, max = 20000 } = {}) => {
  const out = []; let offset = 0;
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await api(`${path}${sep}limit=${pageSize}&offset=${offset}`, { withMeta: true });
    out.push(...page.data);
    offset += pageSize;
    if (offset >= (page.meta?.total ?? 0) || out.length >= max) break;
  }
  return out;
};

/* ── CSV (for imports) ────────────────────────────────────────────────────── */

/** Parse CSV text into rows of { header: value }. Handles quotes, commas and newlines inside quotes, and a BOM. */
export const parseCsv = (input) => {
  const text = String(input).replace(/^﻿/, '');
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => String(x).trim() !== ''));
  if (!head) return [];
  const keys = head.map((h) => String(h).trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
};

export const CSV_TEMPLATES = {
  products: { file: 'products-template.csv', columns: ['Name', 'SKU', 'Barcode', 'Unit', 'Category', 'HSN', 'Tax Rate', 'Purchase Price', 'Wholesale Price', 'Distributor Price', 'Retailer Price', 'MRP', 'MOQ', 'Reorder Level', 'Max Stock', 'Batch Tracking', 'Expiry Tracking', 'Unit 1 Name', 'Unit 1 Factor', 'Unit 2 Name', 'Unit 2 Factor', 'Opening Stock', 'Warehouse', 'Batch No', 'Expiry Date'],
    sample: ['Parle-G 100g', 'PARLEG100', '8901719101012', 'pcs', 'Biscuits', '1905', '18', '4.20', '5.00', '4.80', '5.50', '5.00', '12', '240', '5000', 'yes', 'yes', 'box', '12', 'carton', '288', '2880', '', 'B2401', '2026-12-31'] },
  customers: { file: 'customers-template.csv', columns: ['Name', 'Phone', 'Email', 'GSTIN', 'PAN', 'Type', 'Contact Person', 'Address', 'City', 'State', 'Pincode', 'Shipping Address', 'Payment Terms Days', 'Credit Limit', 'Opening Balance', 'Salesperson', 'Price List', 'Discount Pct'],
    sample: ['Sharma General Store', '9876543210', 'sharma@example.com', '36ABCDE1234F1Z5', 'ABCDE1234F', 'RETAILER', 'Mr Sharma', '12 Main Road', 'Hyderabad', 'Telangana', '500001', '', '30', '50000', '0', '', '', '0'] },
  suppliers: { file: 'suppliers-template.csv', columns: ['Name', 'Phone', 'Email', 'GSTIN', 'PAN', 'Contact Person', 'Address', 'City', 'State', 'Pincode', 'Payment Terms Days', 'Opening Balance', 'Bank Details'],
    sample: ['Acme Foods Pvt Ltd', '9123456780', 'sales@acme.example', '27AAPFU0939F1ZV', '', 'Ms Rao', 'Plot 4, MIDC', 'Pune', 'Maharashtra', '411019', '45', '0', 'HDFC 5010 0123 4567 IFSC HDFC0000123'] }
};

/** Download an empty CSV with the right headers and one sample row. */
export const downloadTemplate = (kind) => {
  const t = CSV_TEMPLATES[kind];
  const cell = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const blob = new Blob([`﻿${t.columns.map(cell).join(',')}\n${t.sample.map(cell).join(',')}\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = t.file; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
};
