/* An invoice can carry a plan and a period: paying it (online, UPI, bank, cash...) switches the client's subscription on and sets when it ends. */
export const up = async (client) => {
  await client.query(`ALTER TABLE admin_documents ADD COLUMN IF NOT EXISTS plan_code VARCHAR(40)`);
  await client.query(`ALTER TABLE admin_documents ADD COLUMN IF NOT EXISTS plan_cycle VARCHAR(10)`);
  await client.query(`ALTER TABLE admin_documents ADD COLUMN IF NOT EXISTS plan_applied BOOLEAN NOT NULL DEFAULT FALSE`);
};
