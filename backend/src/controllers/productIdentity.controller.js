/*
 * A product's other names: barcodes, aliases, supplier codes — and the owner's retail settings.
 *
 * Every write goes through modules/productIdentity.js, the same service the product form, spreadsheet import and AI
 * invoice reading use, so a barcode can never end up on two products and is never moved without being asked.
 */
import pool from '../config/database.js';
import { hasPermission } from '../middleware/auth.js';
import { recordAudit } from '../modules/events.js';
import {
  addAlias, addBarcode, addSupplierCode, cleanBarcode, IdentityError, identifiersOf, removeAlias, removeBarcode, removeSupplierCode
} from '../modules/productIdentity.js';
import { autoSkuOn, getRetailSettings, isRetail, putRetailSettings } from '../modules/retailSettings.js';

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const idOf = (value) => { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; };

/* Runs a service call; its refusals (a barcode in use, a bad code) become the JSON the screens expect. */
const run = (work) => async (req, res) => {
  try {
    await work(req, res);
  } catch (error) {
    if (error instanceof IdentityError) return fail(res, error.status, error.message, { code: error.code, ...(error.data ? { data: error.data } : {}) });
    throw error;
  }
};

/* Several statements that must stand or fall together (taking a barcode off one product and giving it to another). */
const inTransaction = async (work) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const productId = (req) => idOf(req.params.id);

export const identifiers = run(async (req, res) => {
  const found = productId(req) && await identifiersOf(pool, req.tenant.businessId, productId(req));
  if (!found) return fail(res, 404, 'Not found');
  res.json({ success: true, data: found });
});

export const addBarcodeTo = run(async (req, res) => {
  const id = productId(req);
  if (!id) return fail(res, 404, 'Not found');
  const body = req.body || {};
  const outcome = await inTransaction((client) => addBarcode(client, {
    businessId: req.tenant.businessId, productId: id, barcode: body.barcode, userId: req.auth.userId,
    replace: body.replace === true, canReplace: hasPermission(req.tenant, 'barcode_reassign')
  }));
  if (outcome.status !== 'already_here') {
    recordAudit(req, {
      action: outcome.status === 'moved' ? 'product.barcode_moved' : 'product.barcode_added', resource_type: 'product', resource_id: id,
      metadata: { barcode: outcome.barcode, ...(outcome.moved_from ? { moved_from: outcome.moved_from } : {}) }
    });
  }
  res.status(outcome.status === 'already_here' ? 200 : 201).json({ success: true, data: { ...outcome, identifiers: await identifiersOf(pool, req.tenant.businessId, id) } });
});

export const removeBarcodeFrom = run(async (req, res) => {
  const id = productId(req);
  if (!id) return fail(res, 404, 'Not found');
  const barcode = cleanBarcode(req.params.barcode);
  await inTransaction((client) => removeBarcode(client, { businessId: req.tenant.businessId, productId: id, barcode }));
  recordAudit(req, { action: 'product.barcode_removed', resource_type: 'product', resource_id: id, metadata: { barcode } });
  res.json({ success: true, data: { identifiers: await identifiersOf(pool, req.tenant.businessId, id) } });
});

export const addAliasTo = run(async (req, res) => {
  const id = productId(req);
  if (!id) return fail(res, 404, 'Not found');
  const outcome = await addAlias(pool, { businessId: req.tenant.businessId, productId: id, alias: req.body?.alias, source: 'USER', userId: req.auth.userId });
  if (outcome.status === 'added') recordAudit(req, { action: 'product.alias_added', resource_type: 'product', resource_id: id, metadata: { alias: outcome.alias } });
  res.status(outcome.status === 'added' ? 201 : 200).json({ success: true, data: { ...outcome, identifiers: await identifiersOf(pool, req.tenant.businessId, id) } });
});

export const removeAliasFrom = run(async (req, res) => {
  const id = productId(req); const aliasId = idOf(req.params.aliasId);
  if (!id || !aliasId) return fail(res, 404, 'Not found');
  const gone = await removeAlias(pool, { businessId: req.tenant.businessId, productId: id, aliasId });
  recordAudit(req, { action: 'product.alias_removed', resource_type: 'product', resource_id: id, metadata: { alias: gone.alias } });
  res.json({ success: true, data: { identifiers: await identifiersOf(pool, req.tenant.businessId, id) } });
});

export const addSupplierCodeTo = run(async (req, res) => {
  const id = productId(req);
  if (!id) return fail(res, 404, 'Not found');
  const body = req.body || {};
  const created = await addSupplierCode(pool, { businessId: req.tenant.businessId, productId: id, code: body.code, supplierId: body.supplier_id ? idOf(body.supplier_id) ?? -1 : null, userId: req.auth.userId });
  recordAudit(req, { action: 'product.supplier_code_added', resource_type: 'product', resource_id: id, metadata: { code: created.code, supplier_id: created.supplier_id } });
  res.status(201).json({ success: true, data: { ...created, identifiers: await identifiersOf(pool, req.tenant.businessId, id) } });
});

export const removeSupplierCodeFrom = run(async (req, res) => {
  const id = productId(req); const codeId = idOf(req.params.codeId);
  if (!id || !codeId) return fail(res, 404, 'Not found');
  const gone = await removeSupplierCode(pool, { businessId: req.tenant.businessId, productId: id, codeId });
  recordAudit(req, { action: 'product.supplier_code_removed', resource_type: 'product', resource_id: id, metadata: { code: gone.code } });
  res.json({ success: true, data: { identifiers: await identifiersOf(pool, req.tenant.businessId, id) } });
});

/* ── retail settings ──────────────────────────────────────────────────────── */

const settingsView = async (req) => {
  const settings = await getRetailSettings(pool, req.tenant.businessId);
  return { ...settings, auto_sku_available: isRetail(req.tenant) && autoSkuOn(req.tenant, { auto_sku: true }), auto_sku_active: autoSkuOn(req.tenant, settings) };
};

export const getSettings = async (req, res) => res.json({ success: true, data: await settingsView(req) });

export const putSettings = async (req, res) => {
  const body = req.body || {};
  const patch = {};
  for (const key of ['auto_sku', 'require_barcode']) {
    if (!(key in body)) continue;
    if (typeof body[key] !== 'boolean') return fail(res, 400, `${key} must be true or false`);
    patch[key] = body[key];
  }
  if (!Object.keys(patch).length) return fail(res, 400, 'Nothing to change');
  const before = await getRetailSettings(pool, req.tenant.businessId);
  await putRetailSettings(pool, req.tenant.businessId, patch);
  recordAudit(req, { action: 'retail.settings_changed', resource_type: 'business', resource_id: req.tenant.businessId, metadata: { from: before, to: { ...before, ...patch } } });
  res.json({ success: true, data: await settingsView(req) });
};
