import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requirePlanFeature, requireGroupUser } from '../middleware/auth.js';
import * as profitability from '../controllers/profitability.controller.js';

const router = Router();
const feature = requirePlanFeature('advanced_reports');

router.get('/', requireAuth, withBusiness(), feature, requirePermission('reports'), profitability.summary);
router.get('/settings', requireAuth, withBusiness(), feature, requirePermission('reports'), profitability.getSettings);
router.put('/settings', requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('settings'), requireGroupUser, profitability.putSettings);

export default router;
