import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requirePlanFeature } from '../middleware/auth.js';
import * as brands from '../controllers/brands.controller.js';

const router = Router();
const feature = requirePlanFeature('multi_brand');
const read = [requireAuth, withBusiness(), feature, requirePermission('products')];
const write = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('products')];

router.get('/brands', ...read, brands.list);
router.post('/brands', ...write, brands.create);
router.patch('/brands/:id', ...write, brands.update);

export default router;
