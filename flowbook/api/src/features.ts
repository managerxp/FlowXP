/*
 * The FlowBook features a plan can switch off. The everyday ones (invoices, bills, customers, vendors, items, payments, expenses, the profit and
 * loss and ageing reports, settings) are always on; everything below is "advanced" and can be turned off per plan, per business type or per business
 * by the FlowXP super admin (the keys are listed in the FlowXP backend's modules/planFeatures.js, which is what the admin screen shows).
 * Turning one off stops its API routes here (403 feature_off) and hides its screens in the web app (the /v1/me answer lists what is off).
 * FlowBook only learns what is off through the host (opts.host.featuresOff); on its own nothing is off.
 */
export type Feature = { key: string; label: string };
export const FEATURES: Feature[] = [
  { key: 'flowbook_app', label: 'FlowBook' },
  { key: 'flowbook_quotes_orders', label: 'Quotes and orders' },
  { key: 'flowbook_notes', label: 'Credit and debit notes' },
  { key: 'flowbook_recurring', label: 'Recurring invoices' },
  { key: 'flowbook_projects', label: 'Projects' },
  { key: 'flowbook_bank', label: 'Bank accounts and reconciliation' },
  { key: 'flowbook_stock', label: 'Stock and warehouses' },
  { key: 'flowbook_assets', label: 'Fixed assets' },
  { key: 'flowbook_gst', label: 'GST returns' },
  { key: 'flowbook_einvoice', label: 'E-invoice and e-way bill' },
  { key: 'flowbook_currency', label: 'Foreign currency' },
  { key: 'flowbook_tds_tcs', label: 'TDS and TCS' },
  { key: 'flowbook_journals', label: 'Journals' },
  { key: 'flowbook_reports_more', label: 'Balance sheet, trial balance and statements' },
  { key: 'flowbook_whatsapp', label: 'WhatsApp' },
  { key: 'flowbook_email', label: 'Email' },
  { key: 'flowbook_import', label: 'Import from CSV' }
];
const LABEL = new Map(FEATURES.map((f) => [f.key, f.label]));
export const featureLabel = (key: string): string => LABEL.get(key) ?? key;

const BY_SEGMENT: Record<string, string> = {
  quotes: 'flowbook_quotes_orders', 'sales-orders': 'flowbook_quotes_orders', 'purchase-orders': 'flowbook_quotes_orders',
  'credit-notes': 'flowbook_notes', 'debit-notes': 'flowbook_notes', recurring: 'flowbook_recurring', projects: 'flowbook_projects', time: 'flowbook_projects',
  bank: 'flowbook_bank', stock: 'flowbook_stock', warehouses: 'flowbook_stock', assets: 'flowbook_assets', gst: 'flowbook_gst', einvoice: 'flowbook_einvoice',
  'exchange-rates': 'flowbook_currency', fx: 'flowbook_currency', journals: 'flowbook_journals', whatsapp: 'flowbook_whatsapp', email: 'flowbook_email', import: 'flowbook_import'
};

/** Which advanced feature a route belongs to (null: an everyday one). `url` is the route pattern, e.g. /v1/orgs/:orgId/quotes/:id/issue. */
export const featureOfRoute = (url: string): string | null => {
  const rest = url.replace(/^\/v1\/orgs\/:orgId\/?/, '').split('/');
  if (rest[0] === 'reports') return rest[1] === 'trial-balance' || rest[1] === 'balance-sheet' ? 'flowbook_reports_more' : null;
  if (rest[0] === 'parties' && rest[2] === 'statement') return 'flowbook_reports_more';
  if (rest[0] === 'invoices' && rest[2] === 'eway-bill') return 'flowbook_einvoice';
  return BY_SEGMENT[rest[0] ?? ''] ?? null;
};

/** Fields of an everyday request that belong to an advanced feature: a foreign currency, tax collected at source, tax deducted. */
export const featuresInBody = (body: unknown): string[] => {
  const b = (body && typeof body === 'object' ? body : {}) as { currency?: unknown; tcsRateBp?: unknown; tds?: unknown };
  const out: string[] = [];
  if (typeof b.currency === 'string' && b.currency !== 'INR') out.push('flowbook_currency');
  if (Number(b.tcsRateBp) > 0 || Number(b.tds) > 0) out.push('flowbook_tds_tcs');
  return out;
};
