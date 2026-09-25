import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission } from '../middleware/auth.js';
import * as m from '../controllers/messaging.controller.js';

const router = Router();
const read = (perm) => [requireAuth, withBusiness(), requirePermission(perm)];
const write = (perm) => [requireAuth, withBusiness({ requireActive: true }), requirePermission(perm)];

router.get('/messaging/settings', ...read('settings'), m.getSettingsHandler);
router.put('/messaging/settings', ...write('settings'), m.putSettings);
router.get('/messaging/templates', ...read('settings'), m.templates);
router.get('/messaging/messages', ...read('settings'), m.list);
router.post('/messaging/messages/:id/resend', ...write('settings'), m.resendHandler);
router.post('/messaging/send-bill', ...write('billing'), m.sendBillHandler);
router.post('/messaging/campaigns/preview', ...read('settings'), m.preview);
router.post('/messaging/campaigns', ...write('settings'), m.campaign);
router.get('/messaging/campaigns/:batch', ...read('settings'), m.campaignStatus);
router.post('/customers/:id/marketing', ...write('customers'), m.setOptOut);

export default router;
