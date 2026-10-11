import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireAnyPermission, requireOutlet } from '../middleware/auth.js';
import { uploadProductImage } from '../middleware/upload.js';
import { idempotent } from '../middleware/idempotency.js';
import * as categories from '../controllers/categories.controller.js';
import * as products from '../controllers/products.controller.js';
import * as identity from '../controllers/productIdentity.controller.js';

const router = Router();
const authed = [requireAuth, withBusiness()];
const write = [requireAuth, withBusiness({ requireActive: true }), requirePermission('products')];

/* Reads are open to 'billing' as well as 'products' — a cashier building a
   cart has to search the catalogue and scan a barcode without holding
   catalogue-edit rights. See requireAnyPermission in middleware/auth.js. */
const read = requireAnyPermission('products', 'billing');

router.get('/categories', ...authed, read, categories.list);
router.post('/categories', ...write, categories.create);
router.delete('/categories/:id', ...write, categories.remove);

router.get('/products', ...authed, read, products.list);
router.get('/products/barcode/:barcode', ...authed, read, products.findByBarcode);
router.get('/products/lookup/:code', ...authed, read, products.lookup);
// a field rep (sales_orders) keeps the catalogue on the phone too, to take an order with no signal; a warehouse worker (fulfilment) to scan items while picking
router.get('/products/pos-catalog', ...authed, requireAnyPermission('products', 'billing', 'sales_orders', 'fulfilment'), products.posCatalog);
router.post('/products/quick', requireAuth, withBusiness({ requireActive: true }), requirePermission('billing'), requirePermission('product_quick_add'), requireOutlet, idempotent(), products.quickCreate);
router.get('/products/:id', ...authed, read, products.get);
router.get('/products/:id/identifiers', ...authed, read, identity.identifiers);
router.post('/products/:id/barcodes', ...write, identity.addBarcodeTo);
router.delete('/products/:id/barcodes/:barcode', ...write, identity.removeBarcodeFrom);
router.post('/products/:id/aliases', ...write, identity.addAliasTo);
router.delete('/products/:id/aliases/:aliasId', ...write, identity.removeAliasFrom);
router.post('/products/:id/supplier-codes', ...write, identity.addSupplierCodeTo);
router.delete('/products/:id/supplier-codes/:codeId', ...write, identity.removeSupplierCodeFrom);
router.post('/products', ...write, requireOutlet, idempotent(), products.create);
router.get('/products/:id/outlets', ...authed, requirePermission('products'), products.getOutletSettings);
router.put('/products/:id/outlets', ...write, products.setOutletSettings);
router.patch('/products/:id', ...write, products.update);
router.post('/products/:id/archive', ...write, products.archive);
router.post(
  '/products/:id/image',
  ...write,
  uploadProductImage,
  products.uploadImage,
  // multer's own errors (wrong file type, too large) never reach the normal
  // error handler shape the rest of the app uses — catch them here so the
  // frontend gets the same {success:false, message} shape as everywhere else.
  (error, _req, res, _next) => {
    res.status(400).json({ success: false, message: error.message || 'Could not upload the image' });
  }
);

export default router;
