/*
 * What the owner chose for the supermarket / retail screens. One row per business in retail_settings; no row means the
 * defaults, so a business that never opens the settings behaves like a fresh one.
 *
 * Switching a feature off is two separate gates and both must allow it: the plan feature (a super admin's decision,
 * see planFeatures.js) and the owner's own setting here.
 */
import { hasPlanFeature } from './planFeatures.js';

export const RETAIL_TYPES = ['SUPERMARKET', 'RETAIL'];
export const isRetail = (tenant) => RETAIL_TYPES.includes(tenant?.businessType);

export const DEFAULT_RETAIL_SETTINGS = { auto_sku: true, require_barcode: false };

export const getRetailSettings = async (db, businessId) => {
  const row = (await db.query(`SELECT auto_sku, require_barcode FROM retail_settings WHERE business_id = $1`, [businessId])).rows[0];
  return { ...DEFAULT_RETAIL_SETTINGS, ...(row || {}) };
};

export const putRetailSettings = async (db, businessId, patch) => {
  const next = { ...(await getRetailSettings(db, businessId)), ...patch };
  await db.query(
    `INSERT INTO retail_settings (business_id, auto_sku, require_barcode) VALUES ($1,$2,$3)
     ON CONFLICT (business_id) DO UPDATE SET auto_sku = EXCLUDED.auto_sku, require_barcode = EXCLUDED.require_barcode, updated_at = CURRENT_TIMESTAMP`,
    [businessId, next.auto_sku, next.require_barcode]
  );
  return next;
};

/** FlowXP makes the SKU: a retail business, with the feature on for its plan and the owner not having turned it off. */
export const autoSkuOn = (tenant, settings) => isRetail(tenant) && hasPlanFeature(tenant, 'auto_sku') && settings.auto_sku !== false;
