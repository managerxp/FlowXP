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
import team from '../controllers/distributorTeam.controller.js';

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

/* ── sales team, targets, commission ──────────────────────────────────────── */
router.get('/team', ...read, any('targets', 'territories', 'reports', 'field_sales'), team.team);
router.get('/targets', ...read, any('targets', 'reports', 'field_sales'), team.listTargets);
router.post('/targets', ...write, can('targets'), team.setTarget);
router.post('/targets/bulk', ...write, can('targets'), team.bulkTargets);
router.delete('/targets/:id', ...write, can('targets'), team.deleteTarget);
router.get('/commission/rules', ...read, any('targets', 'reports'), team.listRules);
router.post('/commission/rules', ...write, can('targets'), team.createRule);
router.put('/commission/rules/:id', ...write, can('targets'), team.updateRule);
router.delete('/commission/rules/:id', ...write, can('targets'), team.deleteRule);
router.get('/commission', ...read, any('targets', 'reports', 'field_sales'), team.commissionStatement);

/* ── field sales: visits and the rep's day ────────────────────────────────── */
router.get('/visits', ...read, any('field_sales', 'reports', 'territories'), team.listVisits);
router.post('/visits', ...write, can('field_sales'), team.recordVisit);
router.patch('/visits/:id', ...write, can('field_sales'), team.updateVisit);
router.get('/field/today', ...read, can('field_sales'), team.fieldToday);
router.get('/field/customers/:id', ...read, can('field_sales'), team.fieldCustomer);

export default router;
