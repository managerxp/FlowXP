/* Client reviews the Super Admin writes and shows on the home page: the person's photo, their company logo, the words and a star rating. */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS testimonials (
      testimonial_id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      role VARCHAR(120),
      company VARCHAR(160),
      quote TEXT NOT NULL,
      rating SMALLINT NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
      photo_url TEXT,
      logo_url TEXT,
      is_published BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_testimonials_published ON testimonials (is_published, sort_order)`);
};
