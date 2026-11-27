/*
 * What a guest chooses on the reservation page: the owner's own lists of "what are you booking" (lunch, birthday ...) and optional extras (cake, high chair ...).
 * The guest's choice is written at the front of the reservation's notes, so every screen that already shows notes shows it.
 * Forward only. To undo by hand: drop the two columns.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE reservation_settings ADD COLUMN services JSONB NOT NULL DEFAULT '[]'::jsonb, ADD COLUMN extras JSONB NOT NULL DEFAULT '[]'::jsonb`);
};
