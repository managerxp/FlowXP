/*
 * Loyalty engine, phase 3: how a programme's card looks (card: colours, wording, icon, an in-card message) and the unguessable code in its join link / QR / NFC tag.
 * The join code only lets someone become a member of that one programme; it opens nothing else.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE loyalty_programmes ADD COLUMN card JSONB NOT NULL DEFAULT '{}'::jsonb, ADD COLUMN join_code VARCHAR(32)`);
  await client.query(`UPDATE loyalty_programmes SET join_code = substr(md5(random()::text || programme_id::text || clock_timestamp()::text), 1, 16) WHERE join_code IS NULL`);
  await client.query(`ALTER TABLE loyalty_programmes ALTER COLUMN join_code SET NOT NULL, ALTER COLUMN join_code SET DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 16)`);
  await client.query(`CREATE UNIQUE INDEX uq_loyalty_programmes_join_code ON loyalty_programmes (join_code)`);
};
