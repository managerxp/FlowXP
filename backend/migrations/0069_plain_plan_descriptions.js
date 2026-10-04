/*
 * Plan descriptions are shown on the public pricing page. They were written with a spaced em-dash as a separator
 * ("Essential tools to run day-to-day operations — for small businesses"); the site no longer uses that character.
 * Each is rewritten with a comma. Wording is otherwise unchanged, and a plan that was edited since keeps its own text
 * (only descriptions that still contain the dash are touched).
 */
export const up = async (client) => {
  await client.query(`UPDATE plans SET description = replace(description, ' — ', ', ') WHERE description LIKE '% — %'`);
  const { rows } = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'plan_versions' AND column_name = 'description'`);
  if (rows.length) await client.query(`UPDATE plan_versions SET description = replace(description, ' — ', ', ') WHERE description LIKE '% — %'`);
};
