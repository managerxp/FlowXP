/*
 * Job card flow for the garage: a Checking stage before the work starts, the customer's yes to the estimate on record, a separate Delivered step after billing
 * (the vehicle is handed over), and what the counter noted when the vehicle came in (fuel in the tank, things left inside).
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE job_cards DROP CONSTRAINT IF EXISTS job_cards_status_check`);
  await client.query(`ALTER TABLE job_cards ADD CONSTRAINT job_cards_status_check CHECK (status IN ('OPEN','CHECKING','IN_PROGRESS','WAITING_PARTS','READY','BILLED','CANCELLED'))`);
  await client.query(`ALTER TABLE job_cards
    ADD COLUMN IF NOT EXISTS estimate_approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS estimate_approved_by VARCHAR(60),
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS fuel_level VARCHAR(8) CHECK (fuel_level IS NULL OR fuel_level IN ('EMPTY','QUARTER','HALF','THREE_Q','FULL')),
    ADD COLUMN IF NOT EXISTS belongings TEXT`);
};
