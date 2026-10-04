/*
 * The option groups every food business starts with, so "Spice level" and the extras are ready on the Options &
 * add-ons screen from the first day (the owner then ticks which dishes offer them). Extras are split in two, veg
 * and non-veg, so a veg dish is never offered "Extra chicken". Prices are a starting point the owner can edit.
 * A business that already has option groups is left alone, so this never doubles up or overrides its own setup.
 */
export const FOOD_TYPES = ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN'];

export const DEFAULT_OPTION_GROUPS = [
  { name: 'Spice level', variant: true, options: [['Mild', 0], ['Medium', 0], ['Hot', 0]] },
  { name: 'Veg extras', variant: false, min: 0, max: 3, options: [['Extra cheese', 40], ['Extra paneer', 60], ['Extra butter', 15], ['Extra vegetables', 30]] },
  { name: 'Non-veg extras', variant: false, min: 0, max: 3, options: [['Extra chicken', 60], ['Fried egg', 20], ['Extra mutton', 90]] }
];

/** @param client a pg client or pool */
export const addDefaultOptionGroups = async (client, businessId) => {
  const has = await client.query(`SELECT 1 FROM modifier_groups WHERE business_id = $1 LIMIT 1`, [businessId]);
  if (has.rows.length) return false;
  let order = 0;
  for (const g of DEFAULT_OPTION_GROUPS) {
    const { rows } = await client.query(
      `INSERT INTO modifier_groups (business_id, name, is_variant, min_select, max_select, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING group_id`,
      [businessId, g.name, g.variant, g.variant ? 1 : g.min, g.variant ? 1 : g.max, order++]
    );
    let n = 0;
    for (const [name, rupees] of g.options) {
      await client.query(`INSERT INTO modifiers (group_id, business_id, name, price_delta_paise, sort_order) VALUES ($1,$2,$3,$4,$5)`, [rows[0].group_id, businessId, name, rupees * 100, n++]);
    }
  }
  return true;
};
