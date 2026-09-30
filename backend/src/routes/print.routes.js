import { Router } from 'express';
import { requireAuth, withBusiness, requireAnyPermission, requirePermission } from '../middleware/auth.js';
import * as print from '../controllers/escpos.controller.js';

const router = Router();
const till = [requireAuth, withBusiness(), requirePermission('billing')];
const floor = [requireAuth, withBusiness(), requireAnyPermission('billing', 'kitchen')];

router.get('/invoices/:id/escpos', ...till, print.receipt);
router.get('/kitchen/kots/:id/escpos', ...floor, print.kot);
router.get('/print/test', ...till, print.test);
router.get('/print/drawer', ...till, print.drawer);

export default router;
