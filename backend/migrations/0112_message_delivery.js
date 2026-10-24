/*
 * What happened to a WhatsApp message after it was handed to Meta: when it reached the phone and when it was read (Meta's status callbacks, POST /api/webhooks/whatsapp).
 * status stays SENT / FAILED as before; these two times only add to it. Forward only.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_provider_id ON messages (provider_id) WHERE provider_id IS NOT NULL`);
};
