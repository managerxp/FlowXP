/* 'INVENTORY_MANAGER' (17 chars) does not fit the original VARCHAR(16) role column. */
export const up = async (client) => {
  await client.query(`ALTER TABLE business_users ALTER COLUMN role TYPE VARCHAR(24)`);
};
