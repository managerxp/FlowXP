/*
 * Online booking: a public page (/book/<slug>) where a client picks services, a time and a person without
 * signing in. Off until the owner switches it on and chooses an address (slug) in Salon settings.
 */
export const up = async (client) => {
  await client.query(`
    ALTER TABLE salon_settings
      ADD COLUMN online_booking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN online_booking_slug VARCHAR(40),
      ADD COLUMN online_booking_notice VARCHAR(300)
  `);
  await client.query(`CREATE UNIQUE INDEX idx_salon_settings_booking_slug ON salon_settings (lower(online_booking_slug)) WHERE online_booking_slug IS NOT NULL`);
};

export const down = async (client) => {
  await client.query(`DROP INDEX IF EXISTS idx_salon_settings_booking_slug`);
  await client.query(`ALTER TABLE salon_settings DROP COLUMN IF EXISTS online_booking_enabled, DROP COLUMN IF EXISTS online_booking_slug, DROP COLUMN IF EXISTS online_booking_notice`);
};
