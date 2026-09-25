import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireOutlet } from '../middleware/auth.js';
import * as purchases from '../controllers/purchases.controller.js';
import * as orders from '../controllers/purchaseOrders.controller.js';
import { idempotent } from '../middleware/idempotency.js';

const router = Router();
const authed = [requireAuth, withBusiness(), requirePermission('purchases')];
const write = [requireAuth, withBusiness({ requireActive: true }), requirePermission('purchases')];

router.get('/', ...authed, purchases.list);
// Order lifecycle (nothing moves stock until an order is received). Fixed paths come before '/:id'.
router.post('/orders', ...write, requireOutlet, idempotent(), orders.createDraft);
router.post('/orders/from-forecast', ...write, requireOutlet, idempotent(), orders.fromForecast);
router.get('/:id', ...authed, purchases.get);
router.put('/:id', ...write, orders.update);
router.post('/:id/send', ...write, orders.send);
router.post('/:id/receive', ...write, idempotent(), orders.receive);
router.post('/:id/cancel', ...write, orders.cancel);
router.post('/', ...write, requireOutlet, idempotent(), purchases.create);
router.post('/:id/payments', ...write, idempotent(), purchases.addPayment);

export default router;
