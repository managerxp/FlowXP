/*
 * Supermarket / retail, only for a SUPERMARKET or RETAIL business:
 *   settings                 the owner's product settings
 *   stock, expiry, counts    the stock center (behind the `inventory` permission)
 *   import                   products and stock levels from a spreadsheet
 * (A product's barcodes, aliases and codes are on /api/products/:id/..., available to every business type.)
 */
import { Router } from 'express';
import { requireAnyPermission, requireAuth, requireOutlet, requirePermission, withBusiness } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import * as identity from '../controllers/productIdentity.controller.js';
import * as stock from '../controllers/retailStock.controller.js';
import * as invoiceImport from '../controllers/invoiceImport.controller.js';
import rateLimit from 'express-rate-limit';
import { uploadBillFiles } from '../middleware/upload.js';
import { isRetail } from '../modules/retailSettings.js';

const router = Router();
const retailOnly = (req, res, next) => (isRetail(req.tenant) ? next() : res.status(404).json({ success: false, message: 'Not found' }));

router.get('/settings', requireAuth, withBusiness(), retailOnly, requireAnyPermission('settings', 'products', 'billing'), identity.getSettings);
router.put('/settings', requireAuth, withBusiness({ requireActive: true }), retailOnly, requirePermission('settings'), identity.putSettings);

const read = [requireAuth, withBusiness(), retailOnly, requirePermission('inventory')];
const write = [requireAuth, withBusiness({ requireActive: true }), retailOnly, requirePermission('inventory')];

router.get('/stock', ...read, stock.stock);
router.get('/stock/movements', ...read, stock.ledger);
router.get('/expiry', ...read, stock.expiry);
router.post('/expiry/:batchId/write-off', ...write, requireOutlet, idempotent(), stock.writeOff);

router.get('/counts', ...read, stock.counts);
router.post('/counts', ...write, requireOutlet, stock.startCount);
router.get('/counts/:id', ...read, stock.getCount);
router.post('/counts/:id/items', ...write, idempotent(), stock.countItems);
router.post('/counts/:id/apply', ...write, idempotent(), stock.finishCount);
router.post('/counts/:id/cancel', ...write, stock.dropCount);

/* Supplier bills: reading one costs an AI request, so a person is limited on top of the plan's monthly allowance. */
const billScanLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u${req.auth?.userId ?? req.ip}`,
  message: { success: false, message: 'Too many bills read in a short time. Try again in a few minutes.' }
});
router.post('/invoice-import/scan', ...write, billScanLimiter, uploadBillFiles, invoiceImport.scan,
  (error, _req, res, _next) => res.status(400).json({ success: false, message: error.message || 'Could not read that file' }));
router.get('/invoice-import/check', ...read, invoiceImport.check);
router.post('/invoice-import/learn', ...write, invoiceImport.learn);

router.post('/import/products', ...write, requirePermission('products'), requireOutlet, stock.importProductRows);
router.post('/import/stock', ...write, requireOutlet, stock.importStockRows);

export default router;
