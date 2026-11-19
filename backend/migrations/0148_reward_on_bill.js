/*
 * A claimed loyalty reward can be used on a bill: the bill records which claim it used and how much it took off. A claim can be used on one bill at a time;
 * cancelling that bill frees it again.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE loyalty_redemptions ADD COLUMN applied_invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL, ADD COLUMN applied_paise BIGINT`);
  await client.query(`CREATE UNIQUE INDEX uq_loyalty_redemptions_applied ON loyalty_redemptions (applied_invoice_id) WHERE applied_invoice_id IS NOT NULL`);
};
