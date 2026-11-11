/* A kitchen that works from printed tickets is told about a cancelled dish by a "CANCELLED" slip. It is a ticket of its own (is_cancel), linked from the cancelled lines. */
export const up = async (client) => {
  await client.query(`ALTER TABLE kot_tickets ADD COLUMN IF NOT EXISTS is_cancel BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cancel_kot_id INTEGER REFERENCES kot_tickets(kot_id) ON DELETE SET NULL`);
};
