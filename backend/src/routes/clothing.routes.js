/*
 * /api/clothing/* — the clothing catalogue (CLOTHING businesses only): styles and their size/colour variants.
 *
 * Every route: signed in, scoped to one business (withBusiness), and only for a CLOTHING business (clothingOnly). Then a permission (the existing `products` for changes; anyone who
 * sells or stocks can read), then the plan feature `cl_catalog`. Writes also need an active subscription and, where they set opening stock, a chosen outlet.
 */
import { Router } from 'express';
import { requireAnyPermission, requireAuth, requireOutlet, requirePermission, requirePlanFeature, withBusiness } from '../middleware/auth.js';
import { bulkLimiter } from '../middleware/limits.js';
import { clothingOnly } from '../modules/clothing/common.js';
import ctl from '../controllers/clothing.controller.js';

const router = Router();

const read = [requireAuth, withBusiness(), clothingOnly];
const write = [requireAuth, withBusiness({ requireActive: true }), clothingOnly];
const viewer = requireAnyPermission('billing', 'products', 'inventory', 'purchases', 'reports');
const edit = requirePermission('products');
const cat = requirePlanFeature('cl_catalog');

router.get('/meta', ...read, viewer, cat, ctl.meta);
router.post('/setup', ...write, edit, cat, ctl.setup);
router.get('/size-sets', ...read, viewer, cat, ctl.sizeSets);
router.post('/size-sets', ...write, edit, cat, ctl.saveSizeSet);

router.get('/styles', ...read, viewer, cat, ctl.list);
router.post('/styles/import', ...write, edit, cat, requireOutlet, bulkLimiter, ctl.importRows);
router.post('/styles', ...write, edit, cat, ctl.create);
router.get('/styles/:id', ...read, viewer, cat, ctl.get);
router.patch('/styles/:id', ...write, edit, cat, ctl.update);
router.post('/styles/:id/variants', ...write, edit, cat, ctl.addVariants);
router.get('/customers/:id/preferences', ...read, requireAnyPermission('billing', 'customers'), cat, ctl.customerPreferences);
router.get('/suppliers/:id/styles', ...read, requireAnyPermission('purchases', 'suppliers', 'reports'), cat, ctl.supplierStyles);
router.patch('/variants/:id', ...write, edit, cat, ctl.updateVariant);

export default router;
