/*
 * /api/wholesale/* — the wholesale / distribution module's routes.
 *
 * Every route: signed in, scoped to one business (withBusiness), and only for a WHOLESALE or DISTRIBUTOR business
 * (wholesaleOnly). Then a permission (role + per-person overrides) and, where separately priced, a plan feature.
 * Writes also require an active subscription. Money- and stock-moving POSTs accept an Idempotency-Key.
 */
import { Router } from 'express';
import { requireAnyPermission, requireAuth, requirePermission, requirePlanFeature, withBusiness } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import { wholesaleOnly } from '../modules/wholesale/common.js';
import catalog from '../controllers/wholesaleCatalog.controller.js';
import parties from '../controllers/wholesaleParties.controller.js';
import orders from '../controllers/wholesaleOrders.controller.js';
import fulfilment from '../controllers/wholesaleFulfilment.controller.js';
import inventory from '../controllers/wholesaleInventory.controller.js';
import purchasing from '../controllers/wholesalePurchasing.controller.js';
import money from '../controllers/wholesaleMoney.controller.js';
import returns from '../controllers/wholesaleReturns.controller.js';
import dashboard from '../controllers/wholesaleDashboard.controller.js';
import reports from '../controllers/wholesaleReports.controller.js';
import importer from '../controllers/wholesaleImport.controller.js';
import '../modules/wholesale/scans.js';   // registers the background checks with the worker
import * as purchases from '../controllers/purchases.controller.js';
import * as debitNotes from '../controllers/debitNotes.controller.js';

const router = Router();

const read = [requireAuth, withBusiness(), wholesaleOnly];
const write = [requireAuth, withBusiness({ requireActive: true }), wholesaleOnly];
const any = (...p) => requireAnyPermission(...p);
const can = (p) => requirePermission(p);
const feature = (f) => requirePlanFeature(f);
const once = idempotent();

/* ── dashboard and reports ────────────────────────────────────────────────── */
router.get('/dashboard', ...read, any('reports', 'payments', 'sales_orders', 'fulfilment', 'inventory', 'purchases'), dashboard.dashboard);
router.get('/reports', ...read, can('reports'), reports.list);
router.get('/reports/:key', ...read, can('reports'), reports.run);

/* ── bulk work: imports and bulk edits ────────────────────────────────────── */
router.post('/import/products', ...write, can('products'), importer.importProducts);
router.post('/import/customers', ...write, can('customers'), importer.importCustomers);
router.post('/import/suppliers', ...write, can('suppliers'), importer.importSuppliers);
router.post('/products/bulk', ...write, can('products'), importer.bulkProducts);
router.post('/customers/bulk', ...write, can('customers'), importer.bulkCustomers);

/* ── settings ─────────────────────────────────────────────────────────────── */
router.get('/settings', ...read, parties.getSettings);
router.put('/settings', ...write, can('settings'), parties.updateSettings);

/* ── products, categories, units ──────────────────────────────────────────── */
router.get('/products', ...read, any('products', 'inventory', 'billing', 'sales_orders', 'purchases'), catalog.list);
router.get('/products/lookup', ...read, any('products', 'inventory', 'billing', 'sales_orders', 'purchases', 'fulfilment'), catalog.lookup);
router.post('/products', ...write, can('products'), catalog.create);
router.post('/products/bulk-price', ...write, can('pricing'), catalog.bulkUpdate);
router.get('/products/:id', ...read, any('products', 'inventory', 'billing', 'sales_orders', 'purchases'), catalog.get);
router.put('/products/:id', ...write, can('products'), catalog.update);
router.get('/categories', ...read, any('products', 'inventory', 'billing', 'sales_orders'), catalog.categories);
router.post('/categories', ...write, can('products'), catalog.createCategory);
router.put('/categories/:id', ...write, can('products'), catalog.renameCategory);

/* ── pricing ──────────────────────────────────────────────────────────────── */
router.get('/price-lists', ...read, any('pricing', 'sales_orders', 'billing'), feature('wholesale_pricing'), catalog.priceLists);
router.post('/price-lists', ...write, can('pricing'), feature('wholesale_pricing'), catalog.createList);
router.put('/price-lists/:id', ...write, can('pricing'), feature('wholesale_pricing'), catalog.updateList);
router.get('/price-lists/:id/items', ...read, any('pricing', 'sales_orders'), feature('wholesale_pricing'), catalog.listItems);
router.put('/price-lists/:id/items', ...write, can('pricing'), feature('wholesale_pricing'), catalog.setItems);
router.delete('/price-lists/:id/items/:itemId', ...write, can('pricing'), feature('wholesale_pricing'), catalog.removeItem);
router.get('/customers/:id/prices', ...read, any('pricing', 'sales_orders'), feature('wholesale_pricing'), catalog.customerPrices);
router.put('/customers/:id/prices', ...write, can('pricing'), feature('wholesale_pricing'), catalog.setCustomerPrices);
router.delete('/customers/:id/prices/:priceId', ...write, can('pricing'), feature('wholesale_pricing'), catalog.removeCustomerPrice);
router.post('/pricing/quote', ...read, any('sales_orders', 'billing', 'pricing'), catalog.quote);

/* ── customers ────────────────────────────────────────────────────────────── */
router.get('/customers', ...read, any('customers', 'sales_orders', 'billing'), parties.listCustomers);
router.post('/customers', ...write, any('customers', 'sales_orders'), parties.createCustomer);
router.get('/customers/:id', ...read, any('customers', 'sales_orders', 'billing'), parties.getCustomer);
router.put('/customers/:id', ...write, can('customers'), parties.updateCustomer);
router.post('/customers/:id/archive', ...write, can('customers'), parties.archiveCustomer);
router.post('/customers/:id/restore', ...write, can('customers'), parties.restoreCustomer);
router.get('/customers/:id/ledger', ...read, any('payments', 'reports', 'customers'), parties.customerLedger);
router.get('/customers/:id/ageing', ...read, any('payments', 'reports', 'customers'), parties.customerAgeing);
router.get('/customers/:id/invoices', ...read, any('payments', 'billing', 'customers'), parties.customerInvoices);
router.get('/customers/:id/credit', ...read, any('customers', 'sales_orders', 'payments'), parties.customerCredit);
router.put('/customers/:id/credit-limit', ...write, can('payments'), parties.setCreditLimit);

/* ── sales orders ─────────────────────────────────────────────────────────── */
const orderGate = [feature('wholesale_orders')];
router.get('/orders', ...read, can('sales_orders'), ...orderGate, orders.list);
router.get('/backorders', ...read, any('sales_orders', 'fulfilment'), ...orderGate, orders.backorders);
router.post('/orders/preview', ...read, can('sales_orders'), ...orderGate, orders.preview);
router.post('/orders', ...write, can('sales_orders'), ...orderGate, once, orders.create);
router.get('/orders/:id', ...read, any('sales_orders', 'fulfilment'), ...orderGate, orders.get);
router.put('/orders/:id', ...write, can('sales_orders'), ...orderGate, orders.update);
router.post('/orders/:id/submit', ...write, can('sales_orders'), ...orderGate, once, orders.submit);
router.post('/orders/:id/confirm', ...write, can('sales_orders'), ...orderGate, once, orders.confirm);
router.post('/orders/:id/reserve', ...write, any('sales_orders', 'fulfilment'), ...orderGate, once, orders.reserve);
router.post('/orders/:id/cancel', ...write, can('sales_orders'), ...orderGate, once, orders.cancel);
router.post('/orders/:id/close', ...write, can('sales_cancel'), ...orderGate, once, orders.close);

/* ── warehouse fulfilment: pick → pack → dispatch → deliver ──────────────── */
const fulfilGate = [feature('wholesale_fulfilment')];
router.get('/fulfilment/summary', ...read, can('fulfilment'), ...fulfilGate, fulfilment.summary);
router.post('/orders/:id/pick-lists', ...write, can('fulfilment'), ...fulfilGate, once, fulfilment.createPick);
router.get('/pick-lists', ...read, can('fulfilment'), ...fulfilGate, fulfilment.listPicks);
router.get('/pick-lists/:id', ...read, can('fulfilment'), ...fulfilGate, fulfilment.getPick);
router.post('/pick-lists/:id/start', ...write, can('fulfilment'), ...fulfilGate, fulfilment.startPick);
router.post('/pick-lists/:id/pick', ...write, can('fulfilment'), ...fulfilGate, once, fulfilment.recordPick);
router.post('/pick-lists/:id/pack', ...write, can('fulfilment'), ...fulfilGate, once, fulfilment.pack);
router.post('/pick-lists/:id/cancel', ...write, can('fulfilment'), ...fulfilGate, once, fulfilment.cancelPick);
router.post('/pick-lists/:id/dispatch', ...write, can('fulfilment'), ...fulfilGate, once, fulfilment.dispatch);
router.get('/deliveries', ...read, any('fulfilment', 'billing'), ...fulfilGate, fulfilment.listDeliveries);
router.get('/deliveries/:id', ...read, any('fulfilment', 'billing'), ...fulfilGate, fulfilment.getDelivery);
router.get('/deliveries/:id/challan', ...read, any('fulfilment', 'billing'), ...fulfilGate, fulfilment.challan);
router.put('/deliveries/:id', ...write, can('fulfilment'), ...fulfilGate, fulfilment.updateDelivery);
router.post('/deliveries/:id/status', ...write, can('fulfilment'), ...fulfilGate, once, fulfilment.setDeliveryStatus);

/* ── warehouses, stock, batches, transfers ────────────────────────────────── */
const batchGate = [feature('wholesale_batches')];
router.get('/warehouses', ...read, any('inventory', 'fulfilment', 'sales_orders', 'purchases'), inventory.listWarehouses);
router.put('/warehouses/:id', ...write, can('inventory'), inventory.updateWarehouse);
router.get('/warehouses/:id/locations', ...read, any('inventory', 'fulfilment'), inventory.listLocations);
router.post('/warehouses/:id/locations', ...write, can('inventory'), inventory.createLocation);
router.put('/locations/:id', ...write, can('inventory'), inventory.updateLocation);
router.put('/products/:id/bin', ...write, can('inventory'), inventory.assignBin);
router.get('/inventory', ...read, any('inventory', 'sales_orders', 'purchases', 'fulfilment'), inventory.levels);
router.get('/inventory/alerts', ...read, any('inventory', 'reports'), inventory.alerts);
router.get('/inventory/movements', ...read, can('inventory'), inventory.movements);
router.get('/inventory/damaged', ...read, can('inventory'), inventory.damaged);
router.get('/inventory/batches', ...read, any('inventory', 'fulfilment'), ...batchGate, inventory.batches);
router.get('/inventory/expiry', ...read, any('inventory', 'reports'), ...batchGate, inventory.expiry);
router.get('/inventory/product/:id', ...read, any('inventory', 'sales_orders', 'purchases', 'fulfilment'), inventory.productStock);
router.post('/inventory/adjust', ...write, can('inventory'), once, inventory.adjust);
router.post('/inventory/write-off-damaged', ...write, can('inventory'), once, inventory.writeOffDamaged);
router.get('/transfers', ...read, any('inventory', 'fulfilment'), ...fulfilGate, inventory.listTransfers);
router.post('/transfers', ...write, can('inventory'), ...fulfilGate, once, inventory.createTransfer);
router.get('/transfers/:id', ...read, any('inventory', 'fulfilment'), ...fulfilGate, inventory.getTransfer);
router.post('/transfers/:id/dispatch', ...write, any('inventory', 'fulfilment'), ...fulfilGate, once, inventory.dispatchTransfer);
router.post('/transfers/:id/receive', ...write, any('inventory', 'fulfilment'), ...fulfilGate, once, inventory.receiveTransfer);
router.post('/transfers/:id/cancel', ...write, can('inventory'), ...fulfilGate, once, inventory.cancelTransfer);

/* ── purchasing: orders, approval, goods receipt, supplier payments ───────── */
router.get('/purchase-orders', ...read, any('purchases', 'payments'), purchasing.listPOs);
router.get('/purchase-orders/due-in', ...read, any('purchases', 'inventory'), purchasing.dueIn);
router.post('/purchase-orders', ...write, can('purchases'), once, purchasing.createPO);
router.get('/purchase-orders/:id', ...read, any('purchases', 'payments'), purchasing.getPO);
router.put('/purchase-orders/:id', ...write, can('purchases'), purchasing.updatePO);
router.post('/purchase-orders/:id/approve', ...write, can('purchase_approve'), once, purchasing.approvePO);
router.post('/purchase-orders/:id/send', ...write, can('purchases'), purchasing.sendPO);
router.post('/purchase-orders/:id/cancel', ...write, can('purchases'), once, purchasing.cancelPO);
router.post('/purchase-orders/:id/close-short', ...write, can('purchases'), once, purchasing.closeShort);
router.post('/purchase-orders/:id/payments', ...write, any('payments', 'purchases'), once, purchases.addPayment);
router.get('/purchase-orders/:id/debit-notes/options', ...read, can('purchases'), debitNotes.options);
router.get('/grns', ...read, any('purchases', 'inventory'), purchasing.listGRNs);
router.post('/grns', ...write, any('purchases', 'inventory'), once, purchasing.createGRN);
router.get('/grns/:id', ...read, any('purchases', 'inventory'), purchasing.getGRN);

/* ── customer receipts, advances, refunds ─────────────────────────────────── */
router.get('/receipts', ...read, any('payments', 'reports'), money.list);
router.post('/receipts', ...write, can('payments'), once, money.create);
router.get('/receipts/:id', ...read, any('payments', 'reports'), money.get);
router.post('/receipts/:id/allocate', ...write, can('payments'), once, money.allocateLater);
router.post('/receipts/:id/reverse', ...write, can('refunds'), once, money.reverse);
router.post('/refunds', ...write, can('refunds'), once, money.refund);
router.get('/customers/:id/open-invoices', ...read, any('payments', 'billing', 'customers'), money.openInvoices);

/* ── returns (credit notes and debit notes) ───────────────────────────────── */
router.get('/returns', ...read, any('refunds', 'inventory', 'purchases', 'reports'), returns.list);
router.get('/returns/:id', ...read, any('refunds', 'inventory', 'purchases', 'reports'), returns.get);
router.get('/invoices/:id/returnable', ...read, any('refunds', 'billing'), returns.returnableLines);
router.post('/returns/sales', ...write, can('refunds'), once, returns.salesReturn);
router.post('/returns/purchase', ...write, can('purchases'), once, returns.purchaseReturn);

/* ── suppliers ────────────────────────────────────────────────────────────── */
router.get('/suppliers', ...read, any('suppliers', 'purchases'), parties.listSuppliers);
router.post('/suppliers', ...write, can('suppliers'), parties.createSupplier);
router.get('/suppliers/:id', ...read, any('suppliers', 'purchases'), parties.getSupplier);
router.put('/suppliers/:id', ...write, can('suppliers'), parties.updateSupplier);
router.post('/suppliers/:id/archive', ...write, can('suppliers'), parties.archiveSupplier);
router.post('/suppliers/:id/restore', ...write, can('suppliers'), parties.restoreSupplier);
router.get('/suppliers/:id/ledger', ...read, any('payments', 'reports', 'suppliers'), parties.supplierLedger);

router.post('/ledger-adjustments', ...write, can('payments'), once, parties.adjustLedger);

/* ── salespeople ──────────────────────────────────────────────────────────── */
router.get('/salespeople', ...read, any('customers', 'sales_orders', 'reports', 'settings'), parties.listSalespeople);
router.post('/salespeople', ...write, can('settings'), parties.createSalesperson);
router.put('/salespeople/:id', ...write, can('settings'), parties.updateSalesperson);
router.get('/salespeople/:id/performance', ...read, any('reports', 'settings'), parties.salespersonPerformance);

export default router;
