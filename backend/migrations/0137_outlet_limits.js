/*
 * Outlets as a counted feature (owner, 2026-11-18).
 *  - businesses.outlet_limit: the Super Admin's per-business number; NULL = what the plan says.
 *  - businesses.extra_outlets: outlets bought with the "Extra outlet" add-on, added on top.
 *  - addon_orders.quantity: how many of an add-on one link sells (only Extra outlet uses more than 1).
 *  - The Extra outlet add-on: 5,000 a year per outlet (GST extra), for every business type. Editable on the Add-ons page.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS outlet_limit INT CHECK (outlet_limit >= 1),
                      ADD COLUMN IF NOT EXISTS extra_outlets INT NOT NULL DEFAULT 0 CHECK (extra_outlets >= 0)`);
  await client.query(`ALTER TABLE addon_orders ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1 CHECK (quantity >= 1)`);
  await client.query(
    `INSERT INTO addons (addon_key, name, description, price_monthly_paise, price_yearly_paise, is_active, sort_order, business_types)
     VALUES ('extra_outlet', 'Extra outlet', 'One more outlet (branch) on top of what the plan allows', 50000, 500000, true, 4, NULL)
     ON CONFLICT (addon_key) DO NOTHING`);
};
