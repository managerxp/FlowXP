/*
 * Recipe (bill of materials) maths, kept out of controllers so billing, the
 * recipe editor and later profitability reports all price a dish identically.
 * Quantities are per ONE portion in the ingredient's own unit.
 */

/** Load recipes for a set of dishes: Map(dishId -> [{ ingredient_id, quantity, wastage_pct, ingredient_name, unit, price_paise }]). */
export const loadRecipes = async (client, businessId, dishIds) => {
  const map = new Map();
  if (!dishIds.length) return map;
  const { rows } = await client.query(
    `SELECT r.dish_product_id, r.ingredient_product_id, r.quantity, r.wastage_pct,
            i.name AS ingredient_name, i.unit, i.purchase_price_paise
     FROM recipe_items r
     JOIN products i ON i.product_id = r.ingredient_product_id
     WHERE r.business_id = $1 AND r.dish_product_id = ANY($2::int[])
     ORDER BY r.recipe_item_id`,
    [businessId, dishIds]
  );
  for (const r of rows) {
    if (!map.has(r.dish_product_id)) map.set(r.dish_product_id, []);
    map.get(r.dish_product_id).push({
      ingredient_id: r.ingredient_product_id,
      quantity: Number(r.quantity),
      wastage_pct: Number(r.wastage_pct),
      ingredient_name: r.ingredient_name,
      unit: r.unit,
      price_paise: Number(r.purchase_price_paise)
    });
  }
  return map;
};

/** What one portion consumes: recipe lines (with wastage) plus any modifier that carries an ingredient. */
export const consumptionPerUnit = (recipeRows = [], modifiers = []) => {
  const out = new Map();
  const add = (id, qty) => out.set(id, (out.get(id) || 0) + qty);
  for (const r of recipeRows) add(r.ingredient_id, r.quantity * (1 + r.wastage_pct / 100));
  for (const m of modifiers) if (m.ingredient_product_id && m.ingredient_qty) add(m.ingredient_product_id, Number(m.ingredient_qty));
  return [...out].map(([ingredient_id, qty_per_unit]) => ({ ingredient_id, qty_per_unit }));
};

/** Cost of one portion, in paise, from the ingredients' current purchase prices. */
export const recipeCostPaise = (recipeRows = []) =>
  Math.round(recipeRows.reduce((sum, r) => sum + r.quantity * (1 + r.wastage_pct / 100) * r.price_paise, 0));

/** Margin against the selling price (ex-tax). Null margin when the price is zero. */
export const recipeMargin = (costPaise, sellingPricePaise) => {
  const price = Number(sellingPricePaise);
  return {
    cost_paise: costPaise,
    gross_margin_paise: price - costPaise,
    gross_margin_pct: price > 0 ? Math.round(((price - costPaise) / price) * 1000) / 10 : null
  };
};
