import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireOutlet } from '../middleware/auth.js';
import * as payments from '../controllers/payments.controller.js';
import { idempotent } from '../middleware/idempotency.js';

const router = Router();

router.get('/', requireAuth, withBusiness(), requirePermission('payments'), payments.list);
router.post('/', requireAuth, withBusiness({ requireActive: true }), requirePermission('payments'), requireOutlet, idempotent(), payments.create);

export default router;
