/*
 * GST filing on the phone (owner and admin with the GST permission): prepare the GSTR-1 file, see the GSTR-3B figures, and get the e-invoice
 * file for B2B invoices, month by month and GSTIN by GSTIN. FlowXP never files for you: it prepares the numbers and the files, says what is
 * missing, and you (or your accountant) upload them on the GST portal. The same as the website's GST filing page; the server does all the
 * working (backend gst.controller.js) and the phone only asks, shows and shares the files. Pure: months, requests, rows and checks.
 */
import { authHeaders, type BackupRequest } from './backup.ts';

type Sess = { token: string | null; businessId: number | null; branchId: number | null };

/* ── months ──────────────────────────────────────────────────────────────── */
const pad = (n: number) => String(n).padStart(2, '0');
export const monthOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
/** The months offered, newest first, starting with last month (what is usually being filed), for `count` months. */
export const recentMonths = (now: Date = new Date(), count = 12): string[] => Array.from({ length: count }, (_, i) => monthOf(new Date(now.getFullYear(), now.getMonth() - 1 - i, 1)));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (period: string): string => { const [y, m] = period.split('-'); return `${MONTHS[Number(m) - 1] ?? m} ${y}`; };

/* ── what the server answers ─────────────────────────────────────────────── */
export type Filings = { period: string; business_gstin: string | null; gst_enabled: boolean; gstins: { gstin: string; invoices: number; taxable_value: number }[] };
export type Gstr1 = {
  gstin: string; summary: { b2b: { invoices: number; customers: number; taxable_value: number }; b2cl: { invoices: number; taxable_value: number }; b2cs: { rows: number; taxable_value: number };
    credit_notes: number; credit_notes_registered: { notes: number }; credit_notes_unregistered: { notes: number }; hsn_rows: number }; warnings: { message: string }[];
};
type Tax = { taxable?: number; igst?: number; cgst?: number; sgst?: number };
export type Gstr3b = {
  outward_taxable: Tax; outward_nil_or_exempt: { taxable: number }; inter_state_to_unregistered: { pos: string; taxable: number; igst: number }[];
  itc: { igst: number; cgst: number; sgst: number; ineligible: number }; tax_payable_in_cash: { igst: number; cgst: number; sgst: number }; notes: string[];
};
export type EInvoiceRow = { invoice_id: number; invoice_number: string; ready: boolean; errors: string[]; warnings: string[]; irn: string | null };
export type EInvoices = { gstin: string; applies: boolean; invoices: EInvoiceRow[] };
export type FilingSettings = { gst_enabled: boolean; gstin: string | null; b2cl_limit: number; einvoice_enabled: boolean };

/** The GSTIN to start on: the one already chosen if still offered, else the business's own, else the first that has invoices. */
export const pickGstin = (current: string, f: Filings): string => {
  const own = f.gstins.map((g) => g.gstin);
  return current && (own.includes(current) || current === f.business_gstin) ? current : f.business_gstin || own[0] || '';
};
export const gstinOptions = (f: Filings): string[] => [...new Set([f.business_gstin, ...f.gstins.map((g) => g.gstin)].filter(Boolean) as string[])];

/* ── files ───────────────────────────────────────────────────────────────── */
const fileRequest = (apiUrl: string, session: Sess, path: string, fileName: string): BackupRequest => ({ url: `${apiUrl.replace(/\/$/, '')}/api${path}`, headers: authHeaders(session), fileName });
/** GSTR-1 as the JSON file the portal's offline tool takes: GSTR1_<gstin>_<MMYYYY>.json. */
export const gstr1Request = (apiUrl: string, session: Sess, period: string, gstin: string): BackupRequest =>
  fileRequest(apiUrl, session, `/gst/gstr1?period=${period}&gstin=${gstin}&download=1`, `GSTR1_${gstin}_${period.slice(5)}${period.slice(0, 4)}.json`);
/** The bulk e-invoice file of the invoices that are ready. */
export const einvoiceRequest = (apiUrl: string, session: Sess, period: string, gstin: string): BackupRequest =>
  fileRequest(apiUrl, session, `/gst/einvoice?period=${period}&gstin=${gstin}&download=1`, `einvoice_${gstin}_${period}.json`);

/* ── GSTR-3B as rows ─────────────────────────────────────────────────────── */
export type Row3b = { label: string; taxable?: number; igst: number; cgst: number; sgst: number; strong?: boolean };
/** The 3B table the website shows: outward supplies, nil-rated, inter-state to unregistered, input credit, and the tax to pay in cash. */
export const gstr3bRows = (d: Gstr3b): Row3b[] => [
  { label: '3.1(a) Outward taxable supplies (net of credit notes)', taxable: d.outward_taxable.taxable, igst: d.outward_taxable.igst ?? 0, cgst: d.outward_taxable.cgst ?? 0, sgst: d.outward_taxable.sgst ?? 0 },
  { label: '3.1(c) Nil-rated, exempt', taxable: d.outward_nil_or_exempt.taxable, igst: 0, cgst: 0, sgst: 0 },
  ...d.inter_state_to_unregistered.map((x): Row3b => ({ label: `3.2 Inter-state to unregistered, state ${x.pos}`, taxable: x.taxable, igst: x.igst, cgst: 0, sgst: 0 })),
  { label: '4(A) Input tax credit you can claim', igst: d.itc.igst, cgst: d.itc.cgst, sgst: d.itc.sgst },
  { label: 'Tax to pay in cash (after credit)', igst: d.tax_payable_in_cash.igst, cgst: d.tax_payable_in_cash.cgst, sgst: d.tax_payable_in_cash.sgst, strong: true }
];

/* ── checks before sending ───────────────────────────────────────────────── */
/** An IRN is 64 letters and digits (0-9, a-f), copied from the portal; the server checks again. */
export const cleanIrn = (irn: string): string => irn.trim().toLowerCase();
export const irnProblem = (irn: string): string => (/^[0-9a-f]{64}$/.test(cleanIrn(irn)) ? '' : 'An IRN is 64 letters and digits (0-9, a-f). Copy it from the portal.');
export const limitProblem = (v: string): string => { const n = Number(v); return n > 0 && n <= 100000000 ? '' : 'The large-invoice limit must be an amount in rupees'; };
/** Owners and admins with the GST permission file; a person pinned to one outlet cannot (filing covers every outlet under a GSTIN). */
export const canFile = (role: string | undefined): boolean => role === 'OWNER' || role === 'ADMIN';

/** Every fixed text on the screen, so the language tests can check each is translated. */
export const GST_TEXTS: string[] = [
  'GST filing', 'Prepare your GSTR-1 file, the GSTR-3B figures and e-invoice files. You upload them on the GST portal.', 'Month', 'GSTIN', 'GSTR-1', 'GSTR-3B', 'E-invoice', 'GST is not switched on for this business. Turn it on in Business settings to prepare returns.',
  'Add your GSTIN in Business settings first.', 'B2B invoices', '{customers} customers · {taxable} taxable', 'B2C large (inter-state)', '{taxable} taxable', 'B2C small (summary rows)', '{taxable} taxable, net of returns', 'Credit notes',
  '{registered} to registered · {others} to others', 'Check:', 'Nothing to fix. The file is ready to upload.', 'Download the GSTR-1 file', 'Upload it on the GST portal (Returns, GSTR-1, Prepare offline) or give it to your accountant. {hsn_rows} HSN rows included.',
  'Taxable value', 'IGST', 'CGST', 'SGST/UTGST', '3.1(a) Outward taxable supplies (net of credit notes)', '3.1(c) Nil-rated, exempt', '3.2 Inter-state to unregistered, state {pos}', '4(A) Input tax credit you can claim', 'Tax to pay in cash (after credit)',
  'Purchases from suppliers without a GSTIN carry {amount} of tax that is not claimable.', 'E-invoicing applies to businesses above a turnover limit and only for sales to customers with a GSTIN. If it does not apply to you, ignore this tab.',
  'No sales to GST-registered customers in this month.', 'Has IRN', 'Ready', 'Missing: {what}', 'Paste the IRN from the portal', 'IRN saved', 'Download e-invoice file ({n} ready)', 'Filing settings', 'Large inter-state invoice limit (₹)',
  'Inter-state sales to people without a GSTIN above this go in the B2CL table. Confirm the current limit with your accountant.', 'My business must issue e-invoices', 'Saved', 'Save', 'Back',
  "Your GSTIN is set in Business settings. Add each customer's state, pincode and GSTIN on the Customers page, and an HSN/SAC code on every product, so the files come out complete.", 'Could not load.', 'Could not save. Check the connection and try again.',
  'Only owners and admins can prepare returns.', 'Could not download. The phone needs a connection, and filing needs permission.', 'FlowXP prepares the files and numbers; it never files for you.'
];
