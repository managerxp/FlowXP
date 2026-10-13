/*
 * The gaming lounge module, part 3: the wallet's top-up bonus. "Pay 500, get 50 extra" is a list of rules on the settings: when a top-up is at least
 * `min` rupees it earns the `bonus` of the highest rule it reaches. Forward only; to undo by hand: ALTER TABLE gaming_settings DROP COLUMN topup_bonus.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE gaming_settings ADD COLUMN topup_bonus JSONB NOT NULL DEFAULT '[]'::jsonb`);
};
