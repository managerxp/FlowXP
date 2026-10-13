/*
 * Automotive spare parts, part 3: goods receipt additions on top of the wholesale GRN tables (wholesale_grns / wholesale_grn_items are reused, not copied).
 *   rejected_base     what arrived and was refused at the door (not stock, not damaged stock: it goes back to the supplier)
 *   bin_location_id   the bin the receiver chose for the line (the put-away happens on receipt; without one a put-away task is opened)
 *   cancelled_*       a receipt can be cancelled (reversed) while its stock is still there
 * Forward only.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE wholesale_grn_items ADD COLUMN IF NOT EXISTS rejected_base NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (rejected_base >= 0)`);
  await client.query(`ALTER TABLE wholesale_grn_items ADD COLUMN IF NOT EXISTS bin_location_id INTEGER REFERENCES warehouse_locations(location_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE wholesale_grns ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE wholesale_grns ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE wholesale_grns ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(200)`);
};
