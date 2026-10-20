/*
 * Workshop job cards for a parts shop that also services vehicles (modules/autoparts/jobcards.js).
 *
 *   job_cards       one vehicle in for service: whose it is, which vehicle (registration, make and model, odometer), what is wrong, who is working on it, when it is promised,
 *                   where it stands (OPEN > IN_PROGRESS > WAITING_PARTS > READY > BILLED, or CANCELLED) and, once billed, which invoice it became
 *   job_card_lines  the spare parts fitted (a part line holds that stock for the customer, so nobody else sells it) and the labour charged
 *
 * The bill is an ordinary invoice, so stock, GST, payments, credit limits and returns all behave as they do at the counter. A job card never moves stock itself: it holds
 * stock while it is open and the invoice takes it. Forward only; a shop that never opens a job card is unchanged.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE autoparts_settings ADD COLUMN IF NOT EXISTS job_prefix VARCHAR(8) NOT NULL DEFAULT 'JC'`);
  await client.query(`ALTER TABLE autoparts_settings ADD COLUMN IF NOT EXISTS job_next_no INTEGER NOT NULL DEFAULT 1`);
  await client.query(`ALTER TABLE autoparts_settings ADD COLUMN IF NOT EXISTS labour_tax_rate NUMERIC(5,2) NOT NULL DEFAULT 18 CHECK (labour_tax_rate BETWEEN 0 AND 100)`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS job_cards (
      job_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      job_no VARCHAR(24) NOT NULL,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      vehicle_reg VARCHAR(20) NOT NULL,
      vehicle_type VARCHAR(12) NOT NULL DEFAULT 'CAR',
      make VARCHAR(60),
      model VARCHAR(80),
      variant VARCHAR(60),
      model_id INTEGER REFERENCES vehicle_models(model_id) ON DELETE SET NULL,
      vehicle_year SMALLINT CHECK (vehicle_year IS NULL OR vehicle_year BETWEEN 1900 AND 2100),
      odometer_km INTEGER CHECK (odometer_km IS NULL OR odometer_km >= 0),
      complaint TEXT,
      diagnosis TEXT,
      notes TEXT,
      status VARCHAR(14) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','WAITING_PARTS','READY','BILLED','CANCELLED')),
      mechanic_id INTEGER REFERENCES hr_employees(employee_id) ON DELETE SET NULL,
      promised_on DATE,
      next_service_on DATE,
      next_service_km INTEGER CHECK (next_service_km IS NULL OR next_service_km >= 0),
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ready_at TIMESTAMPTZ,
      billed_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      UNIQUE (branch_id, job_no)
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_job_cards_branch_status ON job_cards (branch_id, status, opened_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_job_cards_reg ON job_cards (business_id, upper(vehicle_reg))`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_job_cards_customer ON job_cards (customer_id)`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS job_card_lines (
      line_id BIGSERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES job_cards(job_id) ON DELETE CASCADE,
      kind VARCHAR(8) NOT NULL CHECK (kind IN ('PART','LABOUR')),
      product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
      description VARCHAR(200) NOT NULL,
      quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
      unit_price_paise BIGINT NOT NULL CHECK (unit_price_paise >= 0),
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
      reservation_id INTEGER REFERENCES part_reservations(reservation_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((kind = 'PART' AND product_id IS NOT NULL) OR kind = 'LABOUR')
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_job_card_lines_job ON job_card_lines (job_id)`);
};
