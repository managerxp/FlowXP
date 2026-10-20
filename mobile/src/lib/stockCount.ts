/*
 * A stock count on the phone (anyone with the inventory permission, in a shop): walk the shelf, scan each product once per unit or type the number
 * found, see what differs from the system as you go, and apply it at the end so each difference becomes a stock movement of its own. Nothing about
 * the stock changes until "Apply". The same as the website's stock count; the server keeps the count and does the arithmetic. Pure: types, bodies,
 * checks and wording.
 */
import { t } from './i18n.ts';
import { qty } from './money.ts';

export type CountStatus = 'OPEN' | 'APPLIED' | 'CANCELLED';
export type CountRow = {
  count_id: number; name: string; status: CountStatus; scope: 'STORE' | 'CATEGORY'; category: string | null; outlet: string | null; lines?: number; created_at: string; applied_at: string | null;
  lines_adjusted: number | null; net_units: number | null; net_value: number | null;
};
export type CountItem = { product_id: number; name: string; sku: string | null; barcode: string | null; system_qty: number; counted_qty: number; variance: number };
export type CountDetail = CountRow & { uncounted: number; totals: { lines: number; variance_lines: number; short_units: number; extra_units: number; net_value: number }; items: CountItem[] };
/** One thing counted: one more of it (a scan), or the number found on the shelf. */
export type CountEntry = { product_id: number; add: number } | { product_id: number; counted: number };
export type CountedBack = { counted_qty: number; variance: number; name?: string };

/** The people who count: those with the inventory permission (the server checks again). */
export const canCount = (can: (perm: string) => boolean): boolean => can('inventory');

export const statusLabel = (s: CountStatus): string => t(({ OPEN: 'In progress', APPLIED: 'Applied', CANCELLED: 'Cancelled' } as const)[s] ?? s);
export const scopeText = (c: Pick<CountRow, 'category' | 'outlet'>): string => [c.category ? t('Counting only {category}', { category: c.category }) : t('Counting the whole store'), c.outlet].filter(Boolean).join(' · ');
export const startBody = (name: string, categoryId: string): { name: string; category_id?: number } => ({ name: name.trim(), category_id: categoryId ? Number(categoryId) : undefined });
export const startProblem = (name: string): string => (name.trim() && name.trim().length <= 80 ? '' : 'Give the count a name (up to 80 characters)');
export const listLine = (c: CountRow): string => [c.category ? t('Category: {category}', { category: c.category }) : t('Whole store'), c.status === 'APPLIED' ? t('{n} adjusted · {units} units', { n: c.lines_adjusted ?? 0, units: signed(c.net_units ?? 0) }) : t('{n} counted', { n: c.lines ?? 0 })].join(' · ');

/** +3, -2, or 0 — a difference shown with its sign. */
export const signed = (n: number): string => `${n > 0 ? '+' : ''}${qty(n)}`;
export const varianceText = (v: number): string => (v === 0 ? t('Matches') : signed(v));
export const itemSub = (i: CountItem): string => [i.sku, i.barcode].filter(Boolean).join(' · ');

/** What a scan or a typed number is sent as. */
export const scanEntry = (productId: number): CountEntry => ({ product_id: productId, add: 1 });
export const typedEntry = (productId: number, text: string): CountEntry | null => { const n = Number(text.trim()); return text.trim() !== '' && Number.isFinite(n) && n >= 0 ? { product_id: productId, counted: n } : null; };
export const scanNote = (name: string, back: CountedBack): string => t('{name}: counted {n}', { name, n: qty(back.counted_qty) }) + (back.variance ? ` · ${signed(back.variance)}` : '');

/** The words on the "apply" question: what will change. */
export const applyText = (c: Pick<CountDetail, 'totals'>): string =>
  c.totals.variance_lines === 0 ? t('Everything you counted matches the system, so nothing will change.')
    : t('The stock of {n} products will be corrected: {short} units short, {extra} units extra, worth {value}.', { n: c.totals.variance_lines, short: qty(c.totals.short_units), extra: qty(c.totals.extra_units), value: Math.abs(c.totals.net_value).toFixed(2) });
export const appliedText = (c: Pick<CountRow, 'lines_adjusted' | 'net_units' | 'net_value'>): string => t('Applied: {n} products corrected, {units} units.', { n: c.lines_adjusted ?? 0, units: signed(c.net_units ?? 0) });

/* ── a product that is not in the system yet, made while scanning ───────── */
export type QuickForm = { name: string; selling_price: string; mrp: string; tax_rate: string; unit: string };
export const QUICK_GST = ['0', '5', '12', '18', '28'];
export const QUICK_UNITS = ['pc', 'kg', 'g', 'litre', 'ml', 'pack', 'box', 'dozen'];
export const emptyQuick = (): QuickForm => ({ name: '', selling_price: '', mrp: '', tax_rate: '5', unit: 'pc' });
export const quickProblem = (f: QuickForm): string => {
  if (!f.name.trim()) return 'Give the product a name';
  if (!(Number(f.selling_price) >= 0) || f.selling_price.trim() === '') return 'Enter the selling price';
  if (f.mrp.trim() !== '' && !(Number(f.mrp) >= 0)) return 'The MRP must be a number';
  if (f.mrp.trim() !== '' && Number(f.selling_price) > Number(f.mrp)) return 'The selling price cannot be more than the MRP';
  return '';
};
/** The body of POST /products/quick: the scanned barcode attaches itself and FlowXP makes the SKU. */
export const quickBody = (f: QuickForm, barcode: string): Record<string, unknown> => ({ name: f.name.trim(), selling_price: f.selling_price, mrp: f.mrp.trim() === '' ? undefined : f.mrp, tax_rate: f.tax_rate, unit: f.unit, barcode });
export const canQuickAdd = (can: (perm: string) => boolean): boolean => can('product_quick_add');

/** Every fixed text on the Stock count screens, so the language tests can check each is translated. */
export const STOCK_COUNT_TEXTS: string[] = [
  'Add this product', 'Barcode {code} will be attached to the new product.', 'Product name', 'Selling price (₹)', 'MRP (₹)', 'GST', 'Sold in', 'Create and count it', 'Give the product a name', 'Enter the selling price', 'The MRP must be a number', 'The selling price cannot be more than the MRP',
  'Scan the shelf and see what differs',
  'Stock counts', 'Walk the shelf, scan each product once per unit, and see what differs from the system before anything changes.', 'Count stock', 'Start counting', 'No stock counts yet.', 'In progress', 'Applied', 'Cancelled', 'Whole store', 'Category: {category}', '{n} counted', '{n} adjusted · {units} units',
  'Name', 'So you can tell counts apart later, like “Aisle 3” or “Month end”.', 'What are you counting?', 'The whole store', 'Give the count a name (up to 80 characters)', 'You do not have access to stock counts.', 'Could not load.', 'Could not save. Check the connection and try again.', 'Back',
  'Counting only {category}', 'Counting the whole store', 'Scan items', 'Stop scanning', 'Point the camera at the barcode', 'Allow the camera so FlowXP can read barcodes. It does not take or keep photos.', 'Allow the camera', 'Not now',
  '{code} is not in your products. Check the code, or add it under Products.', '{name}: counted {n}', 'Search a product to count it (+1)', 'Products counted', 'With a difference', 'Units short', 'Units extra', 'Not counted yet', 'Only products with a difference', 'Matches', 'System said {n}', 'You counted',
  'No differences so far.', 'Nothing counted yet.', 'Press Scan items and scan each product on the shelf, once per unit. Or search above.', 'Finish and apply', 'Apply this count?', 'Keep counting', 'Apply count',
  'Everything you counted matches the system, so nothing will change.', 'The stock of {n} products will be corrected: {short} units short, {extra} units extra, worth {value}.', 'Set the {n} products I did not count to zero.',
  'Only tick this if the whole store or category was counted and anything not scanned is truly gone.', 'Applied: {n} products corrected, {units} units.', 'Count applied', 'Cancel this count', 'Cancel this count?', 'Your counts are discarded. Stock is not changed.', 'Keep it', 'Count cancelled'
];
