import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission } from '../middleware/auth.js';
import * as suppliers from '../controllers/suppliers.controller.js';

const router = Router();
const authed = [requireAuth, withBusiness(), requirePermission('suppliers')];
const write = [requireAuth, withBusiness({ requireActive: true }), requirePermission('suppliers')];

router.get('/', ...authed, suppliers.list);
router.get('/:id', ...authed, suppliers.get);
router.get('/:id/purchases', ...authed, suppliers.purchaseHistory);
router.post('/', ...write, suppliers.create);
router.patch('/:id', ...write, suppliers.update);

export default router;
