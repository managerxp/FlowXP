import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireOutlet } from '../middleware/auth.js';
import * as inventory from '../controllers/inventory.controller.js';
import { idempotent } from '../middleware/idempotency.js';

const router = Router();
const authed = [requireAuth, withBusiness(), requirePermission('inventory')];

router.get('/', ...authed, inventory.levels);
router.get('/valuation', ...authed, inventory.valuation);
router.get('/:productId/history', ...authed, inventory.history);
router.get('/wastage', ...authed, inventory.wastageSummary);
router.post('/wastage', requireAuth, withBusiness({ requireActive: true }), requirePermission('inventory'), requireOutlet, idempotent(), inventory.recordWastage);
router.post('/adjust', requireAuth, withBusiness({ requireActive: true }), requirePermission('inventory'), requireOutlet, idempotent(), inventory.adjust);
router.post('/transfer', requireAuth, withBusiness({ requireActive: true }), requirePermission('inventory'), idempotent(), inventory.transfer);
router.get('/transfers', ...authed, inventory.transfers);

export default router;
