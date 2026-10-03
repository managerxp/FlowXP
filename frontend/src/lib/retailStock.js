/* Shared by the stock center, receiving and counting screens (supermarket / retail). */
import { api } from './api.js';
import { localISO } from './dates.js';
import { catalogInfo, localLookup } from './posCatalog.js';

export const qty = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** "in 3 days", "today", "2 days ago" for a days-left number; the tone says whether to worry. */
export const expiryText = (days) => {
  if (days == null) return '';
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} ago`;
  if (days === 0) return 'today';
  return `in ${days} day${days === 1 ? '' : 's'}`;
};
export const expiryTone = (days) => (days == null ? 'neutral' : days < 0 ? 'danger' : days <= 7 ? 'warning' : days <= 30 ? 'brand' : 'neutral');

export const shortDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '');
export const today = () => localISO();

export const IMPORTS = {
  products: {
    title: 'Import products', endpoint: '/retail/import/products', file: 'products-template.csv',
    columns: ['Name', 'SKU', 'Barcode', 'Category', 'Brand', 'Unit', 'MRP', 'Selling Price', 'Purchase Price', 'Tax Rate', 'HSN', 'Min Stock', 'Opening Stock', 'Track Expiry', 'Batch No', 'Expiry Date', 'ERP Code', 'Aliases'],
    sample: ['Tata Salt 1kg', '', '8904043901015', 'Staples', 'Tata', 'pc', '28', '27', '22', '0', '2501', '10', '48', 'no', '', '', '', 'namak | salt'],
    modes: [{ value: 'create', label: 'Add new products only' }, { value: 'upsert', label: 'Add new products and update ones I already have' }],
    accepts: ['product', 'product_name', 'item', 'item_name', 'price', 'sale_price', 'cost', 'cost_price', 'gst', 'gst_rate', 'ean', 'upc', 'reorder_level', 'stock', 'qty', 'batch', 'expiry', 'mfd', 'uom', 'group', 'department'],
    hint: 'Leave SKU empty and FlowXP makes one. Products are matched by barcode, then SKU, then ERP code. Opening stock is for new products only.'
  },
  stock: {
    title: 'Import stock levels', endpoint: '/retail/import/stock', file: 'stock-template.csv',
    columns: ['Barcode', 'SKU', 'Quantity', 'Batch No', 'Expiry Date'],
    sample: ['8904043901015', '', '60', 'B101', '2027-03-31'],
    modes: [{ value: 'set', label: 'This is what is on the shelf now (set the stock)' }, { value: 'add', label: 'This is a delivery (add to the stock)' }],
    accepts: ['qty', 'stock', 'counted', 'batch', 'expiry', 'ean'],
    hint: 'Give a barcode or a SKU. Products that track expiry need an expiry date when you add stock.'
  }
};

/** Details the receiving screen needs (cost, GST, expiry tracking) that the till's catalogue copy does not carry. */
export const productDetail = (id) => api(`/products/${id}`);

/** A scanned or typed code to its product: this device's catalogue first (instant, works offline), then the server. null = no such product. */
export const lookupCode = async (code) => {
  const text = String(code).trim();
  const local = catalogInfo().ready ? localLookup(text) : null;
  if (local) return local;
  try { return await api(`/products/barcode/${encodeURIComponent(text)}`); } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
};
