/* Support center: a client raises a ticket, FlowXP's admin and the client write back and forth until it is closed. */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      ticket_id BIGSERIAL PRIMARY KEY,
      business_id INT REFERENCES businesses(business_id) ON DELETE CASCADE,
      user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
      subject VARCHAR(160) NOT NULL,
      category VARCHAR(20) NOT NULL DEFAULT 'OTHER',
      status VARCHAR(12) NOT NULL DEFAULT 'OPEN',          -- OPEN: waiting for us; ANSWERED: waiting for the client; CLOSED
      unread_admin BOOLEAN NOT NULL DEFAULT TRUE,
      unread_client BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_message_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TIMESTAMPTZ
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      message_id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT NOT NULL REFERENCES support_tickets(ticket_id) ON DELETE CASCADE,
      sender VARCHAR(8) NOT NULL,                           -- CLIENT | ADMIN
      user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_support_tickets_business ON support_tickets (business_id, last_message_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (status, last_message_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages (ticket_id, message_id)`);
};
