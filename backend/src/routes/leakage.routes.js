import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireGroupUser } from '../middleware/auth.js';
import * as leakage from '../controllers/leakage.controller.js';

const router = Router();

router.get('/', requireAuth, withBusiness(), requirePermission('settings'), requireGroupUser, leakage.list);
router.post('/reviews', requireAuth, withBusiness({ requireActive: true }), requirePermission('settings'), requireGroupUser, leakage.review);

export default router;
