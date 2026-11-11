import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requirePlanFeature, requireOutlet } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import * as estimates from '../controllers/estimates.controller.js';

const router = Router();
const feature = requirePlanFeature('estimates');
const authed = [requireAuth, withBusiness(), feature, requirePermission('billing')];
const write = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('billing')];

router.get('/', ...authed, estimates.list);
router.post('/', ...write, requireOutlet, idempotent(), estimates.create);
router.post('/:id/convert', ...write, requireOutlet, idempotent(), estimates.convert);
router.post('/:id/cancel', ...write, estimates.cancel);

export default router;
