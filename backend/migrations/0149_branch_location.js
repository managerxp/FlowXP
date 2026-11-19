/* Where an outlet is (latitude, longitude): a Google Wallet loyalty card can then nudge a member who is nearby. Optional; nothing else reads it. */
export const up = async (client) => {
  await client.query(`ALTER TABLE branches ADD COLUMN latitude NUMERIC(9,6) CHECK (latitude BETWEEN -90 AND 90), ADD COLUMN longitude NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180)`);
};
