/*
 * The option groups a food business starts with, so they are ready on the Options & add-ons screen from the first day (the
 * owner then ticks which dishes or drinks offer them). A restaurant and a café start with different sets: a restaurant gets
 * Spice level and veg / non-veg extras (so a veg dish is never offered "Extra chicken"); a café gets Size, Milk, Sugar and
 * add-ons like an extra shot. Prices are a starting point the owner can edit.
 * A business that already has option groups is left alone, so this never doubles up or overrides its own setup.
 */
export const FOOD_TYPES = ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN'];

const RESTAURANT_GROUPS = [
  { name: 'Spice level', variant: true, options: [['Mild', 0], ['Medium', 0], ['Hot', 0]] },
  { name: 'Veg extras', variant: false, min: 0, max: 3, options: [['Extra cheese', 40], ['Extra paneer', 60], ['Extra butter', 15], ['Extra vegetables', 30]] },
  { name: 'Non-veg extras', variant: false, min: 0, max: 3, options: [['Extra chicken', 60], ['Fried egg', 20], ['Extra mutton', 90]] }
];

/* A drink is picked by size, milk and sugar (one of each), then topped up with add-ons. Oat and almond cost more than dairy. */
export const CAFE_GROUPS = [
  { name: 'Size', variant: true, options: [['Small', 0], ['Regular', 20], ['Large', 40]] },
  { name: 'Milk', variant: true, options: [['Full cream', 0], ['Toned', 0], ['Oat', 40], ['Almond', 50], ['Soy', 40]] },
  { name: 'Sugar', variant: true, options: [['Regular', 0], ['Less sugar', 0], ['No sugar', 0]] },
  { name: 'Add-ons', variant: false, min: 0, max: 3, options: [['Extra shot', 40], ['Flavour syrup', 30], ['Whipped cream', 30], ['Chocolate drizzle', 25]] }
];

export const DEFAULT_OPTION_GROUPS = RESTAURANT_GROUPS;
export const defaultGroupsFor = (businessType) => (businessType === 'CAFE' ? CAFE_GROUPS : RESTAURANT_GROUPS);

/** @param client a pg client or pool; @param businessType picks the set (a café's differs from a restaurant's) */
export const addDefaultOptionGroups = async (client, businessId, businessType = 'RESTAURANT') => {
  const has = await client.query(`SELECT 1 FROM modifier_groups WHERE business_id = $1 LIMIT 1`, [businessId]);
  if (has.rows.length) return false;
  let order = 0;
  for (const g of defaultGroupsFor(businessType)) {
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
