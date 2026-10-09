import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requirePlanFeature, requireOutlet } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import * as expenses from '../controllers/expenses.controller.js';

const router = Router();
const feature = requirePlanFeature('expenses');
const authed = [requireAuth, withBusiness(), feature, requirePermission('expenses')];
const write = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('expenses')];

router.get('/', ...authed, expenses.list);
router.get('/summary', ...authed, expenses.summary);
router.post('/', ...write, requireOutlet, idempotent(), expenses.create);
router.patch('/:id', ...write, expenses.update);
router.delete('/:id', ...write, expenses.remove);

export default router;
