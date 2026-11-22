/*
 * Dues control: an optional credit limit per member (the most they may owe before the door stops them) and a payment promise (a date they said they would pay by).
 * What a member owes is never stored: it is the unpaid balance on their invoices. Forward only. To undo by hand: drop the four columns.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE gym_members
    ADD COLUMN credit_limit_paise BIGINT CHECK (credit_limit_paise IS NULL OR credit_limit_paise >= 0),
    ADD COLUMN promise_on DATE,
    ADD COLUMN promise_paise BIGINT CHECK (promise_paise IS NULL OR promise_paise > 0),
    ADD COLUMN promise_note VARCHAR(200)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_invoices_customer_due ON invoices (business_id, customer_id) WHERE balance_due_paise > 0`);
};
