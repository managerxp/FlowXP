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
import { requireAuth, withBusiness, requireOwner, requirePermission, requireAnyPermission, clearSessionCookie } from '../middleware/auth.js';
import * as auth from '../controllers/auth.controller.js';
import * as oauth from '../controllers/oauth.controller.js';
import * as security from '../controllers/security.controller.js';
import * as approvals from '../controllers/approvals.controller.js';
import * as business from '../controllers/business.controller.js';
import * as dashboard from '../controllers/dashboard.controller.js';
import * as siteAssistant from '../controllers/siteAssistant.controller.js';
import * as webhooks from '../controllers/webhooks.controller.js';
import * as contact from '../controllers/contact.controller.js';
import * as deletion from '../controllers/accountDeletion.controller.js';
import productsRoutes from './products.routes.js';
import menuRoutes from './menu.routes.js';
import brandsRoutes from './brands.routes.js';
import settlementsRoutes from './settlements.routes.js';
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
import reservationRoutes from './reservations.routes.js';
import messagingRoutes from './messaging.routes.js';
import reviewsRoutes from './reviews.routes.js';
import printRoutes from './print.routes.js';
import buyingRoutes from './buying.routes.js';
import gstRoutes from './gst.routes.js';
import heldBillsRoutes from './heldBills.routes.js';
import locationsRoutes from './locations.routes.js';
import { uploadLogo } from '../middleware/upload.js';
import publicOrderingRoutes from './publicOrdering.routes.js';
import salonRoutes from './salon.routes.js';
import wholesaleRoutes from './wholesale.routes.js';
import distributorRoutes from './distributor.routes.js';
import pharmacyRoutes from './pharmacy.routes.js';
import retailRoutes from './retail.routes.js';
import syncRoutes from './sync.routes.js';
import * as appErrors from '../controllers/appErrors.controller.js';

const router = Router();

/*
 * Rate limits on the endpoints where a wrong answer is cheap to retry.
 *
 * Login and password reset are the only routes an attacker gains anything by
 * hammering, and signup is the one that costs us rows. Everything else is
 * behind a token, which is its own limit. Blanket-limiting the whole API just
 * throttles the billing screen during a lunch rush.
 */
const limiter = (max, minutes, message, options = {}) => rateLimit({
  windowMs: minutes * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message },
  ...options
});

/* Only FAILED attempts count against an address: a restaurant with a dozen staff behind one router signs in every
   morning, and those successes must not use up the allowance a guesser would. Each account has its own lockout on top
   (5 wrong passwords, 15 minutes: modules/security.js), so spreading guesses over many emails does not get around it. */
const loginLimiter = limiter(20, 15, 'Too many attempts. Try again in a few minutes.', { skipSuccessfulRequests: true });
const signupLimiter = limiter(5, 60, 'Too many accounts created from here. Try again later.');
const resetLimiter = limiter(5, 60, 'Too many reset requests. Try again later.');
const contactLimiter = limiter(5, 60, 'Too many messages sent. Try again later.');
const deletionLimiter = limiter(5, 60, 'Too many requests from here. Try again later.');
/* The website chat calls the AI provider, which costs money per message: generous for a person, tight for a script. */
const appErrorLimiter = limiter(30, 15, 'Too many reports from here.');
const assistantLimiter = limiter(30, 15, 'Too many questions in a short time. Try again in a few minutes.');

/* ── Public ─────────────────────────────────────────────────────────────── */

router.post('/app-errors', appErrorLimiter, appErrors.report);   // the mobile app's crash reports (no sign-in: a crash can come first)
router.post('/auth/signup', signupLimiter, auth.signup);
router.post('/auth/login', loginLimiter, auth.login);
router.post('/auth/login/2fa', loginLimiter, auth.loginTwoFactor);
router.get('/auth/oauth/providers', oauth.providers);
router.get('/auth/google/start', loginLimiter, oauth.googleStart);
router.get('/auth/google/callback', loginLimiter, oauth.googleCallback);
router.post('/auth/verify-email', loginLimiter, auth.verifyEmailOtp);
router.post('/auth/resend-email-otp', loginLimiter, auth.resendEmailOtp);
router.post('/auth/forgot-password', resetLimiter, auth.forgotPassword);
router.post('/auth/reset-password', resetLimiter, auth.resetPassword);
router.post('/contact', contactLimiter, contact.send);
// deleting an account: yourself when signed in, or a request when you cannot sign in (nothing is deleted from the public one until support has checked who is asking)
router.post('/auth/delete-account', requireAuth, loginLimiter, deletion.deleteMe);
router.post('/public/account-deletion', deletionLimiter, deletion.publicRequest);
router.post('/public/assistant', assistantLimiter, siteAssistant.ask);

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

/* Cashfree calling us back, not a person — verified by signature, not a token. */
router.post('/webhooks/cashfree', webhooks.cashfree);

/* ── Signed in, no business needed ──────────────────────────────────────── */

router.get('/auth/me', requireAuth, auth.me);

/* Account security. These only need a signed-in person (not a business), so an owner whose business requires
   two-step verification can still reach them to set it up. Password and code checks share the login limiter. */
router.get('/auth/2fa', requireAuth, security.status);
router.post('/auth/2fa/setup', requireAuth, security.setup);
router.post('/auth/2fa/enable', requireAuth, loginLimiter, security.enable);
router.post('/auth/2fa/disable', requireAuth, loginLimiter, security.disable);
router.post('/auth/2fa/recovery-codes', requireAuth, loginLimiter, security.newCodes);
router.post('/auth/change-password', requireAuth, loginLimiter, security.changePassword);
router.post('/auth/sign-out-everywhere', requireAuth, security.signOutEverywhere);
router.get('/auth/login-history', requireAuth, security.loginHistory);
/* Manager approval: a manager's PIN lets a cashier cancel a bill or give a large discount (modules/approvals.js). */
router.get('/auth/approval-pin', requireAuth, approvals.pinStatus);
router.put('/auth/approval-pin', requireAuth, loginLimiter, approvals.setPin);
router.delete('/auth/approval-pin', requireAuth, loginLimiter, approvals.clearPin);
router.get('/approvals', requireAuth, withBusiness(), requireAnyPermission('billing', 'settings'), approvals.get);
router.put('/approvals', requireAuth, withBusiness({ requireActive: true }), requirePermission('settings'), approvals.update);
router.get('/security/team', requireAuth, withBusiness(), requirePermission('settings'), security.team);
router.put('/security/policy', requireAuth, withBusiness({ requireActive: true }), requireOwner, security.setPolicy);
router.post('/businesses', requireAuth, business.createBusiness);

/*
 * Logout is client-side: the token is stateless, so signing out means dropping
 * it. This endpoint exists so the frontend has something to call and the audit
 * trail has something to record; it deliberately does not maintain a
 * denylist. Add one when tokens outlive a session in a way that matters.
 */
router.post('/auth/logout', (req, res) => {
  // Clears the session cookie. No sign-in needed: an expired session must still be able to clear its cookie.
  // The X-Requested-With check keeps another site from signing people out with a hidden form.
  if (req.headers['x-requested-with'] !== 'FlowXP' && !req.headers.authorization) return res.status(403).json({ success: false, message: 'This request did not come from the FlowXP app.' });
  clearSessionCookie(res);
  res.json({ success: true, message: 'Signed out' });
});

/* ── Signed in, scoped to one business ──────────────────────────────────── */

router.get('/businesses/current', requireAuth, withBusiness(), business.getCurrent);
router.patch('/businesses/current', requireAuth, withBusiness({ requireActive: true }), requireOwner, business.updateCurrent);
router.post('/businesses/current/logo', requireAuth, withBusiness({ requireActive: true }), requireOwner, uploadLogo, business.uploadLogo);
router.delete('/businesses/current/logo', requireAuth, withBusiness({ requireActive: true }), requireOwner, business.removeLogo);
router.get('/businesses/current/subscription', requireAuth, withBusiness(), business.getSubscription);

/* Readable after the trial ends, on purpose — see withBusiness(). */
router.get('/dashboard', requireAuth, withBusiness(), dashboard.getDashboard);

/* ── Commerce ───────────────────────────────────────────────────────────── */

router.use('/', productsRoutes);           // /categories, /products
router.use('/', creditNoteRoutes);         // /invoices/:id/credit-notes, /credit-notes
router.use('/', gstRoutes);                // /gst/* (GSTR-1, GSTR-3B, e-invoice, e-way bill)
router.use('/', heldBillsRoutes);          // /held-bills (bills parked at the till)
router.use('/', buyingRoutes);             // /suppliers/:id/prices, /debit-notes, /transfer-requests
router.use('/', printRoutes);              // /invoices/:id/escpos, /kitchen/kots/:id/escpos, /print/*
router.use('/', messagingRoutes);          // /messaging, /customers/:id/marketing
router.use('/', reviewsRoutes);            // /reviews (post-bill feedback, AI reply drafts)
router.use('/', reservationRoutes);        // /reservations, /waitlist
router.use('/', loyaltyRoutes);            // /loyalty, /coupons
router.use('/', outletsRoutes);            // /outlets, /staff
router.use('/', menuRoutes);               // /modifier-groups, /products/:id/recipe
router.use('/', brandsRoutes);             // /brands
router.use('/', settlementsRoutes);        // /settlements (aggregator statement import + reconciliation)
router.use('/customers', customersRoutes);
router.use('/suppliers', suppliersRoutes);
router.use('/sync', syncRoutes);            // /sync/head, /sync/changes (the mobile app's catalogue copy)
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
router.use('/locations', locationsRoutes);
router.use('/orders', ordersRoutes);
router.use('/tables', tablesRoutes);
router.use('/integrations', integrationsRoutes);
router.use('/ai', aiRoutes);
router.use('/audit', auditRoutes);
router.use('/menu-import', menuImportRoutes);
router.use('/distributor', distributorRoutes);   // the distributor layer: principals, territories, beats, schemes, targets, field sales, vans
router.use('/wholesale', wholesaleRoutes);   // the wholesale / distribution module (WHOLESALE and DISTRIBUTOR businesses only)
router.use('/salon', salonRoutes);          // the salon module (salon businesses only)
router.use('/pharmacy', pharmacyRoutes);    // the pharmacy module (PHARMACY businesses only)
router.use('/retail', retailRoutes);        // supermarket / retail settings (SUPERMARKET and RETAIL businesses only)

/* ── Platform administration — not a tenant, sits outside the business
   model entirely; see admin.routes.js for its own auth gate. ──────────── */
router.use('/admin', adminRoutes);

export default router;
