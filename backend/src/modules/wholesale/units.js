/*
 * Units of measure. Stock is kept in each product's BASE unit (products.unit). A product can also be sold or bought
 * in larger units, each worth a fixed number of base units:
 *
 *   1 box = 12 pieces        → { unit_name: 'box', factor: 12 }
 *   1 carton = 24 boxes      → { unit_name: 'carton', factor: 288 }   (the factor is always against the BASE unit)
 *
 * so 2 cartons = 576 pieces of stock, whichever unit the order, the invoice or the delivery note used.
 */
import { WholesaleError, q3 } from './common.js';

/** Map(product_id → { base, units: Map(lowercase name → { name, factor, barcode }) }) for the given products. */
export const loadUnits = async (db, businessId, productIds) => {
  const out = new Map();
  if (!productIds.length) return out;
  const base = await db.query(`SELECT product_id, unit FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, productIds]);
  for (const p of base.rows) out.set(p.product_id, { base: p.unit, units: new Map([[String(p.unit).toLowerCase(), { name: p.unit, factor: 1, barcode: null }]]) });
  const more = await db.query(`SELECT product_id, unit_name, factor, barcode FROM wholesale_product_units WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, productIds]);
  for (const u of more.rows) out.get(u.product_id)?.units.set(u.unit_name.toLowerCase(), { name: u.unit_name, factor: Number(u.factor), barcode: u.barcode });
  return out;
};

/** The conversion for a product's unit; the base unit (or no name) is 1. Throws for a unit the product does not have. */
export const unitFor = (units, productId, unitName, productName = 'that product') => {
  const entry = units.get(productId);
  if (!entry) throw new WholesaleError(400, `Product ${productId} not found`);
  if (unitName == null || unitName === '') return { name: entry.base, factor: 1 };
  const u = entry.units.get(String(unitName).toLowerCase());
  if (!u) throw new WholesaleError(400, `${productName} is not sold in ${unitName}`);
  return { name: u.name, factor: u.factor };
};

export const toBase = (quantity, factor) => q3(Number(quantity) * Number(factor));

/** "2 carton (576 pcs)" style text for a quantity held in base units, using the product's largest whole unit. */
export const describeBase = (baseQty, entry) => {
  const q = Number(baseQty);
  const sorted = [...entry.units.values()].filter((u) => u.factor > 1).sort((a, b) => b.factor - a.factor);
  for (const u of sorted) if (q >= u.factor && Number.isInteger(q / u.factor)) return `${q / u.factor} ${u.name} (${q} ${entry.base})`;
  return `${q} ${entry.base}`;
};
