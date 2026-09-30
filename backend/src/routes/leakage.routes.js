import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requirePlanFeature, requireGroupUser } from '../middleware/auth.js';
import * as leakage from '../controllers/leakage.controller.js';

const router = Router();
const feature = requirePlanFeature('advanced_reports');

router.get('/', requireAuth, withBusiness(), feature, requirePermission('settings'), requireGroupUser, leakage.list);
router.post('/reviews', requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('settings'), requireGroupUser, leakage.review);

export default router;
