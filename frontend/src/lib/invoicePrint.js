/*
 * The invoice print settings as the screens see them (the same keys and defaults as backend/src/modules/invoicePrint.js): the settings page,
 * the invoice preview and the printed page all read them through withDefaults, so a business that never opened the settings prints as before.
 */

export const COPY_LABELS = ['Original for Recipient', 'Duplicate for Transporter', 'Triplicate for Supplier'];
export const ACCENTS = [['#111827', 'Black'], ['#1d4ed8', 'Blue'], ['#047857', 'Green'], ['#b91c1c', 'Red'], ['#7c3aed', 'Purple'], ['#c2410c', 'Orange']];
/** What the settings page can toggle, in the order it lists them: [key, label]. */
export const SHOW_OPTIONS = [
  ['logo', 'Logo'], ['email', 'Company e-mail'], ['pan', 'Company PAN'], ['hsn', 'HSN/SAC column'], ['unit', 'Unit of measure'], ['rate_incl_tax', 'Rate including tax column'],
  ['disc_pct', 'Discount % column'], ['total_qty', 'Total quantity'], ['amount_in_words', 'Total in words'], ['tax_summary', 'Tax summary by HSN'], ['bank', 'Bank details'],
  ['terms', 'Terms and conditions'], ['signature', 'Signature block'], ['received_by', 'Received by / Delivered by lines'], ['eoe', 'E. & O.E.']
];

export const INVOICE_PRINT_DEFAULTS = {
  layout: 'auto', paper: 'A4', text_size: 'medium', accent: '#111827', copies: [],
  declaration: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  signature_text: 'Authorised Signatory', footer_note: 'This is a Computer Generated Invoice',
  show: { logo: true, email: true, pan: true, hsn: true, unit: true, rate_incl_tax: true, disc_pct: true, total_qty: true, amount_in_words: true, tax_summary: true, bank: true, terms: true, signature: true, received_by: false, eoe: true }
};

export const withDefaults = (stored) => {
  const s = stored && typeof stored === 'object' ? stored : {};
  return { ...INVOICE_PRINT_DEFAULTS, ...s, copies: Array.isArray(s.copies) ? s.copies : [], show: { ...INVOICE_PRINT_DEFAULTS.show, ...(s.show || {}) } };
};

/** Page width in CSS pixels the document is laid out at (A4 and A5 portrait), and the body text size for each choice. */
export const PAPER_WIDTH = { A4: 760, A5: 540 };
export const TEXT_PX = { small: 11, medium: 12, large: 13.5 };
