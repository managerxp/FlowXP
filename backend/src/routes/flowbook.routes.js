import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requirePlanFeature } from '../middleware/auth.js';
import * as flowbook from '../controllers/flowbook.controller.js';

const router = Router();
/* Sending the business's sales to an accounting system is a business-wide setting: owner and admin, like the delivery integrations. */
const settings = [requireAuth, withBusiness({ requireActive: true }), requirePlanFeature('flowbook'), requirePermission('settings')];

// open FlowBook signed in: any member of an active business, and an ended trial still opens (read-only there)
router.post('/launch', requireAuth, withBusiness(), flowbook.launch);
router.get('/', ...settings, flowbook.get);
router.put('/', ...settings, flowbook.save);
router.post('/retry', ...settings, flowbook.retry);
router.post('/test', ...settings, flowbook.test);

export default router;
