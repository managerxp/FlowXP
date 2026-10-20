import { Router } from 'express';
import { requireAuth, withBusiness, requireAnyPermission, requirePermission } from '../middleware/auth.js';
import * as print from '../controllers/escpos.controller.js';
import * as printers from '../controllers/printers.controller.js';

const router = Router();
const till = [requireAuth, withBusiness(), requirePermission('billing')];
const floor = [requireAuth, withBusiness(), requireAnyPermission('billing', 'kitchen')];

router.get('/invoices/:id/escpos', ...till, print.receipt);
router.get('/kitchen/kots/:id/escpos', ...floor, print.kot);
router.get('/print/test', ...till, print.test);
router.get('/print/drawer', ...till, print.drawer);

// the Printers screen: who may change it is whoever holds 'settings' (owner and admins); the print jobs above read the routing themselves
const setup = [requireAuth, withBusiness({ requireActive: true }), requirePermission('settings')];
router.get('/printers', requireAuth, withBusiness(), requirePermission('settings'), printers.list);
router.put('/printers/routing', ...setup, printers.saveRouting);
router.post('/printers', ...setup, printers.create);
router.patch('/printers/:id', ...setup, printers.update);
router.delete('/printers/:id', ...setup, printers.remove);

export default router;
