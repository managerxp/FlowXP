/*
 * GST options (modules/gstOptions.js): the business's on/off switches, a cess rate per product, and what a bill carries because of them:
 * cess on each line and in total, TCS added, TDS deducted by the customer, the reverse-charge mark and whether it is a Bill of Supply
 * (composite scheme). Forward only; every default keeps today's behaviour.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS gst_settings JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cess_rate NUMERIC(5,2) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cess_paise BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cess_paise BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tcs_paise BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tds_paise BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reverse_charge BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bill_of_supply BOOLEAN NOT NULL DEFAULT FALSE`);
};
