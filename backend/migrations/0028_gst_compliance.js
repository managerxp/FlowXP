/*
 * GST compliance data: pincodes (needed on e-invoices and e-way bills), the business's GST filing choices, and the
 * numbers the government portals hand back (IRN for an e-invoice, e-way bill number).
 *
 * FlowXP prepares the files (GSTR-1 JSON, e-invoice JSON, e-way bill JSON) and the GSTR-3B figures; the owner or their
 * accountant uploads them on the government portal, and records the number the portal returns.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE branches ADD COLUMN pincode VARCHAR(6)`);
  await client.query(`ALTER TABLE customers ADD COLUMN pincode VARCHAR(6)`);
  await client.query(`ALTER TABLE businesses ADD COLUMN gst_settings JSONB NOT NULL DEFAULT '{}'::jsonb`);

  await client.query(`ALTER TABLE invoices ADD COLUMN irn VARCHAR(64)`);
  await client.query(`ALTER TABLE invoices ADD COLUMN irn_ack_no VARCHAR(32)`);
  await client.query(`ALTER TABLE invoices ADD COLUMN irn_ack_date DATE`);
  await client.query(`ALTER TABLE invoices ADD COLUMN eway_bill_no VARCHAR(20)`);
  await client.query(`ALTER TABLE invoices ADD COLUMN eway_bill_date DATE`);
  await client.query(`CREATE UNIQUE INDEX uq_invoices_irn ON invoices (irn) WHERE irn IS NOT NULL`);
};
