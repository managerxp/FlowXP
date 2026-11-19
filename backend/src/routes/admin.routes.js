/*
 * Super admin routes — mounted at /api/admin. Every route past login sits
 * behind requireAuth + requireSuperAdmin, the same two-step gate the rest of
 * the API uses for requireAuth + withBusiness, just checking a platform-level
 * flag instead of a tenant membership.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as deletion from '../controllers/accountDeletion.controller.js';
import { requireAuth, requireSuperAdmin, requireAdminTwoFactor, requireAdminPermission as need } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import * as admin from '../controllers/admin.controller.js';
import * as staff from '../controllers/adminStaff.controller.js';
import * as adminPayments from '../controllers/adminPayments.controller.js';
import * as settings from '../controllers/settings.controller.js';
import * as appErrors from '../controllers/appErrors.controller.js';
import * as support from '../controllers/adminSupport.controller.js';
import * as tickets from '../controllers/support.controller.js';
import * as messaging from '../controllers/adminMessaging.controller.js';
import * as docs from '../controllers/adminDocuments.controller.js';
import * as pin from '../controllers/pinLogin.controller.js';
import * as testimonials from '../controllers/testimonials.controller.js';
import { uploadProductImage } from '../middleware/upload.js';

const router = Router();

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Try again in a few minutes.' }
});

router.post('/login', adminLoginLimiter, admin.login);
router.post('/login/code', adminLoginLimiter, admin.staffCode);   // staff: a code is emailed instead of a password
router.post('/login/verify', adminLoginLimiter, admin.staffVerify);
router.post('/login/pin', adminLoginLimiter, admin.staffPin);   // staff, on a computer that already has their PIN

// a generous ceiling for everything else the console does: it is one person clicking, never a crowd
router.use(rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many requests. Slow down for a minute.' } }));

router.use(requireAuth, requireSuperAdmin, requireAdminTwoFactor);

// a signed-in staff member sets the PIN for this computer (the sign-in with it is /login/pin above)
router.get('/pin', pin.myPinHere);
router.post('/pin', pin.setPin);

/* Who may do what: every group of routes below names the permission it needs (modules/adminRoles.js). The owner has them all; /me, /stats and /bug-summary are open to any staff sign-in. */
router.use('/staff', need('owner'));
router.use('/deletion-requests', need('owner'));
router.use(['/app-errors', '/bug-reports'], need('bugs'));
router.use('/support', need('support'));
router.use('/messaging', need('messaging'));
router.use(['/documents', '/company'], need('billing'));
router.use('/users', need('people'));
router.use(['/audit', '/launch-checks', '/testimonials', '/settings'], need('owner'));
router.use(['/plans', '/plan-features', '/business-type-features', '/addons'], (req, res, next) => need(req.method === 'GET' ? 'customers' : 'owner')(req, res, next));
router.get('/businesses', need('customers'));
router.get('/businesses/:id', need('customers'));
router.get(/^\/businesses\/[^/]+\/(history|features|outlets|overrides|notes|messaging)$/, need('customers'));
router.get('/staff', staff.list);
router.post('/staff', staff.create);
router.patch('/staff/:id', staff.update);

router.get('/deletion-requests', deletion.adminList);
router.post('/deletion-requests/:id/complete', deletion.adminComplete);
router.post('/deletion-requests/:id/decline', deletion.adminDecline);
router.get('/app-errors', appErrors.list);   // crash reports from the mobile app
router.patch('/app-errors/status', appErrors.setCrashStatus);
router.get('/bug-reports', appErrors.reports);   // what people typed under "Report a problem"
router.patch('/bug-reports/:id', appErrors.setReportStatus);
router.get('/bug-summary', appErrors.summary);
router.get('/support/tickets', tickets.adminList);
router.get('/support/tickets/:id', tickets.adminGet);
router.post('/support/tickets/:id/reply', tickets.adminReply);
router.patch('/support/tickets/:id', tickets.adminSetStatus);

router.get('/messaging/usage', messaging.usage);   // WhatsApp sent per business and Meta's estimated charge
router.get('/businesses/:id/messaging', messaging.businessUsage);
router.get('/documents', docs.list);
router.post('/documents', docs.create);
router.get('/documents/client/:businessId', docs.clientOf);
router.get('/documents/:id', docs.get);
router.put('/documents/:id', docs.update);
router.post('/documents/:id/status', docs.setStatus);
router.post('/documents/:id/convert', docs.convert);
router.post('/documents/:id/email', docs.emailDocument);
router.post('/documents/:id/whatsapp', docs.whatsappDocument);
router.post('/documents/:id/payment-link', idempotent((req) => `admin:${req.auth.userId}`), docs.paymentLink);
router.get('/company', docs.getCompany);
router.put('/company', docs.saveCompany);
router.get('/businesses/:id/wallet', need('payments'), messaging.getWallet);
router.post('/businesses/:id/wallet', need('payments'), messaging.topUpWallet);
router.patch('/businesses/:id/wallet-prices', need('payments'), messaging.setWalletPrices);

router.get('/me', admin.me);
router.get('/stats', admin.getStats);

router.get('/businesses', admin.listBusinesses);
router.get('/businesses/:id', admin.getBusiness);
router.patch('/businesses/:id/status', need('manage'), admin.updateBusinessStatus);
router.patch('/businesses/:id/crm', need('customers'), admin.updateClientCrm);
router.delete('/businesses/:id', need('owner'), admin.deleteBusiness);   // erases the business and its data for good; the exact name must be typed
router.patch('/businesses/:id/plan', need('manage'), admin.updateBusinessPlan);
router.get('/businesses/:id/history', admin.businessHistory);
router.get('/businesses/:id/features', admin.businessFeatures);
router.get('/businesses/:id/outlets', admin.businessOutlets);
router.put('/businesses/:id/outlets', need('manage'), admin.setBusinessOutlets);
router.get('/businesses/:id/overrides', admin.listBusinessOverrides);
router.post('/businesses/:id/overrides', need('manage'), admin.setBusinessOverride);
router.delete('/businesses/:id/overrides/:feature', need('manage'), admin.removeBusinessOverride);

router.post('/businesses/:id/extend-trial', need('customers'), support.extendTrial);
router.get('/businesses/:id/notes', support.listNotes);
router.post('/businesses/:id/notes', need('customers'), support.addNote);
router.delete('/businesses/:id/notes/:noteId', need('customers'), support.deleteNote);
router.get('/users', support.listUsers);
router.get('/users/:id', support.getUser);
router.post('/users/:id/sign-out', support.signOutUser);
router.post('/users/:id/verify-email', support.verifyUserEmail);
router.post('/users/:id/reset-2fa', support.resetUserTwoFactor);
router.get('/audit', support.auditLog);
router.get('/launch-checks', support.launchChecks);

router.get('/testimonials', testimonials.list);
router.post('/testimonials', testimonials.create);
router.patch('/testimonials/:id', testimonials.update);
router.delete('/testimonials/:id', testimonials.remove);
router.post('/testimonials/:id/image/:kind', uploadProductImage, testimonials.uploadImage);
router.delete('/testimonials/:id/image/:kind', testimonials.removeImage);

router.get('/plans', admin.listPlans);
router.patch('/plans/:code', admin.updatePlan);
router.get('/plans/:code/versions', admin.listPlanVersions);
router.get('/plan-features', admin.planFeatureCatalog);
router.get('/business-type-features', admin.listBusinessTypeFeatures);
router.patch('/business-type-features/:type/:plan', admin.updateBusinessTypeFeature);

router.get('/businesses/:id/payment-links', need('payments'), admin.listPaymentLinks);
router.post('/businesses/:id/payment-link', need('payments'), idempotent((req) => `admin:${req.auth.userId}`), admin.createPaymentLink);

router.post('/businesses/:id/orders/:kind/:orderId/mark-paid', need('payments'), adminPayments.markPaid);   // a link settled in cash, UPI or bank: same activation as a paid link
router.post('/businesses/:id/orders/:kind/:orderId/receipt', need('payments'), adminPayments.sendReceipt);

router.get('/addons', admin.listAddons);
router.post('/addons', admin.createAddon);
router.patch('/addons/:key', admin.updateAddon);
router.delete('/addons/:key', admin.deleteAddon);
router.get('/businesses/:id/addon-links', need('payments'), admin.listAddonLinks);
router.post('/businesses/:id/addon-link', need('payments'), idempotent((req) => `admin:${req.auth.userId}`), admin.createAddonLink);

router.get('/settings/payment-gateway', settings.getPaymentGateway);
router.put('/settings/payment-gateway', settings.updatePaymentGateway);
router.get('/settings/email', settings.getEmailSettings);
router.put('/settings/email', settings.updateEmailSettings);
router.get('/settings/messaging', settings.getMessagingSettings);
router.put('/settings/messaging', settings.updateMessagingSettings);

export default router;
