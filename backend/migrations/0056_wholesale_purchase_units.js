/*
 * Wholesale module, part 5: buying in cartons.
 *
 * A purchase order line can be bought in the supplier's unit (a carton of 288 pieces). Quantity and unit cost are in
 * that unit — so a carton costing ₹600 is stored as 60000 paise, not as 208.33 paise × 288 — and unit_factor says
 * how many base units one of them is. Existing lines default to factor 1 and behave exactly as before.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS unit_name VARCHAR(24), ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK (unit_factor > 0)`);
  await client.query(`ALTER TABLE debit_note_items ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(14,4) NOT NULL DEFAULT 1`);
};

export const down = async (client) => {
  await client.query(`ALTER TABLE debit_note_items DROP COLUMN IF EXISTS unit_factor`);
  await client.query(`ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS unit_name, DROP COLUMN IF EXISTS unit_factor`);
};
