import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireAnyPermission, requireOutlet } from '../middleware/auth.js';
import * as orders from '../controllers/orders.controller.js';
import * as tabs from '../controllers/tabs.controller.js';
import { idempotent } from '../middleware/idempotency.js';

const router = Router();
/* Same permission as invoices — a waiter, cashier or staff member who can
   bill a sale can open a tab and send it to the kitchen; there is no
   separate "orders" permission to keep in sync with "billing". */
const authed = [requireAuth, withBusiness(), requireAnyPermission('billing', 'kitchen')];
const kitchenWrite = [requireAuth, withBusiness({ requireActive: true }), requireAnyPermission('billing', 'kitchen')];
const write = [requireAuth, withBusiness({ requireActive: true }), requirePermission('billing')];

router.get('/', ...authed, orders.list);
router.get('/:id', ...authed, orders.get);
router.post('/', ...write, requireOutlet, idempotent(), orders.create);
router.post('/:id/items', ...write, orders.addItems);
router.patch('/:id/items/:itemId', ...kitchenWrite, orders.updateItem);
router.post('/:id/kot', ...write, orders.sendKot);
router.patch('/:id/status', ...kitchenWrite, orders.updateStatus);
router.patch('/:id/customer', ...write, orders.setCustomer);
router.patch('/:id/waiter', ...write, orders.setWaiter);
router.post('/:id/cancel', ...write, orders.cancelOrder);
router.post('/:id/bill', ...write, idempotent(), orders.bill);
router.post('/:id/transfer', ...write, idempotent(), tabs.transfer);
router.post('/:id/merge', ...write, idempotent(), tabs.merge);
router.post('/:id/split', ...write, idempotent(), tabs.split);

export default router;
