/*
 * The folio: everything charged to a stay and everything the guest has paid.
 *
 *   charge   a line with a department, a date (the hotel's business date when it was posted), a quantity, a price before GST and a GST rate.
 *            Room charges are posted by night audit, one per room per night. Anything else is posted by hand (laundry, spa, a meal sent to the
 *            room). A charge is never deleted: it is voided with a reason, so the history stays.
 *   payment  an advance (before arrival), a payment (during the stay or at check-out), or a refund.
 *
 * balance = charges (with GST) - payments + refunds. Positive means the guest owes it.
 */
import { computeLineTax } from '../tax.js';
import { HotelError, DEPARTMENTS, FOLIO_METHODS } from './common.js';

export const taxFor = async (db, tenant, { quantity, unitPricePaise, taxRate }) => {
  const gst = (await db.query(`SELECT gst_enabled FROM businesses WHERE business_id = $1`, [tenant.businessId])).rows[0]?.gst_enabled;
  return computeLineTax({ quantity, unitPricePaise, discountPaise: 0, taxRatePercent: taxRate, gstEnabled: gst, interState: false, inclusive: false });
};

const bookingFor = async (db, tenant, bookingId, { lock = false } = {}) => {
  const b = (await db.query(`SELECT * FROM hotel_bookings WHERE booking_id = $1 AND branch_id = $2${lock ? ' FOR UPDATE' : ''}`, [bookingId, tenant.branchId])).rows[0];
  if (!b) throw new HotelError(404, 'Booking not found');
  return b;
};

export const totalsOf = async (db, bookingId) => {
  const c = (await db.query(
    `SELECT COALESCE(SUM(amount_paise + tax_paise) FILTER (WHERE NOT invoiced), 0)::bigint AS room_side, COALESCE(SUM(tax_paise) FILTER (WHERE NOT invoiced), 0)::bigint AS tax
     FROM folio_charges WHERE booking_id = $1 AND voided_at IS NULL`, [bookingId])).rows[0];
  const posted = (await db.query(
    `SELECT COALESCE(SUM(i.total_paise), 0)::bigint AS total, COALESCE(SUM(i.tax_paise), 0)::bigint AS tax,
            COALESCE(SUM((SELECT SUM(p.amount_paise) FROM payments p WHERE p.invoice_id = i.invoice_id AND COALESCE(p.reference_number, '') NOT LIKE 'Stay %')), 0)::bigint AS paid
     FROM folio_charges c JOIN invoices i ON i.invoice_id = c.ref_id WHERE c.booking_id = $1 AND c.invoiced AND c.voided_at IS NULL AND i.status <> 'CANCELLED'`, [bookingId])).rows[0];
  const p = (await db.query(`SELECT COALESCE(SUM(CASE WHEN kind = 'REFUND' THEN -amount_paise ELSE amount_paise END), 0)::bigint AS paid FROM folio_payments WHERE booking_id = $1`, [bookingId])).rows[0];
  const charges = Number(c.room_side) + Number(posted.total); const paid = Number(p.paid) + Number(posted.paid);
  return { charges_paise: charges, tax_paise: Number(c.tax) + Number(posted.tax), paid_paise: paid, balance_paise: charges - paid, restaurant_paise: Number(posted.total) };
};

export const folioOf = async (db, tenant, bookingId) => {
  await bookingFor(db, tenant, bookingId);
  const charges = (await db.query(
    `SELECT c.*, r.room_no, i.invoice_number, i.status AS invoice_status, i.balance_due_paise AS invoice_balance_paise
     FROM folio_charges c LEFT JOIN hotel_booking_rooms rr ON rr.rr_id = c.rr_id LEFT JOIN rooms r ON r.room_id = rr.room_id LEFT JOIN invoices i ON c.invoiced AND i.invoice_id = c.ref_id
     WHERE c.booking_id = $1 ORDER BY c.charge_date, c.charge_id`, [bookingId])).rows;
  const payments = (await db.query(`SELECT * FROM folio_payments WHERE booking_id = $1 ORDER BY fp_id`, [bookingId])).rows;
  return { charges, payments, totals: await totalsOf(db, bookingId) };
};

export const postCharge = async (client, tenant, userId, bookingId, v) => {
  const booking = await bookingFor(client, tenant, bookingId, { lock: true });
  if (booking.status !== 'CHECKED_IN') throw new HotelError(409, booking.status === 'CHECKED_OUT' ? 'This guest has checked out' : 'Charges can be posted once the guest has checked in');
  if (!DEPARTMENTS.includes(v.department)) throw new HotelError(400, 'Choose a department');
  const property = (await client.query(`SELECT business_date FROM hotel_properties WHERE branch_id = $1`, [tenant.branchId])).rows[0];
  if (v.rr_id) {
    const ok = (await client.query(`SELECT 1 FROM hotel_booking_rooms WHERE rr_id = $1 AND booking_id = $2`, [v.rr_id, bookingId])).rowCount;
    if (!ok) throw new HotelError(400, 'That room is not on this booking');
  }
  const tax = await taxFor(client, tenant, { quantity: v.quantity, unitPricePaise: v.unit_price_paise, taxRate: v.tax_rate });
  const { rows } = await client.query(
    `INSERT INTO folio_charges (business_id, branch_id, booking_id, rr_id, charge_date, department, description, quantity, unit_price_paise, tax_rate, amount_paise, tax_paise, source, ref_type, ref_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [tenant.businessId, tenant.branchId, bookingId, v.rr_id || null, v.charge_date || property.business_date, v.department, v.description, v.quantity, v.unit_price_paise, v.tax_rate,
     tax.taxable_paise, tax.tax_paise, v.source || 'MANUAL', v.ref_type || null, v.ref_id || null, userId]);
  return rows[0];
};

export const voidCharge = async (client, tenant, userId, chargeId, reason) => {
  const c = (await client.query(`SELECT c.*, b.status FROM folio_charges c JOIN hotel_bookings b ON b.booking_id = c.booking_id WHERE c.charge_id = $1 AND c.branch_id = $2 FOR UPDATE OF c`, [chargeId, tenant.branchId])).rows[0];
  if (!c) throw new HotelError(404, 'Charge not found');
  if (c.voided_at) throw new HotelError(409, 'That charge is already voided');
  if (c.status !== 'CHECKED_IN') throw new HotelError(409, 'The guest has checked out, so the bill is closed');
  await client.query(`UPDATE folio_charges SET voided_at = CURRENT_TIMESTAMP, void_reason = $2 WHERE charge_id = $1`, [chargeId, reason]);
  return c;
};

export const addPayment = async (client, tenant, userId, bookingId, v) => {
  const booking = await bookingFor(client, tenant, bookingId, { lock: true });
  if (['CANCELLED', 'NO_SHOW'].includes(booking.status) && v.kind !== 'REFUND') throw new HotelError(409, 'This booking is cancelled');
  if (booking.status === 'CHECKED_OUT') throw new HotelError(409, 'This guest has checked out, so the bill is closed');
  if (!FOLIO_METHODS.includes(v.method)) throw new HotelError(400, 'Choose how it was paid');
  if (v.kind === 'ADVANCE' && booking.status === 'CHECKED_IN') v = { ...v, kind: 'PAYMENT' };
  if (v.kind === 'REFUND') {
    const have = (await client.query(`SELECT COALESCE(SUM(CASE WHEN kind = 'REFUND' THEN -amount_paise ELSE amount_paise END), 0)::bigint AS n FROM folio_payments WHERE booking_id = $1`, [bookingId])).rows[0].n;
    if (v.amount_paise > Number(have)) throw new HotelError(409, 'That is more than the guest has paid');
  }
  const property = (await client.query(`SELECT business_date FROM hotel_properties WHERE branch_id = $1`, [tenant.branchId])).rows[0];
  const { rows } = await client.query(
    `INSERT INTO folio_payments (business_id, branch_id, booking_id, kind, method, amount_paise, reference, pay_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [tenant.businessId, tenant.branchId, bookingId, v.kind, v.method, v.amount_paise, v.reference || null, property.business_date, userId]);
  return rows[0];
};
