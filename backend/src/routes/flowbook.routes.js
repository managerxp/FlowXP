import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requirePlanFeature } from '../middleware/auth.js';
import * as flowbook from '../controllers/flowbook.controller.js';

const router = Router();
/* Sending the business's sales to its books is a business-wide setting: owner and admin, like the delivery integrations. */
const settings = [requireAuth, withBusiness({ requireActive: true }), requirePlanFeature('flowbook'), requirePermission('settings')];

router.get('/', ...settings, flowbook.get);
router.put('/', ...settings, flowbook.save);
router.post('/retry', ...settings, flowbook.retry);

export default router;
