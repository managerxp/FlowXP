/*
 * Charging a restaurant bill to a guest's room.
 *
 * The restaurant bill is a normal GST invoice made at the till (so its GST, number, stock and kitchen ticket are all as usual), left unpaid on the guest's customer record, and
 * a line pointing at it is put on the guest's folio (`folio_charges.invoiced`). That line is on the guest's bill for what they owe, but it is not hotel revenue (the restaurant
 * already counted the sale on the day) and it is not billed again at check-out: at check-out the guest pays, and the payment is applied to that invoice.
 *
 * Two small SQL functions give every screen the same answer to "what has this stay been charged, and what has been paid":
 *   hotel_charges_paise(booking)   room-side charges (not the posted restaurant lines) + the totals of the posted restaurant invoices that have not been cancelled
 *   hotel_paid_paise(booking)      what the guest paid into the folio (advances and payments less refunds) + what has been paid straight onto those restaurant invoices
 *                                  (not the part applied at check-out: that money is already in the folio payments, and is only being shared out between the invoices)
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE folio_charges ADD COLUMN IF NOT EXISTS invoiced BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_folio_posted_invoice ON folio_charges (ref_id) WHERE ref_type = 'invoice' AND voided_at IS NULL`);
  await client.query(`
    CREATE OR REPLACE FUNCTION hotel_charges_paise(b INTEGER) RETURNS BIGINT AS $$
      SELECT COALESCE((SELECT SUM(amount_paise + tax_paise) FROM folio_charges WHERE booking_id = b AND voided_at IS NULL AND NOT invoiced), 0)
           + COALESCE((SELECT SUM(i.total_paise) FROM folio_charges c JOIN invoices i ON i.invoice_id = c.ref_id WHERE c.booking_id = b AND c.invoiced AND c.voided_at IS NULL AND i.status <> 'CANCELLED'), 0)
    $$ LANGUAGE SQL STABLE`);
  await client.query(`
    CREATE OR REPLACE FUNCTION hotel_paid_paise(b INTEGER) RETURNS BIGINT AS $$
      SELECT COALESCE((SELECT SUM(CASE WHEN kind = 'REFUND' THEN -amount_paise ELSE amount_paise END) FROM folio_payments WHERE booking_id = b), 0)
           + COALESCE((SELECT SUM(p.amount_paise) FROM folio_charges c JOIN payments p ON p.invoice_id = c.ref_id WHERE c.booking_id = b AND c.invoiced AND c.voided_at IS NULL AND COALESCE(p.reference_number, '') NOT LIKE 'Stay %'), 0)
    $$ LANGUAGE SQL STABLE`);
};
