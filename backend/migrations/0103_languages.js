/*
 * Language preferences. users.language is a person's own choice (NULL = they never chose, so the business default and then
 * their device decide); businesses.default_language is what a business's staff see until they choose for themselves.
 * Display text only: neither column touches currency, timezone, tax or money. Forward only.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(5)`);
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS default_language VARCHAR(5)`);
};
