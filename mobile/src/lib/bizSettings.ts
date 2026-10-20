/*
 * Business settings on the phone (owner only), the same fields the website's Settings > Business has: the business details, the receipt and
 * tax-invoice details (PAN, bank, terms), the GST options, and how the A4 / A5 invoice looks. Each part is saved on its own with
 * PATCH /businesses/current, sending only what changed (the server merges and checks every value; its message is shown as it is).
 * Nothing here talks to the phone or the network: it only works out what to send.
 */
import { GST_DEFAULTS_PHONE, type GstOptions } from './gst.ts';
import { printSettings, type PrintSettings } from './taxInvoice.ts';

/** What GET /businesses/current answers that these screens use. */
export type BusinessRecord = {
  name: string; email: string | null; phone: string | null; address: string | null; city: string | null; state: string | null; postal_code: string | null; gstin: string | null; gst_enabled: boolean;
  receipt_settings: Record<string, unknown> & { invoice_print?: Partial<PrintSettings> }; gst_settings?: Partial<GstOptions>;
};

export const PROFILE_FIELDS = ['name', 'phone', 'email', 'address', 'city', 'state', 'postal_code', 'gstin'] as const;
export type ProfileKey = typeof PROFILE_FIELDS[number];
export type Profile = Record<ProfileKey, string>;

export const profileOf = (b: BusinessRecord): Profile => Object.fromEntries(PROFILE_FIELDS.map((k) => [k, String(b[k] ?? '')])) as Profile;

/** Only the changed fields, trimmed; a GSTIN is sent in capitals. Nothing changed gives null (nothing to save). */
export const profilePatch = (before: Profile, after: Profile): Record<string, string> | null => {
  const out: Record<string, string> = {};
  for (const k of PROFILE_FIELDS) {
    const norm = (v: string) => (k === 'gstin' ? v.trim().toUpperCase() : v.trim());   // a GSTIN is kept in capitals, so a change of case alone is not a change
    if (norm(after[k]) !== norm(before[k])) out[k] = norm(after[k]);
  }
  return Object.keys(out).length ? out : null;
};

/* ── receipt and tax-invoice details ─────────────────────────────────────── */
export type Receipt = {
  paper_width: 58 | 80; footer: string; show_logo: boolean; show_gstin: boolean; show_upi_qr: boolean; show_loyalty: boolean; auto_cut: boolean; copies: number; extra_lines: number;
  pan: string; bank_name: string; bank_account: string; bank_ifsc: string; bank_branch: string; accountant_email: string; terms: string;
};
export const RECEIPT_DEFAULTS: Receipt = {
  paper_width: 80, footer: 'Thank you! Visit again.', show_logo: true, show_gstin: true, show_upi_qr: true, show_loyalty: true, auto_cut: true, copies: 1, extra_lines: 3,
  pan: '', bank_name: '', bank_account: '', bank_ifsc: '', bank_branch: '', accountant_email: '', terms: ''
};
export const TOGGLES: [keyof Receipt, string][] = [
  ['show_logo', 'Print the logo at the top of receipts'], ['show_gstin', 'Show the GSTIN on receipts'], ['show_upi_qr', 'Show a UPI QR for any unpaid balance'],
  ['show_loyalty', "Show the customer's loyalty card line"], ['auto_cut', 'Cut the paper after each receipt']
];

export const receiptOf = (b: BusinessRecord): Receipt => {
  const r = b.receipt_settings ?? {};
  const out = { ...RECEIPT_DEFAULTS } as Record<string, unknown>;
  for (const k of Object.keys(RECEIPT_DEFAULTS)) if (r[k] !== undefined && r[k] !== null) out[k] = r[k];
  return out as unknown as Receipt;
};

/** The changed receipt settings, wrapped as the server takes them; null when nothing changed. */
export const receiptPatch = (before: Receipt, after: Receipt): { receipt_settings: Partial<Receipt> } | null => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(RECEIPT_DEFAULTS) as (keyof Receipt)[]) {
    const a = after[k]; const b = before[k];
    const next = typeof a === 'string' ? (k === 'pan' || k === 'bank_ifsc' ? a.trim().toUpperCase() : a.trim()) : a;
    if (next !== (typeof b === 'string' ? b.trim() : b)) out[k] = next;
  }
  return Object.keys(out).length ? { receipt_settings: out as Partial<Receipt> } : null;
};

/* ── GST options ─────────────────────────────────────────────────────────── */
export type Gst = { gst_enabled: boolean; options: GstOptions };
export const gstOf = (b: BusinessRecord): Gst => ({ gst_enabled: Boolean(b.gst_enabled), options: { ...GST_DEFAULTS_PHONE, ...(b.gst_settings ?? {}) } });
/** Everything is sent (it is a handful of switches), as numbers where the server wants numbers. */
export const gstPatch = (after: Gst): { gst_enabled: boolean; gst_settings: GstOptions } => ({
  gst_enabled: after.gst_enabled,
  gst_settings: { ...after.options, composite_rate: Number(after.options.composite_rate), tcs_rate: Number(after.options.tcs_rate), tds_rate: Number(after.options.tds_rate) }
});

/* ── invoice print ───────────────────────────────────────────────────────── */
export const ACCENTS: [string, string][] = [['#111827', 'Black'], ['#1d4ed8', 'Blue'], ['#047857', 'Green'], ['#b91c1c', 'Red'], ['#7c3aed', 'Purple'], ['#c2410c', 'Orange']];
export const COPY_LABELS = ['Original for Recipient', 'Duplicate for Transporter', 'Triplicate for Supplier'];
/** [key, label] of what the invoice can show, in the website's order. */
export const SHOW_OPTIONS: [string, string][] = [
  ['logo', 'Logo'], ['email', 'Company e-mail'], ['pan', 'Company PAN'], ['hsn', 'HSN/SAC column'], ['unit', 'Unit of measure'], ['rate_incl_tax', 'Rate including tax column'],
  ['disc_pct', 'Discount % column'], ['total_qty', 'Total quantity'], ['amount_in_words', 'Total in words'], ['tax_summary', 'Tax summary by HSN'], ['bank', 'Bank details'],
  ['terms', 'Terms and conditions'], ['signature', 'Signature block'], ['received_by', 'Received by / Delivered by lines'], ['eoe', 'E. & O.E.']
];
export const printOf = (b: BusinessRecord): PrintSettings => printSettings(b.receipt_settings?.invoice_print);

/** The changed invoice-print settings (copies and show as whole values), wrapped for the server; null when nothing changed. */
export const printPatch = (before: PrintSettings, after: PrintSettings): { receipt_settings: { invoice_print: Partial<PrintSettings> } } | null => {
  const out: Record<string, unknown> = {};
  for (const k of ['layout', 'paper', 'text_size', 'accent', 'declaration', 'signature_text', 'footer_note'] as const) {
    const a = typeof after[k] === 'string' ? after[k].trim() : after[k];
    if (a !== before[k]) out[k] = a;
  }
  if (after.copies.join('|') !== before.copies.join('|')) out.copies = COPY_LABELS.filter((c) => after.copies.includes(c));
  if (JSON.stringify(after.show) !== JSON.stringify(before.show)) out.show = after.show;
  return Object.keys(out).length ? { receipt_settings: { invoice_print: out as Partial<PrintSettings> } } : null;
};

/** The GST options, with what each does (the same words as the website). */
export const OPTION_ROWS: { key: 'composite' | 'cess' | 'tcs' | 'tds' | 'reverse_charge'; label: string; rate?: 'composite_rate' | 'tcs_rate' | 'tds_rate'; rateLabel?: string; text: string }[] = [
  { key: 'composite', label: 'Composite scheme', rate: 'composite_rate', rateLabel: 'Composite tax rate (% of turnover)', text: 'You pay a flat share of your turnover instead of charging GST. Bills become Bills of Supply with no tax on them.' },
  { key: 'cess', label: 'Cess', text: 'Compensation cess on top of GST. Set the cess rate on each product (Products → edit); it is added to the line and the bill.' },
  { key: 'tcs', label: 'TCS (tax collected at source)', rate: 'tcs_rate', rateLabel: 'TCS rate (%)', text: 'A "Collect TCS" tick appears on the billing screen. When ticked, the TCS is added to that bill.' },
  { key: 'tds', label: 'TDS (tax deducted by the customer)', rate: 'tds_rate', rateLabel: 'TDS rate (%)', text: 'A "Customer deducts TDS" tick appears on the billing screen. When ticked, the TDS is taken off what the customer pays and noted on the bill.' },
  { key: 'reverse_charge', label: 'Reverse charge', text: 'A "Tax payable on reverse charge" tick appears on the billing screen and prints on the invoice.' }
];

/** The state names the server recognises for GST (place of supply), for the suggestions while typing. */
export const INDIA_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'
];
/** Up to five states that start with (or contain) what was typed, none when it already is one of them. */
export const stateSuggestions = (typed: string): string[] => {
  const q = typed.trim().toLowerCase();
  if (!q || INDIA_STATES.some((s) => s.toLowerCase() === q)) return [];
  return [...INDIA_STATES.filter((s) => s.toLowerCase().startsWith(q)), ...INDIA_STATES.filter((s) => !s.toLowerCase().startsWith(q) && s.toLowerCase().includes(q))].slice(0, 5);
};

/** Every fixed text these screens show, so the language tests can check each is translated (the screens reach t() only at run time). */
export const SETTINGS_TEXTS: string[] = [
  'Business settings', 'Details, receipt, GST and invoice (owner)', 'Only the owner can change business settings.', 'Business details', 'Receipt and tax invoice details', 'What prints on receipts, and the PAN, bank details and terms a tax invoice carries.',
  'GST options', 'Enable only what applies to your business. Everything is disabled until you switch it on, and your bills stay as they are until then.', 'Invoice print', 'How your A4 and A5 invoices look.',
  'Save', 'Saved', 'Nothing changed.', 'Could not save. Check the connection and try again.', 'Optional. Only needed if you charge GST.', 'Paper width', 'Copies of each receipt', 'Blank lines after the receipt',
  'Layout', 'Paper', 'Text size', 'Colour', 'Copies', 'Show on the invoice', 'Declaration', 'Signature line', 'Footer line', 'Footer message', 'Charge GST', 'Automatic', 'Standard bill', 'Tax invoice (Tally style)', 'Small', 'Medium', 'Large',
  'PAN', 'Bank name', 'Account number', 'IFSC', 'Bank branch', 'Accountant email', 'Terms and conditions', 'Business name', 'Phone', 'Email', 'Address', 'City', 'State', 'PIN code', 'GSTIN',
  ...ACCENTS.map(([, name]) => name), ...COPY_LABELS, ...SHOW_OPTIONS.map(([, label]) => label), ...TOGGLES.map(([, label]) => label as string),
  ...OPTION_ROWS.flatMap((o) => [o.label, o.text, ...(o.rateLabel ? [o.rateLabel] : [])])
];
