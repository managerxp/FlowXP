/*
 * /api/distributor/* — the distributor layer on top of the wholesale module.
 *
 * Same guards as /api/wholesale (signed in, one business, wholesale type) plus distributorOn: a DISTRIBUTOR business,
 * or a WHOLESALE business that switched "Wholesale + Distributor" on. Reads need a permission that makes sense for
 * the screen; writes also need an active subscription. Money- and stock-moving POSTs accept an Idempotency-Key.
 */
import { Router } from 'express';
import { requireAnyPermission, requireAuth, requirePermission, withBusiness } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import { distributorOn, wholesaleOnly } from '../modules/distributor/common.js';
import principals from '../controllers/distributorPrincipals.controller.js';
import territories from '../controllers/distributorTerritories.controller.js';

const router = Router();

const read = [requireAuth, withBusiness(), wholesaleOnly, distributorOn];
const write = [requireAuth, withBusiness({ requireActive: true }), wholesaleOnly, distributorOn];
const any = (...p) => requireAnyPermission(...p);
const can = (p) => requirePermission(p);
const once = idempotent();   // eslint-disable-line no-unused-vars

/* ── principals and brands ────────────────────────────────────────────────── */
router.get('/principals', ...read, any('principals', 'products', 'purchases', 'reports'), principals.list);
router.post('/principals', ...write, can('principals'), principals.create);
router.get('/principals/:id', ...read, any('principals', 'purchases', 'reports'), principals.get);
router.put('/principals/:id', ...write, can('principals'), principals.update);
router.get('/principals/:id/products', ...read, any('principals', 'products', 'purchases'), principals.principalProducts);
router.post('/principals/:id/assign-products', ...write, can('principals'), principals.assignProducts);
router.get('/brands', ...read, any('principals', 'products', 'sales_orders', 'reports', 'schemes'), principals.listBrands);
router.post('/brands', ...write, any('principals', 'products'), principals.createBrand);
router.put('/brands/:id', ...write, any('principals', 'products'), principals.updateBrand);

/* ── territories and beats ────────────────────────────────────────────────── */
router.get('/territories', ...read, any('territories', 'customers', 'sales_orders', 'reports', 'targets', 'field_sales'), territories.list);
router.post('/territories', ...write, can('territories'), territories.create);
router.put('/territories/:id', ...write, can('territories'), territories.update);
router.delete('/territories/:id', ...write, can('territories'), territories.remove);
router.post('/customers/assign', ...write, can('territories'), territories.assignCustomers);
router.get('/beats', ...read, any('territories', 'field_sales', 'reports'), territories.listBeats);
router.post('/beats', ...write, can('territories'), territories.createBeat);
router.get('/beats/:id', ...read, any('territories', 'field_sales', 'reports'), territories.getBeat);
router.put('/beats/:id', ...write, can('territories'), territories.updateBeat);

export default router;
