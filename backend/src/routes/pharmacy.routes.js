/*
 * /api/pharmacy/* — the pharmacy module's routes.
 *
 * Every route: signed in, scoped to one business (withBusiness), and only for a PHARMACY business (pharmacyOnly).
 * Then a permission (role + per-person overrides). Writes also require an active subscription. Money- and
 * stock-moving POSTs accept an Idempotency-Key.
 *
 * Deliberately absent: any Purchase Order route. GRN is the only procurement document pharmacy exposes — see
 * controllers/pharmacyGrn.controller.js's header note.
 */
import { Router } from 'express';
import { requireAnyPermission, requireAuth, requireOutlet, requirePermission, withBusiness } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import { pharmacyOnly } from '../modules/pharmacy/common.js';
import catalog from '../controllers/pharmacyCatalog.controller.js';
import inventory from '../controllers/pharmacyInventory.controller.js';
import grn from '../controllers/pharmacyGrn.controller.js';
import pos from '../controllers/pharmacyPos.controller.js';

const router = Router();

const read = [requireAuth, withBusiness(), pharmacyOnly];
const write = [requireAuth, withBusiness({ requireActive: true }), pharmacyOnly];
const any = (...p) => requireAnyPermission(...p);
const can = (p) => requirePermission(p);
const once = idempotent();

/* ── products & categories ────────────────────────────────────────────────── */
router.get('/products', ...read, any('billing', 'products', 'inventory'), catalog.list);
router.get('/products/lookup', ...read, any('billing', 'products', 'inventory', 'purchases'), catalog.lookup);
router.get('/products/:id', ...read, any('billing', 'products', 'inventory'), catalog.get);
router.post('/products', ...write, can('products'), catalog.create);
router.put('/products/:id', ...write, can('products'), catalog.update);
router.get('/categories', ...read, catalog.categories);
router.post('/categories', ...write, can('products'), catalog.createCategory);

/* ── inventory ─────────────────────────────────────────────────────────────── */
router.get('/inventory/stock', ...read, can('inventory'), inventory.stock);
router.get('/inventory/batches', ...read, any('inventory', 'purchases', 'billing'), inventory.batches);
router.get('/inventory/expiry', ...read, can('inventory'), inventory.expirySummary);
router.post('/inventory/batches/:id/status', ...write, can('inventory'), inventory.setBatchStatus);

/* ── GRN (direct procurement — no PO) ─────────────────────────────────────── */
router.get('/grn', ...read, any('purchases', 'inventory'), grn.listGRNs);
router.post('/grn', ...write, any('purchases', 'inventory'), requireOutlet, once, grn.createGRN);
router.get('/grn/:id', ...read, any('purchases', 'inventory'), grn.getGRN);

/* ── POS ───────────────────────────────────────────────────────────────────── */
router.post('/pos/quote', ...write, can('billing'), requireOutlet, pos.quote);
router.post('/pos/invoices', ...write, can('billing'), requireOutlet, once, pos.create);

export default router;
