/*
 * Other income: money that came in but is not a sale (interest, rent received, commission, a scrap sale). A plain list like expenses,
 * kept apart from them so no expense report changes; Profit & Loss and the Day Book add it. Forward only.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE other_income (
      income_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      category VARCHAR(60) NOT NULL,
      amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
      payment_method VARCHAR(16) NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH','UPI','CARD','BANK_TRANSFER','OTHER')),
      income_date DATE NOT NULL DEFAULT CURRENT_DATE,
      description TEXT,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_other_income_business_date ON other_income (business_id, income_date DESC)`);
};
