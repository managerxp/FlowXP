import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requirePlanFeature } from '../middleware/auth.js';
import * as forecast from '../controllers/forecast.controller.js';

const router = Router();
const feature = requirePlanFeature('advanced_reports');
const read = [requireAuth, withBusiness(), feature, requirePermission('reports')];
const write = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('reports')];

router.get('/', ...read, forecast.demand);
router.get('/inventory', ...read, forecast.inventory);
router.post('/events', ...write, forecast.addEvent);
router.delete('/events/:id', ...write, forecast.removeEvent);

export default router;
