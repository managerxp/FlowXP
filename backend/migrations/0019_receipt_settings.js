/*
 * Receipt and slip printing preferences, per business: paper width (58 or 80 mm
 * thermal rolls), a footer line, and which optional blocks appear (GSTIN, a UPI
 * QR for unpaid balances, the loyalty card line). Kept as one JSON object because
 * it is only ever read and written as a whole; the API validates every key.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN receipt_settings JSONB NOT NULL DEFAULT '{}'::jsonb`);
};
