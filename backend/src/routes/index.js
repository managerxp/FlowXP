/*
 * Every route in FlowXP.
 *
 * Auth, business and dashboard stay inline here — three small controllers
 * that were never going to grow their own file. Everything commerce-shaped
 * (products, customers, billing, purchases, reports...) got real enough that
 * one file per domain reads better than a routing table several screens long;
 * this file is now just the mount point for those, plus the handful of routes
 * that never fit anywhere else.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import pool from '../config/database.js';
import { requireAuth, withBusiness, requireOwner } from '../middleware/auth.js';
import * as auth from '../controllers/auth.controller.js';
import * as business from '../controllers/business.controller.js';
import * as dashboard from '../controllers/dashboard.controller.js';
import productsRoutes from './products.routes.js';
import menuRoutes from './menu.routes.js';
import profitabilityRoutes from './profitability.routes.js';
import leakageRoutes from './leakage.routes.js';
import forecastRoutes from './forecast.routes.js';
import notificationsRoutes from './notifications.routes.js';
import kitchenRoutes from './kitchen.routes.js';
import customersRoutes from './customers.routes.js';
import suppliersRoutes from './suppliers.routes.js';
import invoicesRoutes from './invoices.routes.js';
import paymentsRoutes from './payments.routes.js';
import inventoryRoutes from './inventory.routes.js';
import purchasesRoutes from './purchases.routes.js';
import expensesRoutes from './expenses.routes.js';
import reportsRoutes from './reports.routes.js';
import ordersRoutes from './orders.routes.js';
import tablesRoutes from './tables.routes.js';
import integrationsRoutes from './integrations.routes.js';
import adminRoutes from './admin.routes.js';
import outletsRoutes from './outlets.routes.js';
import loyaltyRoutes from './loyalty.routes.js';
import aiRoutes from './ai.routes.js';
import auditRoutes from './audit.routes.js';
import menuImportRoutes from './menuImport.routes.js';
import creditNoteRoutes from './creditNotes.routes.js';
import publicOrderingRoutes from './publicOrdering.routes.js';

const router = Router();

/*
 * Rate limits on the endpoints where a wrong answer is cheap to retry.
 *
 * Login and password reset are the only routes an attacker gains anything by
 * hammering, and signup is the one that costs us rows. Everything else is
 * behind a token, which is its own limit. Blanket-limiting the whole API just
 * throttles the billing screen during a lunch rush.
 */
const limiter = (max, minutes, message) => rateLimit({
  windowMs: minutes * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message }
});

const loginLimiter = limiter(10, 15, 'Too many attempts. Try again in a few minutes.');
const signupLimiter = limiter(5, 60, 'Too many accounts created from here. Try again later.');
const resetLimiter = limiter(5, 60, 'Too many reset requests. Try again later.');

/* ── Public ─────────────────────────────────────────────────────────────── */

router.post('/auth/signup', signupLimiter, auth.signup);
router.post('/auth/login', loginLimiter, auth.login);
router.post('/auth/forgot-password', resetLimiter, auth.forgotPassword);
router.post('/auth/reset-password', resetLimiter, auth.resetPassword);

/* The public pricing page reads this. Prices live in the database so they can
   change without a deploy — see the note in database.js. */
router.get('/plans', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT plan_code, name, description, price_monthly_paise, price_yearly_paise,
              limits, features
       FROM plans WHERE is_active AND is_public ORDER BY sort_order`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('[plans] read failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load plans' });
  }
});

/* A customer's own phone, no session at all — identified purely by the
   table's qr_token in the URL. See publicOrdering.routes.js. */
router.use('/public', publicOrderingRoutes);

/* ── Signed in, no business needed ──────────────────────────────────────── */

router.get('/auth/me', requireAuth, auth.me);
router.post('/businesses', requireAuth, business.createBusiness);

/*
 * Logout is client-side: the token is stateless, so signing out means dropping
 * it. This endpoint exists so the frontend has something to call and the audit
 * trail has something to record; it deliberately does not maintain a
 * denylist. Add one when tokens outlive a session in a way that matters.
 */
router.post('/auth/logout', requireAuth, (_req, res) =>
  res.json({ success: true, message: 'Signed out' })
);

/* ── Signed in, scoped to one business ──────────────────────────────────── */

router.get('/businesses/current', requireAuth, withBusiness(), business.getCurrent);
router.patch('/businesses/current', requireAuth, withBusiness({ requireActive: true }), requireOwner, business.updateCurrent);
router.get('/businesses/current/subscription', requireAuth, withBusiness(), business.getSubscription);

/* Readable after the trial ends, on purpose — see withBusiness(). */
router.get('/dashboard', requireAuth, withBusiness(), dashboard.getDashboard);

/* ── Commerce ───────────────────────────────────────────────────────────── */

router.use('/', productsRoutes);           // /categories, /products
router.use('/', creditNoteRoutes);         // /invoices/:id/credit-notes, /credit-notes
router.use('/', loyaltyRoutes);            // /loyalty, /coupons
router.use('/', outletsRoutes);            // /outlets, /staff
router.use('/', menuRoutes);               // /modifier-groups, /products/:id/recipe
router.use('/customers', customersRoutes);
router.use('/suppliers', suppliersRoutes);
router.use('/invoices', invoicesRoutes);
router.use('/payments', paymentsRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/purchases', purchasesRoutes);
router.use('/expenses', expensesRoutes);
router.use('/reports', reportsRoutes);
router.use('/profitability', profitabilityRoutes);
router.use('/leakage', leakageRoutes);
router.use('/forecast', forecastRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/kitchen', kitchenRoutes);
router.use('/orders', ordersRoutes);
router.use('/tables', tablesRoutes);
router.use('/integrations', integrationsRoutes);
router.use('/ai', aiRoutes);
router.use('/audit', auditRoutes);
router.use('/menu-import', menuImportRoutes);

/* ── Platform administration — not a tenant, sits outside the business
   model entirely; see admin.routes.js for its own auth gate. ──────────── */
router.use('/admin', adminRoutes);

export default router;
