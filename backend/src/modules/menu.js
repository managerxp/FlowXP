/*
 * Modifier selection rules, in one place.
 *
 * Staff orders, the customer QR menu and direct POS billing all let someone
 * choose modifiers for a dish. Three copies of "is this choice allowed, and
 * what does it cost" would drift, so all three call resolveModifiers().
 */

export class ModifierError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModifierError';
    this.status = 400;
  }
}

/**
 * Pure rule check.
 * @param groups  [{ group_id, name, min_select, max_select, modifiers: [{ modifier_id, name,
 *                  price_delta_paise, ingredient_product_id, ingredient_qty }] }]
 * @param ids     modifier ids the customer/staff picked
 * @returns { snapshot, deltaPaise }
 */
export const pickModifiers = (groups, ids = []) => {
  const wanted = [...new Set(ids.map(Number))];
  const byId = new Map();
  for (const g of groups) for (const m of g.modifiers) byId.set(m.modifier_id, { group: g, modifier: m });

  const perGroup = new Map();
  const snapshot = [];
  let deltaPaise = 0;

  for (const id of wanted) {
    const found = byId.get(id);
    if (!found) throw new ModifierError(`Option ${id} is not available for this item`);
    perGroup.set(found.group.group_id, (perGroup.get(found.group.group_id) || 0) + 1);
    const price = Number(found.modifier.price_delta_paise);
    deltaPaise += price;
    snapshot.push({
      modifier_id: found.modifier.modifier_id,
      group_id: found.group.group_id,
      name: found.modifier.name,
      price_paise: price,
      ingredient_product_id: found.modifier.ingredient_product_id ?? null,
      ingredient_qty: found.modifier.ingredient_qty != null ? Number(found.modifier.ingredient_qty) : null
    });
  }

  for (const g of groups) {
    const count = perGroup.get(g.group_id) || 0;
    if (count < g.min_select) throw new ModifierError(`Choose ${g.min_select === 1 ? 'an option' : `at least ${g.min_select} options`} for ${g.name}`);
    if (g.max_select != null && count > g.max_select) throw new ModifierError(`Choose at most ${g.max_select} for ${g.name}`);
  }

  return { snapshot, deltaPaise };
};

/** Active groups (with active modifiers) attached to a product, tenant-scoped. */
export const loadProductGroups = async (client, businessId, productId) => {
  const { rows } = await client.query(
    `SELECT g.group_id, g.name, g.is_variant, g.min_select, g.max_select,
            m.modifier_id, m.name AS modifier_name, m.price_delta_paise, m.ingredient_product_id, m.ingredient_qty
     FROM product_modifier_groups pg
     JOIN modifier_groups g ON g.group_id = pg.group_id AND g.business_id = $1 AND g.is_active
     LEFT JOIN modifiers m ON m.group_id = g.group_id AND m.is_active
     WHERE pg.product_id = $2
     ORDER BY g.sort_order, g.group_id, m.sort_order, m.modifier_id`,
    [businessId, productId]
  );
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.group_id)) {
      groups.set(r.group_id, { group_id: r.group_id, name: r.name, is_variant: r.is_variant, min_select: r.min_select, max_select: r.max_select, modifiers: [] });
    }
    if (r.modifier_id) {
      groups.get(r.group_id).modifiers.push({
        modifier_id: r.modifier_id, name: r.modifier_name, price_delta_paise: r.price_delta_paise,
        ingredient_product_id: r.ingredient_product_id, ingredient_qty: r.ingredient_qty
      });
    }
  }
  return [...groups.values()];
};

export const resolveModifiers = async (client, businessId, productId, modifierIds = []) =>
  pickModifiers(await loadProductGroups(client, businessId, productId), modifierIds);

/** "Garlic, Extra cheese" — how a snapshot reads on a KOT or bill line. */
export const modifierLabel = (snapshot) => (snapshot || []).map((m) => m.name).join(', ');

/**
 * Per-outlet overrides on the shared menu: Map(product_id -> { price_paise|null, is_available }).
 * No row = use the shared price and available. One place, so billing, orders and
 * the QR menu can never disagree about what a dish costs at an outlet.
 */
export const outletSettingsFor = async (db, branchId, productIds) => {
  const map = new Map();
  if (!branchId || !productIds.length) return map;
  const { rows } = await db.query(
    `SELECT product_id, price_paise, is_available FROM product_branch_settings WHERE branch_id = $1 AND product_id = ANY($2::int[])`,
    [branchId, productIds]
  );
  for (const r of rows) map.set(r.product_id, { price_paise: r.price_paise == null ? null : Number(r.price_paise), is_available: r.is_available });
  return map;
};
