import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission } from '../middleware/auth.js';
import * as integrations from '../controllers/integrations.controller.js';

const router = Router();
/* Connecting a delivery platform means storing credentials for the whole
   business — the same trust level as any other business setting, so it sits
   behind 'settings' (OWNER/ADMIN) rather than 'billing'. */
const settings = [requireAuth, withBusiness({ requireActive: true }), requirePermission('settings')];

/* PUBLIC — a delivery platform's server has no FlowXP session to send. See
   the note at the top of integrations.controller.js's webhook(). Mounted
   before the authenticated routes so it never accidentally picks up
   requireAuth from a shared prefix. */
router.post('/:platform/webhook/:token', integrations.webhook);

router.get('/', ...settings, integrations.list);
router.patch('/:platform', ...settings, integrations.update);
router.post('/:platform/sync-menu', ...settings, integrations.syncMenu);
router.post('/:platform/simulate-order', ...settings, integrations.simulateOrder);

export default router;
