/*
 * A delivery-platform order (Zomato/Swiggy/ONDC/Magicpin) no longer goes
 * straight to the kitchen. It arrives as PENDING_ACCEPT — no KOT, no sent
 * items — until someone at the counter accepts or rejects it. See
 * integrations.controller.js's webhook/ingestOrder and orders.controller.js's
 * new accept()/reject().
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check`);
  await client.query(`
    ALTER TABLE orders ADD CONSTRAINT orders_status_check
      CHECK (status IN ('PENDING_ACCEPT','OPEN','PREPARING','READY','SERVED','BILLED','CANCELLED','MERGED'))
  `);

  // Why an order was rejected (customer-facing platforms want a reason, and so does the owner reviewing later).
  await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);
};
