/*
 * Trial reminders (modules/trialReminders.js): which reminder a business has already had, so each goes out once.
 * 0 = none, 1 = "ends soon", 2 = "ended". Forward only.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN trial_reminder SMALLINT NOT NULL DEFAULT 0`);
};
