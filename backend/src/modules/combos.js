/*
 * Combo maths, shared by billing, orders and the kitchen.
 * A combo is a product with is_combo = TRUE and rows in combo_items.
 */
import { consumptionPerUnit } from './recipes.js';
import { outletSettingsFor } from './menu.js';
import { stockAt } from './stock.js';

/** Map(comboId -> [{ component_id, name, quantity, status, track_inventory }]) for the combos among `ids`. */
export const loadCombos = async (db, businessId, ids) => {
  const map = new Map();
  if (!ids.length) return map;
  const { rows } = await db.query(
    `SELECT ci.combo_product_id, ci.component_product_id, ci.quantity, p.name, p.status, p.track_inventory, p.selling_price_paise
     FROM combo_items ci JOIN products p ON p.product_id = ci.component_product_id
     WHERE ci.business_id = $1 AND ci.combo_product_id = ANY($2::int[]) ORDER BY ci.combo_item_id`,
    [businessId, ids]
  );
  for (const r of rows) {
    if (!map.has(r.combo_product_id)) map.set(r.combo_product_id, []);
    map.get(r.combo_product_id).push({
      component_id: r.component_product_id, name: r.name, quantity: Number(r.quantity),
      status: r.status, track_inventory: r.track_inventory, price_paise: Number(r.selling_price_paise)
    });
  }
  return map;
};

/** "1 × Burger", "2 × Fries" for a kitchen slip. */
export const componentLabels = (components = []) => components.map((c) => `${c.quantity} × ${c.name}`);

/**
 * What one combo uses: for each component, its own stock when it is tracked
 * (a bottled drink) plus whatever its recipe consumes (a burger's patty and bun).
 * `recipes` is loadRecipes() for the component ids.
 */
export const comboConsumption = (components, recipes) => {
  const out = new Map();
  const add = (id, qty) => out.set(id, (out.get(id) || 0) + qty);
  for (const c of components) {
    if (c.track_inventory) add(c.component_id, c.quantity);
    for (const r of consumptionPerUnit(recipes.get(c.component_id))) add(r.ingredient_id, r.qty_per_unit * c.quantity);
  }
  return [...out].map(([ingredient_id, qty_per_unit]) => ({ ingredient_id, qty_per_unit }));
};

/**
 * Why a combo can't be sold at this outlet right now, or null: a component that is archived or switched off
 * here, or (when `quantity` is given) a stocked component that has run out.
 */
export const comboBlocker = async (db, branchId, combo, components, quantity = null) => {
  const ids = components.map((c) => c.component_id);
  const settings = await outletSettingsFor(db, branchId, ids);
  for (const c of components) {
    if (c.status !== 'ACTIVE') return `${combo} includes ${c.name}, which is archived`;
    if (settings.get(c.component_id)?.is_available === false) return `${combo} includes ${c.name}, which is not available at this outlet`;
  }
  if (quantity != null) {
    const stock = await stockAt(db, branchId, ids);
    for (const c of components) {
      if (c.track_inventory && stock.get(c.component_id) < c.quantity * quantity) return `Not enough ${c.name} for ${combo} (${stock.get(c.component_id)} left here)`;
    }
  }
  return null;
};
