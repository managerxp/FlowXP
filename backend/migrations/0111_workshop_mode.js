/*
 * "Mechanic mode": a spare parts shop that also services vehicles switches it on and gets job cards, labour and staff and payroll in its menu; a shop that only sells
 * parts leaves it off and does not see them. Shops that already exist keep what they have (on); a new one starts off. The owner can change it any time in Settings.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS workshop_mode BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`UPDATE businesses SET workshop_mode = TRUE WHERE business_type = 'AUTO_PARTS'`);
};
