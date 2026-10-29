/*
 * What FlowXP tells FlowBook, as pure functions from database rows to event payloads (docs: flowbook/docs/flowxp-integration-contract.md).
 *
 * Every figure is the one FlowXP already worked out and stored, in integer paise: FlowBook posts these amounts and does not
 * recompute tax. An event is only built when it can be sent correctly. A bill that carries something FlowBook has no
 * account for yet (cess, TCS, TDS, an odd payment method) or whose figures do not add up is SKIPPED with the reason,
 * not sent wrong; the owner sees the count, because a skipped sale is a sale missing from the books.
 */
import crypto from 'node:crypto';

/** FlowXP payment method to the account FlowBook posts it to. CASH, UPI and CARD map one to one. */
const MODE = { CASH: 'CASH', UPI: 'UPI', CARD: 'CARD', BANK_TRANSFER: 'BANK', CHEQUE: 'BANK' };
export const modeOf = (method) => MODE[String(method).toUpperCase()] || null;

const n = (v) => Number(v || 0);
const customerOf = (c) => (c && c.customer_id ? { id: String(c.customer_id), name: c.name || `Customer ${c.customer_id}`, ...(c.state_code ? { state_code: c.state_code } : {}) } : undefined);

/**
 * `invoice` is the invoices row, `tenders` the payments taken in the same transaction as the sale (same created_at;
 * later payments are their own events), `customer` the customers row or null.
 * Returns { payload } or { skip: reason }.
 */
export const saleEvent = (invoice, tenders, customer) => {
  if (n(invoice.cess_paise) || n(invoice.tcs_paise) || n(invoice.tds_paise)) return { skip: 'This bill carries cess, TCS or TDS, which FlowBook cannot post yet' };
  const modes = [];
  for (const t of tenders) {
    const mode = modeOf(t.payment_method);
    if (!mode) return { skip: `Paid by ${t.payment_method}, which FlowBook has no account for yet` };
    modes.push({ mode, amount_minor: n(t.amount_paise), ...(t.reference_number ? { reference: t.reference_number } : {}) });
  }
  const tax = n(invoice.cgst_paise) + n(invoice.sgst_paise) + n(invoice.igst_paise);
  const expected = n(invoice.subtotal_paise) + tax - n(invoice.discount_paise) + n(invoice.round_off_paise);
  if (expected !== n(invoice.total_paise)) return { skip: `The bill's figures do not add up (${expected} against a total of ${n(invoice.total_paise)})` };
  const paid = modes.reduce((s, t) => s + t.amount_minor, 0);
  if (paid > n(invoice.total_paise)) return { skip: 'The payments taken are more than the bill' };
  if (n(invoice.total_paise) - paid > 0 && !customer) return { skip: 'An unpaid bill with no customer cannot go on a receivable' };
  return { payload: {
    invoice_id: String(invoice.invoice_id), invoice_number: invoice.invoice_number, date: String(invoice.invoice_date).slice(0, 10),
    ...(customerOf(customer) ? { customer: customerOf(customer) } : {}),
    net_minor: n(invoice.subtotal_paise), cgst_minor: n(invoice.cgst_paise), sgst_minor: n(invoice.sgst_paise), igst_minor: n(invoice.igst_paise),
    discount_minor: n(invoice.discount_paise), round_off_minor: n(invoice.round_off_paise), total_minor: n(invoice.total_paise),
    tenders: modes, unpaid_minor: n(invoice.total_paise) - paid
  } };
};

export const voidEvent = (invoice, today) => ({ payload: { invoice_id: String(invoice.invoice_id), date: today, reason: 'Cancelled in FlowXP' } });

/** `refunds` are the refunds rows of this credit note. */
export const creditNoteEvent = (note, invoiceNumber, refunds, customer) => {
  const tax = n(note.cgst_paise) + n(note.sgst_paise) + n(note.igst_paise);
  const expected = n(note.subtotal_paise) + tax - n(note.discount_share_paise);
  if (expected !== n(note.total_paise)) return { skip: `The credit note's figures do not add up (${expected} against a total of ${n(note.total_paise)})` };
  const out = [];
  for (const r of refunds) {
    const mode = modeOf(r.method);
    if (!mode) return { skip: `Refunded by ${r.method}, which FlowBook has no account for yet` };
    out.push({ mode, amount_minor: n(r.amount_paise) });
  }
  if (out.reduce((s, r) => s + r.amount_minor, 0) > n(note.total_paise)) return { skip: 'The refund is more than the credit note' };
  return { payload: {
    note_id: String(note.cn_id), note_number: note.cn_number, invoice_id: String(note.invoice_id), invoice_number: invoiceNumber, date: String(note.cn_date).slice(0, 10),
    ...(customerOf(customer) ? { customer: customerOf(customer) } : {}),
    net_minor: n(note.subtotal_paise), cgst_minor: n(note.cgst_paise), sgst_minor: n(note.sgst_paise), igst_minor: n(note.igst_paise),
    discount_minor: n(note.discount_share_paise), total_minor: n(note.total_paise), refund_tenders: out
  } };
};

/** A payment taken after the sale, against what the customer owed. */
export const paymentEvent = (payment, customer) => {
  const mode = modeOf(payment.payment_method);
  if (!mode) return { skip: `Paid by ${payment.payment_method}, which FlowBook has no account for yet` };
  if (!customerOf(customer)) return { skip: 'A payment with no customer cannot clear a receivable' };
  return { payload: { payment_id: String(payment.payment_id), invoice_id: String(payment.invoice_id), date: String(payment.payment_date).slice(0, 10), customer: customerOf(customer), mode, amount_minor: n(payment.amount_paise),
    ...(payment.reference_number ? { reference: payment.reference_number } : {}) } };
};

/* ---- the wire: the envelope and its signature (contract section 2) */

export const envelope = ({ eventId, type, businessId, sequence, occurredAt, payload }) =>
  JSON.stringify({ event_id: eventId, event_type: type, schema_version: 1, business_id: String(businessId), sequence: String(sequence), occurred_at: occurredAt, payload });

/** `t=<unix>,v1=<hmac_sha256(secret, t + "." + body)>`, over the exact bytes that are sent. */
export const signature = (secret, body, nowSeconds = Math.floor(Date.now() / 1000)) =>
  `t=${nowSeconds},v1=${crypto.createHmac('sha256', secret).update(`${nowSeconds}.${body}`).digest('hex')}`;
