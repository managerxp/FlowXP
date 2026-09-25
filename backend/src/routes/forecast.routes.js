import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission } from '../middleware/auth.js';
import * as forecast from '../controllers/forecast.controller.js';

const router = Router();
const read = [requireAuth, withBusiness(), requirePermission('reports')];
const write = [requireAuth, withBusiness({ requireActive: true }), requirePermission('reports')];

router.get('/', ...read, forecast.demand);
router.get('/inventory', ...read, forecast.inventory);
router.post('/events', ...write, forecast.addEvent);
router.delete('/events/:id', ...write, forecast.removeEvent);

export default router;
