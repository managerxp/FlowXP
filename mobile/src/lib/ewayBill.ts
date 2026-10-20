/*
 * The e-way bill for one invoice (goods moved for more than Rs 50,000): how they travel, the file for the e-way bill portal, and the 12-digit number
 * the portal gives back. The same as the website's e-way bill window; the server builds the file and says what is missing (backend gst.controller.js),
 * the phone asks, shows, shares the file and records the number. FlowXP does not file it for you. Pure: the form, the checks and the wording.
 */
import { t } from './i18n.ts';

export type Mode = 'road' | 'rail' | 'air' | 'ship';
export const MODES: { id: Mode; label: string }[] = [{ id: 'road', label: 'Road' }, { id: 'rail', label: 'Rail' }, { id: 'air', label: 'Air' }, { id: 'ship', label: 'Ship' }];
export type EwayForm = { mode: Mode; distance_km: string; vehicle_no: string; transporter_id: string; transporter_name: string };
export const emptyEway = (): EwayForm => ({ mode: 'road', distance_km: '', vehicle_no: '', transporter_id: '', transporter_name: '' });

/** Owners and admins prepare e-way bills, for an issued invoice to a customer with a GSTIN (as on the website). */
export const canEway = (role: string | undefined, hasCustomerGstin: boolean): boolean => (role === 'OWNER' || role === 'ADMIN') && hasCustomerGstin;

export const distanceProblem = (v: string): string => (v.trim() === '' || (/^\d+$/.test(v.trim()) && Number(v) <= 4000) ? '' : 'Distance is a whole number of kilometres, up to 4000');
export const gstinProblem = (v: string): string => (v.trim() === '' || /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(v.trim().toUpperCase()) ? '' : 'The transporter GSTIN has 15 letters and digits');
export const formProblem = (f: EwayForm): string => distanceProblem(f.distance_km) || gstinProblem(f.transporter_id);

/** The body of POST /gst/eway-bill. */
export const ewayBody = (invoiceId: number, f: EwayForm): { invoice_id: number; transport: Record<string, unknown> } => ({
  invoice_id: invoiceId,
  transport: { mode: f.mode, distance_km: f.distance_km.trim() === '' ? undefined : Number(f.distance_km), vehicle_no: f.vehicle_no.replace(/\s+/g, '').toUpperCase(), transporter_id: f.transporter_id.trim().toUpperCase(), transporter_name: f.transporter_name.trim() }
});
export type EwayResult = { invoice_number: string; ready: boolean; errors: string[]; warnings: { message: string }[]; json: unknown; eway_bill_no?: string | null };
export const fileName = (invoiceNumber: string): string => `eway_${invoiceNumber.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`;
export const fileText = (r: EwayResult): string => JSON.stringify(r.json, null, 2);

/** The number the portal returns: 12 digits (spaces forgiven). */
export const cleanNumber = (v: string): string => v.replace(/\s+/g, '');
export const numberProblem = (v: string): string => (/^\d{12}$/.test(cleanNumber(v)) ? '' : 'An e-way bill number is 12 digits');
export const recordBody = (v: string, today: string): { eway_bill_no: string; date: string } => ({ eway_bill_no: cleanNumber(v), date: today });

/** Every fixed text on the e-way bill screen, so the language tests can check each is translated. */
export const EWAY_TEXTS: string[] = [
  'E-way bill', 'E-way bill {number}', 'Needed for goods (not services) moved for more than ₹50,000. The customer\'s state, pincode and GSTIN, your address and pincode, and an HSN on every product must be filled in.',
  'Transport', 'Road', 'Rail', 'Air', 'Ship', 'Distance (km)', 'Vehicle number', 'Or the transporter\'s ID below', 'Transporter GSTIN (optional)', 'Transporter name (optional)', 'Prepare the file', 'Preparing…', 'Fix these first:',
  'Share the e-way bill file (JSON)', 'Upload it on the e-way bill portal (Generate in bulk). The portal gives you a 12-digit number: save it here.', 'E-way bill number', 'Save number', 'E-way bill {number} is saved on this invoice.',
  'Distance is a whole number of kilometres, up to 4000', 'The transporter GSTIN has 15 letters and digits', 'An e-way bill number is 12 digits', 'Only owners and admins can prepare e-way bills.',
  'Could not load.', 'Could not save. Check the connection and try again.', 'Could not prepare the file. Check the connection and try again.', 'Back'
];
export const savedText = (no: string): string => t('E-way bill {number} is saved on this invoice.', { number: no });
