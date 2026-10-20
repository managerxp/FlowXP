/*
 * Printers a business has, and which one each kind of slip goes to (modules/printers.js). A printer belongs to one outlet, or to all of them
 * (branch_id NULL). Where a slip goes is kept per outlet in branches.print_routing: { receipt, takeaway, drawer, kot, stations: { <station_id>: <printer_id> } }.
 * Forward only; an outlet with no routing prints exactly as before (the device's own receipt / kitchen address, or the browser).
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS printers (
      printer_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE CASCADE,
      name VARCHAR(60) NOT NULL,
      connection VARCHAR(12) NOT NULL CHECK (connection IN ('NETWORK','USB','BLUETOOTH','BROWSER')),
      address VARCHAR(200) NOT NULL DEFAULT '',
      paper_width SMALLINT NOT NULL DEFAULT 80 CHECK (paper_width IN (58, 80)),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_printer_name ON printers (business_id, lower(name))`);
  await client.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS print_routing JSONB NOT NULL DEFAULT '{}'::jsonb`);
};
