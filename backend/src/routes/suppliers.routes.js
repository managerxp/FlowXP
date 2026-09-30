import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requirePlanFeature } from '../middleware/auth.js';
import * as suppliers from '../controllers/suppliers.controller.js';

const router = Router();
const feature = requirePlanFeature('purchases');
const authed = [requireAuth, withBusiness(), feature, requirePermission('suppliers')];
const write = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('suppliers')];

router.get('/', ...authed, suppliers.list);
router.get('/:id', ...authed, suppliers.get);
router.get('/:id/purchases', ...authed, suppliers.purchaseHistory);
router.post('/', ...write, suppliers.create);
router.patch('/:id', ...write, suppliers.update);

export default router;
