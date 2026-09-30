/*
 * Veg, non-veg or egg on a sold item: the green / red / yellow mark Indian
 * menus carry (and FSSAI asks for on packaged food). Optional; an item with no
 * mark simply shows none.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE products ADD COLUMN food_type VARCHAR(8) CHECK (food_type IN ('VEG','NON_VEG','EGG'))`);
};
