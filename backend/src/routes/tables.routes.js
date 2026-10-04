import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireOutlet, requirePlanFeature } from '../middleware/auth.js';
import * as tables from '../controllers/tables.controller.js';

const router = Router();
const feature = requirePlanFeature('tables');
const authed = [requireAuth, withBusiness(), feature, requirePermission('billing')];
const write = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('billing')];

router.get('/', ...authed, tables.list);
router.get('/waiters', ...authed, tables.waiters);
router.post('/', ...write, requireOutlet, tables.create);
router.patch('/:id', ...write, tables.update);

export default router;
