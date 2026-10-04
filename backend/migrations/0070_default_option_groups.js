/*
 * Spice level, Veg extras and Non-veg extras are now there from the start for a new restaurant, cafe or cloud
 * kitchen (modules/defaultOptions.js). This gives the same to the ones that already exist and have no option
 * groups at all; a business that set up its own groups is left exactly as it is.
 */
import { addDefaultOptionGroups, FOOD_TYPES } from '../src/modules/defaultOptions.js';

export const up = async (client) => {
  const { rows } = await client.query(`SELECT business_id FROM businesses WHERE business_type = ANY($1::text[])`, [FOOD_TYPES]);
  for (const { business_id } of rows) await addDefaultOptionGroups(client, business_id);
};
