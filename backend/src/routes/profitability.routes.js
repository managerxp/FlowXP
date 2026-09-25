import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireGroupUser } from '../middleware/auth.js';
import * as profitability from '../controllers/profitability.controller.js';

const router = Router();

router.get('/', requireAuth, withBusiness(), requirePermission('reports'), profitability.summary);
router.get('/settings', requireAuth, withBusiness(), requirePermission('reports'), profitability.getSettings);
router.put('/settings', requireAuth, withBusiness({ requireActive: true }), requirePermission('settings'), requireGroupUser, profitability.putSettings);

export default router;
