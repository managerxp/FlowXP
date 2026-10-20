/*
 * Reverse charge on purchases (modules/gstOptions.js): a purchase can be marked "tax payable on reverse charge". The supplier's invoice then carries no GST,
 * so what is owed to the supplier is the taxable value only (total_paise = subtotal_paise) and the GST on it (tax_paise) is the buyer's own to pay to the
 * government and to claim back as input credit in the same month (GSTR-3B 3.1(d) and 4A(3)). Forward only; every existing purchase stays an ordinary one.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS reverse_charge BOOLEAN NOT NULL DEFAULT FALSE`);
};
