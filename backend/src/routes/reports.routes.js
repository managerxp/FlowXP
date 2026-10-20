/*
 * All reads. The GST report is gated separately on 'gst' rather than
 * 'reports' — MANAGER holds 'reports' but not 'gst' in ROLE_PERMISSIONS,
 * because filing exposure is an owner/admin concern even on a team where a
 * manager runs every other report.
 */
import * as ledger from '../controllers/ledgerReports.controller.js';
import * as profit from '../controllers/profitReports.controller.js';
import * as gstR from '../controllers/gstReports.controller.js';
import * as expenseR from '../controllers/expenseReports.controller.js';
import * as partyR from '../controllers/partyReports.controller.js';
import * as accountant from '../controllers/accountantPack.controller.js';
import * as stockR from '../controllers/stockReports.controller.js';
import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission } from '../middleware/auth.js';
import * as reports from '../controllers/reports.controller.js';

const router = Router();
const authed = [requireAuth, withBusiness(), requirePermission('reports')];

router.get('/sales', ...authed, reports.sales);
router.get('/waiters', ...authed, reports.waiters);
router.get('/purchases', ...authed, reports.purchases);
router.get('/expenses', ...authed, reports.expenses);
router.get('/outstanding', ...authed, reports.outstanding);
router.get('/inventory', ...authed, reports.inventory);
router.get('/customers', ...authed, reports.customers);
router.get('/gst', requireAuth, withBusiness(), requirePermission('gst'), reports.gst);
router.get('/gst/register', requireAuth, withBusiness(), requirePermission('gst'), reports.gstRegister);
router.get('/transactions', ...authed, ledger.transactions);
router.get('/party-statement', ...authed, ledger.partyStatement);
router.get('/by-party', ...authed, ledger.byParty);
router.get('/profit/bills', ...authed, profit.profitByBill);
router.get('/profit/items', ...authed, profit.profitByItem);
router.get('/profit/parties', ...authed, profit.profitByParty);
router.get('/profit-loss', ...authed, profit.profitLoss);
router.get('/discounts', ...authed, profit.discounts);
router.get('/expense/categories', ...authed, expenseR.byCategory);
router.get('/expense/items', ...authed, expenseR.byItem);
router.get('/expense/list', ...authed, expenseR.list);
router.get('/parties/all', ...authed, partyR.all);
router.get('/parties/items', ...authed, partyR.items);
router.get('/stock/summary', requireAuth, withBusiness(), requirePermission('inventory'), stockR.summary);
router.get('/stock/low', requireAuth, withBusiness(), requirePermission('inventory'), stockR.low);
router.get('/stock/items', requireAuth, withBusiness(), requirePermission('inventory'), stockR.items);
router.get('/stock/ledger', requireAuth, withBusiness(), requirePermission('inventory'), stockR.ledger);
router.get('/category-sales', ...authed, stockR.categorySales);
router.get('/accountant-pack', requireAuth, withBusiness(), requirePermission('export'), accountant.download);
router.post('/accountant-pack/email', requireAuth, withBusiness({ requireActive: true }), requirePermission('export'), accountant.email);
router.get('/gst/summary', requireAuth, withBusiness(), requirePermission('gst'), gstR.summary);
router.get('/gst/rates', requireAuth, withBusiness(), requirePermission('gst'), gstR.rates);
router.get('/gst/gstr2', requireAuth, withBusiness(), requirePermission('gst'), gstR.gstr2);
router.get('/gst/options', requireAuth, withBusiness(), requirePermission('gst'), gstR.options);

export default router;
