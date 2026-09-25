/*
 * Modifier groups (including variants) and recipes — the parts of the menu
 * beyond name and price. Both attach to products; both are tenant-scoped on
 * every query, and every product/ingredient id in a body is re-checked against
 * the caller's business rather than trusted.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { toPaise, toRupees } from '../utils/money.js';
import { loadRecipes, recipeCostPaise, recipeMargin } from '../modules/recipes.js';
import { loadCombos } from '../modules/combos.js';

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });

const asGroup = (g, modifiers) => ({
  group_id: g.group_id,
  name: g.name,
  is_variant: g.is_variant,
  min_select: g.min_select,
  max_select: g.max_select,
  is_active: g.is_active,
  modifiers: modifiers.map((m) => ({
    modifier_id: m.modifier_id,
    name: m.name,
    price_delta: toRupees(m.price_delta_paise),
    ingredient_product_id: m.ingredient_product_id,
    ingredient_qty: m.ingredient_qty != null ? Number(m.ingredient_qty) : null,
    is_active: m.is_active
  }))
});

const loadGroups = async (businessId, { all = false, groupId = null } = {}) => {
  const groups = (await pool.query(
    `SELECT * FROM modifier_groups WHERE business_id = $1 ${all ? '' : 'AND is_active'} ${groupId ? 'AND group_id = $2' : ''}
     ORDER BY sort_order, group_id`,
    groupId ? [businessId, groupId] : [businessId]
  )).rows;
  if (!groups.length) return [];
  const mods = (await pool.query(
    `SELECT * FROM modifiers WHERE business_id = $1 AND group_id = ANY($2::int[]) ${all ? '' : 'AND is_active'}
     ORDER BY sort_order, modifier_id`,
    [businessId, groups.map((g) => g.group_id)]
  )).rows;
  return groups.map((g) => asGroup(g, mods.filter((m) => m.group_id === g.group_id)));
};

/** Validate the shared shape of a group body; returns an error string or null. */
const checkGroupBody = (body) => {
  if (!body.name || !String(body.name).trim()) return 'Give the group a name';
  const min = body.min_select == null ? (body.is_variant ? 1 : 0) : Number(body.min_select);
  const max = body.max_select == null || body.max_select === '' ? (body.is_variant ? 1 : null) : Number(body.max_select);
  if (!Number.isInteger(min) || min < 0) return 'Minimum choices must be 0 or more';
  if (max != null && (!Number.isInteger(max) || max < 1 || max < min)) return 'Maximum choices must be at least 1 and not below the minimum';
  if (!Array.isArray(body.modifiers)) return 'Add at least one option';
  const usable = body.modifiers.filter((m) => m.is_active !== false);
  if (!usable.length) return 'Add at least one option';
  if (usable.length < min) return 'The minimum is more than the number of options';
  for (const m of body.modifiers) {
    if (!m.name || !String(m.name).trim()) return 'Every option needs a name';
    try { toPaise(m.price_delta ?? 0); } catch { return 'Option prices must be numbers'; }
  }
  return null;
};

/** Every ingredient id must be a product in this business. */
const ownsProducts = async (client, businessId, ids) => {
  const unique = [...new Set(ids.filter(Boolean).map(Number))];
  if (!unique.length) return true;
  const { rows } = await client.query(`SELECT 1 FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, unique]);
  return rows.length === unique.length;
};

/* GET /api/modifier-groups */
export const listGroups = async (req, res) => {
  res.json({ success: true, data: await loadGroups(req.tenant.businessId, { all: req.query.all === 'true' }) });
};

const writeModifiers = async (client, businessId, groupId, modifiers) => {
  const keep = [];
  let order = 0;
  for (const m of modifiers) {
    const price = toPaise(m.price_delta ?? 0);
    const ingredientQty = m.ingredient_product_id && m.ingredient_qty > 0 ? Number(m.ingredient_qty) : null;
    const ingredientId = ingredientQty ? m.ingredient_product_id : null;
    if (m.modifier_id) {
      const { rowCount } = await client.query(
        `UPDATE modifiers SET name = $1, price_delta_paise = $2, ingredient_product_id = $3, ingredient_qty = $4,
                sort_order = $5, is_active = $6
         WHERE modifier_id = $7 AND group_id = $8 AND business_id = $9`,
        [String(m.name).trim(), price, ingredientId, ingredientQty, order++, m.is_active !== false, m.modifier_id, groupId, businessId]
      );
      if (rowCount) { keep.push(Number(m.modifier_id)); continue; }
    }
    const { rows } = await client.query(
      `INSERT INTO modifiers (group_id, business_id, name, price_delta_paise, ingredient_product_id, ingredient_qty, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING modifier_id`,
      [groupId, businessId, String(m.name).trim(), price, ingredientId, ingredientQty, order++, m.is_active !== false]
    );
    keep.push(rows[0].modifier_id);
  }
  // Options dropped from the form are retired, not deleted: old bills keep their snapshot either way,
  // and a retired option can be brought back.
  await client.query(`UPDATE modifiers SET is_active = FALSE WHERE group_id = $1 AND business_id = $2 AND NOT (modifier_id = ANY($3::int[]))`, [groupId, businessId, keep]);
};

/* POST /api/modifier-groups */
export const createGroup = async (req, res) => {
  const body = req.body || {};
  const error = checkGroupBody(body);
  if (error) return bad(res, error);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await ownsProducts(client, req.tenant.businessId, body.modifiers.map((m) => m.ingredient_product_id)))) {
      await client.query('ROLLBACK');
      return bad(res, 'An ingredient was not found');
    }
    const isVariant = Boolean(body.is_variant);
    const min = body.min_select == null ? (isVariant ? 1 : 0) : Number(body.min_select);
    const max = body.max_select == null || body.max_select === '' ? (isVariant ? 1 : null) : Number(body.max_select);
    const { rows } = await client.query(
      `INSERT INTO modifier_groups (business_id, name, is_variant, min_select, max_select) VALUES ($1,$2,$3,$4,$5) RETURNING group_id`,
      [req.tenant.businessId, String(body.name).trim(), isVariant, min, max]
    );
    await writeModifiers(client, req.tenant.businessId, rows[0].group_id, body.modifiers);
    await client.query('COMMIT');
    recordAudit(req, { action: 'modifier_group.created', resource_type: 'modifier_group', resource_id: rows[0].group_id });
    const [group] = await loadGroups(req.tenant.businessId, { all: true, groupId: rows[0].group_id });
    res.status(201).json({ success: true, data: group });
  } catch (error2) {
    await client.query('ROLLBACK').catch(() => {});
    throw error2;
  } finally {
    client.release();
  }
};

/* PUT /api/modifier-groups/:id — replaces the group's settings and option list */
export const updateGroup = async (req, res) => {
  const body = req.body || {};
  const error = checkGroupBody(body);
  if (error) return bad(res, error);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await ownsProducts(client, req.tenant.businessId, body.modifiers.map((m) => m.ingredient_product_id)))) {
      await client.query('ROLLBACK');
      return bad(res, 'An ingredient was not found');
    }
    const isVariant = Boolean(body.is_variant);
    const min = body.min_select == null ? (isVariant ? 1 : 0) : Number(body.min_select);
    const max = body.max_select == null || body.max_select === '' ? (isVariant ? 1 : null) : Number(body.max_select);
    const { rowCount } = await client.query(
      `UPDATE modifier_groups SET name = $1, is_variant = $2, min_select = $3, max_select = $4, is_active = $5
       WHERE group_id = $6 AND business_id = $7`,
      [String(body.name).trim(), isVariant, min, max, body.is_active !== false, req.params.id, req.tenant.businessId]
    );
    if (!rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    await writeModifiers(client, req.tenant.businessId, Number(req.params.id), body.modifiers);
    await client.query('COMMIT');
    recordAudit(req, { action: 'modifier_group.updated', resource_type: 'modifier_group', resource_id: req.params.id });
    const [group] = await loadGroups(req.tenant.businessId, { all: true, groupId: Number(req.params.id) });
    res.json({ success: true, data: group });
  } catch (error2) {
    await client.query('ROLLBACK').catch(() => {});
    throw error2;
  } finally {
    client.release();
  }
};

/* PUT /api/products/:id/modifier-groups — the full set of groups this dish offers */
export const setProductGroups = async (req, res) => {
  const ids = Array.isArray(req.body?.group_ids) ? [...new Set(req.body.group_ids.map(Number))] : null;
  if (!ids) return bad(res, 'group_ids must be a list');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const product = await client.query(`SELECT 1 FROM products WHERE product_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId]);
    if (!product.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    if (ids.length) {
      const owned = await client.query(`SELECT 1 FROM modifier_groups WHERE business_id = $1 AND group_id = ANY($2::int[])`, [req.tenant.businessId, ids]);
      if (owned.rows.length !== ids.length) { await client.query('ROLLBACK'); return bad(res, 'A modifier group was not found'); }
    }
    await client.query(`DELETE FROM product_modifier_groups WHERE product_id = $1`, [req.params.id]);
    for (const id of ids) await client.query(`INSERT INTO product_modifier_groups (product_id, group_id) VALUES ($1,$2)`, [req.params.id, id]);
    await client.query('COMMIT');
    recordAudit(req, { action: 'product.modifiers_set', resource_type: 'product', resource_id: req.params.id, metadata: { group_ids: ids } });
    res.json({ success: true, data: { group_ids: ids } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* ── Recipes ───────────────────────────────────────────────────────────── */

const recipeResponse = async (client, businessId, productId) => {
  const product = (await client.query(
    `SELECT product_id, name, selling_price_paise, unit FROM products WHERE product_id = $1 AND business_id = $2`,
    [productId, businessId]
  )).rows[0];
  if (!product) return null;
  const rows = (await loadRecipes(client, businessId, [Number(productId)])).get(Number(productId)) || [];
  const margin = recipeMargin(recipeCostPaise(rows), product.selling_price_paise);
  return {
    product_id: product.product_id,
    name: product.name,
    selling_price: toRupees(product.selling_price_paise),
    ingredients: rows.map((r) => ({
      ingredient_id: r.ingredient_id,
      name: r.ingredient_name,
      unit: r.unit,
      quantity: r.quantity,
      wastage_pct: r.wastage_pct,
      cost: toRupees(Math.round(r.quantity * (1 + r.wastage_pct / 100) * r.price_paise))
    })),
    cost: toRupees(margin.cost_paise),
    gross_margin: toRupees(margin.gross_margin_paise),
    gross_margin_pct: margin.gross_margin_pct
  };
};

/* GET /api/products/:id/recipe */
export const getRecipe = async (req, res) => {
  const data = await recipeResponse(pool, req.tenant.businessId, req.params.id);
  if (!data) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data });
};

/* PUT /api/products/:id/recipe — replaces the whole recipe */
export const setRecipe = async (req, res) => {
  const items = Array.isArray(req.body?.ingredients) ? req.body.ingredients : null;
  if (!items) return bad(res, 'ingredients must be a list');

  const seen = new Set();
  for (const item of items) {
    const quantity = Number(item.quantity);
    const wastage = Number(item.wastage_pct ?? 0);
    if (!item.ingredient_id || !(quantity > 0)) return bad(res, 'Each ingredient needs a quantity above zero');
    if (!(wastage >= 0 && wastage < 100)) return bad(res, 'Wastage must be between 0 and 99%');
    if (Number(item.ingredient_id) === Number(req.params.id)) return bad(res, 'A dish cannot be its own ingredient');
    if (seen.has(Number(item.ingredient_id))) return bad(res, 'An ingredient is listed twice');
    seen.add(Number(item.ingredient_id));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await ownsProducts(client, req.tenant.businessId, [req.params.id, ...items.map((i) => i.ingredient_id)]))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Product or ingredient not found' });
    }
    await client.query(`DELETE FROM recipe_items WHERE dish_product_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId]);
    for (const item of items) {
      await client.query(
        `INSERT INTO recipe_items (business_id, dish_product_id, ingredient_product_id, quantity, wastage_pct) VALUES ($1,$2,$3,$4,$5)`,
        [req.tenant.businessId, req.params.id, item.ingredient_id, Number(item.quantity), Number(item.wastage_pct ?? 0)]
      );
    }
    const data = await recipeResponse(client, req.tenant.businessId, req.params.id);
    await client.query('COMMIT');
    recordAudit(req, { action: 'recipe.updated', resource_type: 'product', resource_id: req.params.id, metadata: { ingredients: items.length } });
    res.json({ success: true, data });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* ── Combos ────────────────────────────────────────────────────────────── */

const comboResponse = async (db, businessId, productId) => {
  const product = (await db.query(`SELECT product_id, name, selling_price_paise, is_combo FROM products WHERE product_id = $1 AND business_id = $2`, [productId, businessId])).rows[0];
  if (!product) return null;
  const parts = (await loadCombos(db, businessId, [Number(productId)])).get(Number(productId)) || [];
  const value = parts.reduce((sum, c) => sum + Math.round(c.quantity * c.price_paise), 0);
  return {
    product_id: product.product_id, name: product.name, is_combo: product.is_combo,
    price: toRupees(product.selling_price_paise),
    // what the same items cost bought separately (list prices, before tax) and what the customer saves
    separate_value: toRupees(value), saving: toRupees(value - Number(product.selling_price_paise)),
    components: parts.map((c) => ({ product_id: c.component_id, name: c.name, quantity: c.quantity, price: toRupees(c.price_paise) }))
  };
};

/* GET /api/products/:id/combo */
export const getCombo = async (req, res) => {
  const data = await comboResponse(pool, req.tenant.businessId, req.params.id);
  if (!data) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data });
};

/* PUT /api/products/:id/combo  { components: [{ product_id, quantity }] } — make this item a combo of those items */
export const setCombo = async (req, res) => {
  const items = Array.isArray(req.body?.components) ? req.body.components : null;
  if (!items || items.length < 2) return bad(res, 'A combo needs at least two items');
  if (items.length > 20) return bad(res, 'A combo can have up to 20 items');
  const id = Number(req.params.id);
  const seen = new Set();
  for (const item of items) {
    const quantity = Number(item.quantity ?? 1);
    if (!item.product_id || !(quantity > 0) || quantity > 100) return bad(res, 'Each item needs a quantity above zero');
    if (Number(item.product_id) === id) return bad(res, 'A combo cannot contain itself');
    if (seen.has(Number(item.product_id))) return bad(res, 'An item is listed twice');
    seen.add(Number(item.product_id));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = (await client.query(`SELECT kind, status FROM products WHERE product_id = $1 AND business_id = $2 FOR UPDATE`, [id, req.tenant.businessId])).rows[0];
    if (!target) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    if (target.kind !== 'DISH') { await client.query('ROLLBACK'); return bad(res, 'Only menu items can be combos'); }
    const inside = (await client.query(`SELECT 1 FROM combo_items WHERE component_product_id = $1 LIMIT 1`, [id])).rows.length;
    if (inside) { await client.query('ROLLBACK'); return bad(res, 'This item is part of another combo, so it cannot be a combo itself', 409); }

    const found = (await client.query(
      `SELECT product_id, is_combo, status FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`,
      [req.tenant.businessId, [...seen]]
    )).rows;
    if (found.length !== seen.size) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'One of the items was not found' }); }
    if (found.some((p) => p.is_combo)) { await client.query('ROLLBACK'); return bad(res, 'A combo cannot contain another combo'); }
    if (found.some((p) => p.status !== 'ACTIVE')) { await client.query('ROLLBACK'); return bad(res, 'An archived item cannot be in a combo'); }

    await client.query(`DELETE FROM combo_items WHERE combo_product_id = $1`, [id]);
    for (const item of items) {
      await client.query(`INSERT INTO combo_items (business_id, combo_product_id, component_product_id, quantity) VALUES ($1,$2,$3,$4)`, [req.tenant.businessId, id, item.product_id, Number(item.quantity ?? 1)]);
    }
    await client.query(`UPDATE products SET is_combo = TRUE WHERE product_id = $1`, [id]);
    const data = await comboResponse(client, req.tenant.businessId, id);
    await client.query('COMMIT');
    recordAudit(req, { action: 'combo.set', resource_type: 'product', resource_id: id, metadata: { items: items.length } });
    res.json({ success: true, data });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* DELETE /api/products/:id/combo — turn it back into a plain item */
export const clearCombo = async (req, res) => {
  const { rowCount } = await pool.query(`UPDATE products SET is_combo = FALSE WHERE product_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId]);
  if (!rowCount) return res.status(404).json({ success: false, message: 'Not found' });
  await pool.query(`DELETE FROM combo_items WHERE combo_product_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId]);
  recordAudit(req, { action: 'combo.cleared', resource_type: 'product', resource_id: req.params.id });
  res.json({ success: true, data: await comboResponse(pool, req.tenant.businessId, req.params.id) });
};
