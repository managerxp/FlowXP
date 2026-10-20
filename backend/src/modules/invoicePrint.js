/*
 * How a business's A4 / A5 invoice looks: the layout (the standard bill or the Tally-style tax invoice), paper, text size, accent colour,
 * which columns and blocks are shown, the copies printed (Original / Duplicate / Triplicate), and the wording of the declaration, signature
 * line and footer. Kept inside businesses.receipt_settings under `invoice_print`, next to the PAN, bank details and terms the invoice
 * already prints; every key has a default, so a business that never opens the settings gets the invoice it had before.
 */

export const COPY_LABELS = ['Original for Recipient', 'Duplicate for Transporter', 'Triplicate for Supplier'];
export const ACCENTS = ['#111827', '#1d4ed8', '#047857', '#b91c1c', '#7c3aed', '#c2410c'];   // ink, blue, green, red, purple, orange

export const SHOW_KEYS = ['logo', 'email', 'pan', 'hsn', 'unit', 'rate_incl_tax', 'disc_pct', 'total_qty', 'amount_in_words', 'tax_summary', 'bank', 'terms', 'signature', 'received_by', 'eoe'];

export const INVOICE_PRINT_DEFAULTS = {
  layout: 'auto',            // auto = the Tally-style tax invoice for trade businesses, the standard bill for the rest
  paper: 'A4',
  text_size: 'medium',
  accent: '#111827',
  copies: [],                // none = one copy with no label
  declaration: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  signature_text: 'Authorised Signatory',
  footer_note: 'This is a Computer Generated Invoice',
  show: { logo: true, email: true, pan: true, hsn: true, unit: true, rate_incl_tax: true, disc_pct: true, total_qty: true, amount_in_words: true, tax_summary: true, bank: true, terms: true, signature: true, received_by: false, eoe: true }
};

/** The stored settings laid over the defaults, so a missing key is never undefined. */
export const withDefaults = (stored) => {
  const s = stored && typeof stored === 'object' ? stored : {};
  return { ...INVOICE_PRINT_DEFAULTS, ...s, copies: Array.isArray(s.copies) ? s.copies : [], show: { ...INVOICE_PRINT_DEFAULTS.show, ...(s.show && typeof s.show === 'object' ? s.show : {}) } };
};

/** Check what the settings page sent: every key validated, unknown keys dropped. Returns { settings } or { error }. */
export const cleanInvoicePrint = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Invoice print settings must be an object' };
  const out = {};
  const oneOf = (key, allowed, what) => {
    if (!(key in input)) return null;
    if (!allowed.includes(input[key])) return `${what} is not one of the choices`;
    out[key] = input[key]; return null;
  };
  const text = (key, max, what) => {
    if (!(key in input)) return null;
    const v = String(input[key] ?? '').trim();
    if (v.length > max) return `${what} is too long (${max} characters at most)`;
    out[key] = v; return null;
  };
  const bad = oneOf('layout', ['auto', 'standard', 'tally'], 'Layout') || oneOf('paper', ['A4', 'A5'], 'Paper size') || oneOf('text_size', ['small', 'medium', 'large'], 'Text size')
    || oneOf('accent', ACCENTS, 'Colour') || text('declaration', 400, 'The declaration') || text('signature_text', 60, 'The signature line') || text('footer_note', 120, 'The footer line');
  if (bad) return { error: bad };
  if ('copies' in input) {
    if (!Array.isArray(input.copies) || input.copies.length > 3 || input.copies.some((c) => !COPY_LABELS.includes(c)) || new Set(input.copies).size !== input.copies.length) return { error: 'Copies must be a list of Original, Duplicate and Triplicate, each at most once' };
    out.copies = COPY_LABELS.filter((c) => input.copies.includes(c));   // always in the usual order
  }
  if ('show' in input) {
    if (!input.show || typeof input.show !== 'object' || Array.isArray(input.show)) return { error: 'Show must be an object' };
    out.show = Object.fromEntries(SHOW_KEYS.filter((k) => k in input.show).map((k) => [k, input.show[k] === true]));
  }
  return { settings: out };
};
