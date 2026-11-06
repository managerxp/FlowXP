/* A product's name in the other languages (hi, ml, ta, bn, te, kn), so the catalogue reads in the language the person chose. `name` stays as typed. */
export const up = async (client) => {
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS name_i18n JSONB NOT NULL DEFAULT '{}'::jsonb`);
};
