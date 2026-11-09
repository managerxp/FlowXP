/* When the running bill of an open order was printed for the guest (the floor shows it as "Bill printed" until it is paid). */
export const up = async (client) => {
  await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_printed_at TIMESTAMPTZ`);
};
