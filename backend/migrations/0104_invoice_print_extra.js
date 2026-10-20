/*
 * What a tax invoice carries beyond the bill itself and that differs from sale to sale: the consignee (ship to), the buyer's address
 * and state as they should print, delivery note, reference, order and dispatch details, destination, payment terms. Free text the
 * counter fills in when printing, kept on the invoice so a reprint matches. Forward only.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS print_extra JSONB NOT NULL DEFAULT '{}'::jsonb`);
};
