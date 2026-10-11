/*
 * A café starts with Size, Milk, Sugar and Add-ons, not a restaurant's Spice level and veg / non-veg extras
 * (modules/defaultOptions.js). Migration 0070 gave every existing café the restaurant set, so this swaps it for the café set,
 * but ONLY where nothing has been built on it: the café's groups are exactly those three defaults and not one dish uses any of
 * them. A café that attached them to dishes, added its own groups, or renamed anything is left exactly as it is.
 */
import { addDefaultOptionGroups, FOOD_TYPES } from '../src/modules/defaultOptions.js';

export const up = async (client) => {
  void FOOD_TYPES;
  const { rows } = await client.query(`SELECT business_id FROM businesses WHERE business_type = 'CAFE'`);
  for (const { business_id } of rows) {
    const groups = (await client.query(`SELECT group_id, name FROM modifier_groups WHERE business_id = $1`, [business_id])).rows;
    const untouched = groups.length === 3 && ['Spice level', 'Veg extras', 'Non-veg extras'].every((n) => groups.some((g) => g.name === n));
    if (!untouched) continue;
    const used = (await client.query(`SELECT 1 FROM product_modifier_groups WHERE group_id = ANY($1::int[]) LIMIT 1`, [groups.map((g) => g.group_id)])).rows.length;
    if (used) continue;
    await client.query(`DELETE FROM modifier_groups WHERE business_id = $1`, [business_id]);   // their options go with them
    await addDefaultOptionGroups(client, business_id, 'CAFE');
  }
};
