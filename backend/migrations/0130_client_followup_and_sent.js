/* Super Admin client management: tags and a follow-up date per client; and when a document was last emailed. */
export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS admin_tags TEXT[] NOT NULL DEFAULT '{}'`);
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS follow_up_on DATE`);
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS follow_up_note VARCHAR(200)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_businesses_follow_up ON businesses (follow_up_on) WHERE follow_up_on IS NOT NULL`);
  await client.query(`ALTER TABLE admin_documents ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE admin_documents ADD COLUMN IF NOT EXISTS emailed_to VARCHAR(160)`);
};
