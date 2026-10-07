import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireAnyPermission, requireOutlet, requirePlanFeature } from '../middleware/auth.js';
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
const deliveryFeature = requirePlanFeature('delivery_fleet');

router.get('/', ...authed, orders.list);
router.get('/riders', ...authed, deliveryFeature, orders.listRiders);      // before /:id, same reason as pending-deliveries below
router.get('/pending-deliveries', ...authed, orders.pendingDeliveries);   // before /:id, or "pending-deliveries" would match as an id
router.get('/:id', ...authed, orders.get);
router.post('/', ...write, requireOutlet, idempotent(), orders.create);
router.post('/:id/items', ...write, idempotent(), orders.addItems);
router.patch('/:id/items/:itemId', ...kitchenWrite, orders.updateItem);
router.post('/:id/kot', ...write, orders.sendKot);
router.post('/:id/accept', ...write, idempotent(), orders.acceptDelivery);
router.post('/:id/reject', ...write, idempotent(), orders.rejectDelivery);
router.patch('/:id/status', ...kitchenWrite, orders.updateStatus);
router.patch('/:id/customer', ...write, orders.setCustomer);
router.patch('/:id/waiter', ...write, orders.setWaiter);
router.patch('/:id/brand', ...write, orders.setBrand);
router.patch('/:id/rider', ...write, deliveryFeature, orders.setRider);
router.post('/:id/delivery-status', ...write, deliveryFeature, orders.setDeliveryStatus);
router.post('/:id/cancel', ...write, orders.cancelOrder);
router.post('/:id/bill', ...write, idempotent(), orders.bill);
router.post('/:id/transfer', ...write, idempotent(), tabs.transfer);
router.post('/:id/merge', ...write, idempotent(), tabs.merge);
router.post('/:id/split', ...write, idempotent(), tabs.split);

export default router;
