/*
 * Charge to room: a restaurant bill made at the till for an in-house guest, put on their folio instead of being paid at the till.
 *
 * Done in the same transaction as the bill, by the till's own save (`charge_to_booking_id` on the sale or the order bill): the guest's billing customer is used for the invoice,
 * nothing is taken as payment, and a line for the invoice is put on the folio. See migration 0086 for how that line is counted.
 */
import { HotelError, getProperty } from './common.js';
import { customerFor } from './stay.js';

/** In-house guests, for the till's "Charge to room" picker. q matches a room number or a name. */
export const inHouseGuests = async (db, tenant, q = '') => {
  const like = q ? `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return (await db.query(
    `SELECT b.booking_id, b.res_no, g.name AS guest_name, g.phone, g.is_vip, string_agg(r.room_no, ', ' ORDER BY r.room_no) AS rooms, hotel_charges_paise(b.booking_id) - hotel_paid_paise(b.booking_id) AS balance_paise
     FROM hotel_bookings b JOIN guests g ON g.guest_id = b.guest_id JOIN hotel_booking_rooms x ON x.booking_id = b.booking_id AND x.status = 'IN_HOUSE' JOIN rooms r ON r.room_id = x.room_id
     WHERE b.branch_id = $1 AND b.status = 'CHECKED_IN' AND ($2::text IS NULL OR lower(g.name) LIKE lower($2) OR EXISTS (SELECT 1 FROM hotel_booking_rooms y JOIN rooms ry ON ry.room_id = y.room_id WHERE y.booking_id = b.booking_id AND y.status = 'IN_HOUSE' AND ry.room_no ILIKE $2))
     GROUP BY b.booking_id, b.res_no, g.name, g.phone, g.is_vip ORDER BY MIN(r.room_no) LIMIT 40`, [tenant.branchId, like])).rows;
};

/** The billing customer for an in-house guest, checked before the bill is made. */
export const roomGuestCustomer = async (client, tenant, bookingId) => {
  const b = (await client.query(`SELECT b.*, g.name FROM hotel_bookings b JOIN guests g ON g.guest_id = b.guest_id WHERE b.booking_id = $1 AND b.branch_id = $2 FOR UPDATE OF b`, [bookingId, tenant.branchId])).rows[0];
  if (!b) throw new HotelError(404, 'That guest was not found');
  if (b.status !== 'CHECKED_IN') throw new HotelError(409, `${b.name} is not in the hotel`);
  const guest = (await client.query(`SELECT * FROM guests WHERE guest_id = $1`, [b.guest_id])).rows[0];
  return customerFor(client, tenant, guest);
};

/** Put the saved restaurant invoice on the guest's folio. */
export const postInvoiceToRoom = async (client, tenant, userId, { bookingId, invoiceId }) => {
  const inv = (await client.query(`SELECT invoice_id, invoice_number, total_paise, tax_paise, amount_paid_paise, status FROM invoices WHERE invoice_id = $1 AND business_id = $2`, [invoiceId, tenant.businessId])).rows[0];
  if (!inv) throw new HotelError(404, 'Bill not found');
  if (inv.status === 'CANCELLED') throw new HotelError(409, 'That bill is cancelled');
  if (Number(inv.amount_paid_paise) > 0) throw new HotelError(409, 'A bill that has been paid cannot be charged to a room');
  const property = await getProperty(client, tenant);
  const total = Number(inv.total_paise); const tax = Number(inv.tax_paise);
  const net = total - tax;
  const rate = net > 0 ? Math.min(100, Math.round((tax / net) * 10000) / 100) : 0;
  const { rows } = await client.query(
    `INSERT INTO folio_charges (business_id, branch_id, booking_id, charge_date, department, description, quantity, unit_price_paise, tax_rate, amount_paise, tax_paise, source, ref_type, ref_id, invoiced, created_by)
     VALUES ($1,$2,$3,$4,'FNB',$5,1,$6,$7,$6,$8,'POS','invoice',$9,TRUE,$10) RETURNING *`,
    [tenant.businessId, tenant.branchId, bookingId, property.business_date, `Restaurant bill ${inv.invoice_number}`, net, rate, tax, invoiceId, userId]);
  return rows[0];
};
