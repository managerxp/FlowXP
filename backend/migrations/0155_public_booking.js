/*
 * Public booking links. A restaurant or hotel gets a reservation page of its own (address, hours, slot length, an optional percentage offer),
 * and a reservation records where it came from, the offer it was booked with and a short code the guest can quote.
 * A salon's online booking gets an optional offer, and every online appointment gets a token number (1, 2, 3 ... per outlet per day).
 * Forward only. To undo by hand: DROP TABLE reservation_settings and drop the added columns.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE reservation_settings (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(business_id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      slug VARCHAR(40),
      notice VARCHAR(300),
      open_time CHAR(5) NOT NULL DEFAULT '12:00',
      close_time CHAR(5) NOT NULL DEFAULT '22:30',
      slot_min INTEGER NOT NULL DEFAULT 30 CHECK (slot_min BETWEEN 15 AND 240),
      stay_min INTEGER NOT NULL DEFAULT 90 CHECK (stay_min BETWEEN 15 AND 480),
      max_party INTEGER NOT NULL DEFAULT 10 CHECK (max_party BETWEEN 1 AND 100),
      max_advance_days INTEGER NOT NULL DEFAULT 30 CHECK (max_advance_days BETWEEN 1 AND 365),
      offer_pct NUMERIC(5,2) CHECK (offer_pct IS NULL OR (offer_pct > 0 AND offer_pct <= 100)),
      offer_text VARCHAR(120),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_reservation_settings_slug ON reservation_settings (lower(slug)) WHERE slug IS NOT NULL`);
  await client.query(`ALTER TABLE reservations
      ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'STAFF' CHECK (source IN ('STAFF','ONLINE')),
      ADD COLUMN offer_pct NUMERIC(5,2),
      ADD COLUMN offer_text VARCHAR(120),
      ADD COLUMN code VARCHAR(8)`);
  await client.query(`ALTER TABLE salon_settings ADD COLUMN online_booking_offer_pct NUMERIC(5,2) CHECK (online_booking_offer_pct IS NULL OR (online_booking_offer_pct > 0 AND online_booking_offer_pct <= 100)),
      ADD COLUMN online_booking_offer_text VARCHAR(120)`);
  await client.query(`ALTER TABLE salon_appointments ADD COLUMN token_no INTEGER, ADD COLUMN offer_pct NUMERIC(5,2), ADD COLUMN offer_text VARCHAR(120)`);
};
