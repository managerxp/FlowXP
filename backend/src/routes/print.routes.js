import { Router } from 'express';
import { requireAuth, withBusiness, requireAnyPermission, requirePermission } from '../middleware/auth.js';
import * as print from '../controllers/escpos.controller.js';
import * as printers from '../controllers/printers.controller.js';
import { agentZip } from '../modules/agentZip.js';

const router = Router();
const till = [requireAuth, withBusiness(), requirePermission('billing')];
const floor = [requireAuth, withBusiness(), requireAnyPermission('billing', 'kitchen')];

router.get('/invoices/:id/escpos', ...till, print.receipt);
router.get('/orders/:id/escpos', ...till, print.prebill);
router.get('/kitchen/kots/:id/escpos', ...floor, print.kot);
router.get('/print/test', ...till, print.test);
router.get('/print/drawer', ...till, print.drawer);
// the print agent itself (no secrets in it: the token is made on the till computer); `origin` is the website the button was clicked on
router.get('/print/agent.zip', (req, res) => { res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="flowxp-print-agent.zip"' }).send(agentZip(String(req.query.origin || ''))); });

// the Printers screen: who may change it is whoever holds 'settings' (owner and admins); the print jobs above read the routing themselves
const setup = [requireAuth, withBusiness({ requireActive: true }), requirePermission('settings')];
router.get('/printers', requireAuth, withBusiness(), requirePermission('settings'), printers.list);
router.put('/printers/routing', ...setup, printers.saveRouting);
router.post('/printers', ...setup, printers.create);
router.patch('/printers/:id', ...setup, printers.update);
router.delete('/printers/:id', ...setup, printers.remove);

export default router;
