import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requirePlanFeature, requireOutlet } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import * as income from '../controllers/otherIncome.controller.js';

const router = Router();
const feature = requirePlanFeature('other_income');
const authed = [requireAuth, withBusiness(), feature, requirePermission('expenses')];
const write = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('expenses')];

router.get('/', ...authed, income.list);
router.post('/', ...write, requireOutlet, idempotent(), income.create);
router.delete('/:id', ...write, income.remove);

export default router;
