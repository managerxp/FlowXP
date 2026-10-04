import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireAnyPermission, requirePlanFeature } from '../middleware/auth.js';
import * as kitchen from '../controllers/kitchen.controller.js';

const router = Router();
const floor = requireAnyPermission('billing', 'kitchen');
const feature = requirePlanFeature('kitchen');
const live = [requireAuth, withBusiness(), feature, floor];
const liveWrite = [requireAuth, withBusiness({ requireActive: true }), feature, floor];
const setup = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('products')];

router.get('/tickets', ...live, kitchen.tickets);
router.get('/kots/:id', ...live, kitchen.printableKot);
router.post('/advance', ...liveWrite, kitchen.advance);
router.post('/orders/:id/rush', ...liveWrite, kitchen.rush);

router.get('/stations', requireAuth, withBusiness(), feature, requireAnyPermission('billing', 'kitchen', 'products'), kitchen.listStations);
router.post('/stations', ...setup, kitchen.createStation);
router.put('/stations/:id', ...setup, kitchen.updateStation);
router.get('/routing', requireAuth, withBusiness(), feature, requirePermission('products'), kitchen.getRouting);
router.put('/routing', ...setup, kitchen.putRouting);

router.get('/performance', requireAuth, withBusiness(), feature, requirePermission('reports'), kitchen.performanceReport);

export default router;
