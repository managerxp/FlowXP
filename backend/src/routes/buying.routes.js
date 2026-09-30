import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requirePlanFeature, requireOutlet } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import * as prices from '../controllers/supplierPrices.controller.js';
import * as debit from '../controllers/debitNotes.controller.js';
import * as requests from '../controllers/transferRequests.controller.js';

const router = Router();
const read = (perm) => [requireAuth, withBusiness(), requirePermission(perm)];
const write = (perm) => [requireAuth, withBusiness({ requireActive: true }), requirePermission(perm)];
// Supplier prices and debit notes are part of Purchasing; stock transfer requests below are not.
const buying = requirePlanFeature('purchases');

/* supplier price lists */
router.get('/suppliers/:id/prices', ...read('suppliers'), buying, prices.forSupplier);
router.put('/suppliers/:id/prices', ...write('suppliers'), buying, prices.setPrices);
router.delete('/suppliers/:id/prices/:productId', ...write('suppliers'), buying, prices.removePrice);
router.get('/products/:id/supplier-prices', ...read('purchases'), buying, prices.forProduct);

/* debit notes to suppliers */
router.get('/purchases/:id/debit-notes/options', ...read('purchases'), buying, debit.options);
router.post('/purchases/:id/debit-notes', ...write('purchases'), buying, idempotent(), debit.create);
router.get('/debit-notes', ...read('purchases'), buying, debit.list);
router.get('/debit-notes/:id', ...read('purchases'), buying, debit.get);

/* stock requests between outlets */
router.get('/transfer-requests', ...read('inventory'), requests.list);
router.get('/transfer-requests/:id', ...read('inventory'), requests.get);
router.post('/transfer-requests', ...write('inventory'), requireOutlet, idempotent(), requests.create);
router.post('/transfer-requests/:id/fulfil', ...write('inventory'), idempotent(), requests.fulfil);
router.post('/transfer-requests/:id/reject', ...write('inventory'), requests.reject);
router.post('/transfer-requests/:id/cancel', ...write('inventory'), requests.cancel);

export default router;
