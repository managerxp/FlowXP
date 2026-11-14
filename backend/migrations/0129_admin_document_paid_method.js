/* How an invoice was paid when it was not through the Cashfree link: UPI, bank transfer, cash, cheque. The date goes in paid_at, the reference in paid_note. */
export const up = async (client) => {
  await client.query(`ALTER TABLE admin_documents ADD COLUMN IF NOT EXISTS paid_method VARCHAR(20)`);
};
