/*
 * /api/salon/* — the salon module's routes.
 *
 * Every route: signed in, scoped to one business (withBusiness), and only for a SALON business (salonOnly).
 * Then a permission (per person, from the role and any overrides) and, where the feature is separately priced, a
 * plan feature (per business, from the plan / add-on / super-admin override). Writes also require an active
 * subscription (withBusiness({ requireActive })). Money-moving POSTs accept an Idempotency-Key.
 */
import { Router } from 'express';
import { requireAnyPermission, requireAuth, requireOutlet, requirePermission, requirePlanFeature, withBusiness } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import { salonOnly } from '../modules/salon/common.js';
import settings from '../controllers/salonSettings.controller.js';
import catalog from '../controllers/salonCatalog.controller.js';
import staff from '../controllers/salonStaff.controller.js';
import appointments from '../controllers/salonAppointments.controller.js';
import clients from '../controllers/salonClients.controller.js';
import pos from '../controllers/salonPos.controller.js';
import plans from '../controllers/salonPlans.controller.js';
import loyalty from '../controllers/salonLoyalty.controller.js';
import commission from '../controllers/salonCommission.controller.js';
import inventory from '../controllers/salonInventory.controller.js';
import reports from '../controllers/salonReports.controller.js';
import automation from '../controllers/salonAutomation.controller.js';

const router = Router();

const read = [requireAuth, withBusiness(), salonOnly];
const write = [requireAuth, withBusiness({ requireActive: true }), salonOnly];
const any = (...p) => requireAnyPermission(...p);
const can = (p) => requirePermission(p);
const feature = (f) => requirePlanFeature(f);

/* a stylist may move their own clients along but not run the front desk */
const notStylist = (req, res, next) => (req.tenant.role === 'STYLIST'
  ? res.status(403).json({ success: false, message: 'You do not have access to this' }) : next());

/* ── settings ─────────────────────────────────────────────────────────────── */
router.get('/settings', ...read, any('settings', 'billing', 'appointments', 'products'), settings.get);
router.put('/settings', ...write, can('settings'), settings.update);
router.put('/branches/:id/settings', ...write, can('settings'), settings.updateBranch);

/* ── catalogue: categories, services, retail products ─────────────────────── */
router.get('/categories', ...read, any('products', 'billing', 'appointments', 'inventory'), catalog.listCategories);
router.post('/categories', ...write, can('products'), catalog.createCategory);
router.put('/categories/:id', ...write, can('products'), catalog.updateCategory);
router.delete('/categories/:id', ...write, can('products'), catalog.removeCategory);

router.get('/services', ...read, any('products', 'billing', 'appointments'), catalog.listServices);
router.post('/services', ...write, can('products'), catalog.createService);
router.get('/services/:id', ...read, any('products', 'billing', 'appointments'), catalog.getService);
router.put('/services/:id', ...write, can('products'), catalog.updateService);
router.post('/services/:id/archive', ...write, can('products'), catalog.archiveService);
router.post('/services/:id/restore', ...write, can('products'), catalog.restoreService);
router.get('/services/:id/consumables', ...read, can('products'), catalog.getConsumables);
router.put('/services/:id/consumables', ...write, can('products'), catalog.setConsumables);

router.get('/products', ...read, any('products', 'inventory', 'billing'), catalog.listProducts);
router.put('/products/:id/details', ...write, any('products', 'inventory'), catalog.setProductDetails);

/* ── team and attendance ──────────────────────────────────────────────────── */
router.get('/staff', ...read, any('appointments', 'billing', 'staff_commission'), staff.list);
router.post('/staff', ...write, can('staff_commission'), staff.create);
router.get('/staff/:id', ...read, any('appointments', 'billing', 'staff_commission'), staff.get);
router.put('/staff/:id', ...write, can('staff_commission'), staff.update);
router.get('/attendance', ...read, any('appointments', 'staff_commission'), staff.attendance);
router.get('/attendance/summary', ...read, can('staff_commission'), staff.attendanceSummary);
router.put('/attendance', ...write, any('appointments', 'staff_commission'), notStylist, staff.markAttendance);

/* ── appointments ─────────────────────────────────────────────────────────── */
const appts = [feature('salon_appointments'), can('appointments')];
router.get('/appointments', ...read, ...appts, appointments.list);
router.get('/appointments/:id', ...read, ...appts, appointments.get);
router.get('/appointments/:id/cart', ...read, ...appts, notStylist, appointments.cart);
router.post('/appointments', ...write, ...appts, notStylist, requireOutlet, appointments.create);
router.put('/appointments/:id', ...write, ...appts, notStylist, requireOutlet, appointments.reschedule);
router.post('/appointments/:id/status', ...write, ...appts, appointments.setStatus);
router.get('/schedule', ...read, ...appts, appointments.schedule);
router.get('/availability', ...read, ...appts, notStylist, appointments.availability);

/* ── clients (CRM) ────────────────────────────────────────────────────────── */
const seeClients = any('customers', 'billing', 'appointments');
router.get('/clients', ...read, seeClients, clients.list);
router.get('/clients/segments', ...read, any('customers', 'billing'), clients.segments);
router.get('/clients/lookup', ...read, any('customers', 'billing', 'appointments'), clients.lookup);
router.post('/clients', ...write, can('customers'), clients.create);
router.get('/clients/:id', ...read, seeClients, clients.get);
router.put('/clients/:id', ...write, can('customers'), clients.update);
router.get('/clients/:id/timeline', ...read, seeClients, clients.timeline);
router.post('/clients/:id/notes', ...write, any('customers', 'appointments'), clients.addNote);

/* ── the till ─────────────────────────────────────────────────────────────── */
router.get('/pos/catalog', ...read, can('billing'), pos.catalog);
router.get('/pos/products', ...read, can('billing'), pos.products);
router.get('/pos/entitlements', ...read, can('billing'), pos.entitlements);
router.post('/pos/quote', ...write, can('billing'), requireOutlet, pos.quote);
router.post('/pos/invoices', ...write, can('billing'), requireOutlet, idempotent(), pos.create);
router.get('/invoices/:id/lines', ...read, can('billing'), pos.invoiceLines);

/* ── memberships, packages, gift cards, offers ────────────────────────────── */
router.get('/membership-plans', ...read, any('products', 'billing'), feature('salon_memberships'), plans.listPlans);
router.post('/membership-plans', ...write, can('products'), feature('salon_memberships'), plans.createPlan);
router.put('/membership-plans/:id', ...write, can('products'), feature('salon_memberships'), plans.updatePlan);
router.get('/memberships', ...read, any('customers', 'billing', 'products'), feature('salon_memberships'), plans.listMemberships);
router.get('/memberships/:id/usage', ...read, any('customers', 'billing', 'products'), feature('salon_memberships'), plans.membershipUsage);
router.post('/memberships/:id/cancel', ...write, can('refunds'), feature('salon_memberships'), plans.cancelMembership);

router.get('/packages', ...read, any('products', 'billing'), feature('salon_packages'), plans.listPackages);
router.post('/packages', ...write, can('products'), feature('salon_packages'), plans.createPackage);
router.put('/packages/:id', ...write, can('products'), feature('salon_packages'), plans.updatePackage);
router.get('/client-packages', ...read, any('customers', 'billing', 'products'), feature('salon_packages'), plans.listClientPackages);
router.put('/client-packages/:id', ...write, can('refunds'), feature('salon_packages'), plans.adjustClientPackage);

router.get('/gift-cards', ...read, any('billing', 'products'), feature('salon_gift_cards'), plans.listCards);
router.get('/gift-cards/lookup', ...read, can('billing'), feature('salon_gift_cards'), plans.lookupCard);
router.post('/gift-cards', ...write, can('refunds'), feature('salon_gift_cards'), plans.issueComplimentary);
router.post('/gift-cards/:id/adjust', ...write, can('refunds'), feature('salon_gift_cards'), plans.adjustCard);
router.post('/gift-cards/:id/cancel', ...write, can('refunds'), feature('salon_gift_cards'), plans.cancelCard);

router.get('/offers', ...read, any('products', 'billing'), plans.listOffers);
router.post('/offers', ...write, can('products'), plans.createOffer);
router.put('/offers/:id', ...write, can('products'), plans.updateOffer);

/* ── loyalty ──────────────────────────────────────────────────────────────── */
router.get('/loyalty', ...read, any('settings', 'billing'), feature('loyalty'), loyalty.get);
router.put('/loyalty', ...write, can('settings'), feature('loyalty'), loyalty.put);
router.get('/loyalty/summary', ...read, can('reports'), feature('loyalty'), loyalty.summary);
router.post('/loyalty/expire', ...write, can('settings'), feature('loyalty'), loyalty.expireNow);

/* ── commission ───────────────────────────────────────────────────────────── */
const comm = [can('staff_commission'), feature('salon_commission')];
router.get('/commissions', ...read, ...comm, commission.list);
router.get('/commissions/summary', ...read, ...comm, commission.summary);
router.post('/commissions/approve', ...write, ...comm, commission.approve);
router.post('/commissions/pay', ...write, ...comm, idempotent(), commission.pay);
router.get('/commission-payouts', ...read, ...comm, commission.payouts);

/* ── stock ────────────────────────────────────────────────────────────────── */
router.post('/stock/in', ...write, can('inventory'), requireOutlet, idempotent(), inventory.stockIn);
router.get('/stock/batches', ...read, can('inventory'), inventory.batches);
router.get('/alerts', ...read, any('inventory', 'reports'), inventory.alerts);

/* ── dashboard and reports ────────────────────────────────────────────────── */
router.get('/dashboard', ...read, any('reports', 'billing', 'appointments'), reports.dashboard);
router.get('/reports', ...read, can('reports'), reports.catalog);
router.get('/reports/:name', ...read, can('reports'), reports.run);

/* ── automation and campaigns ─────────────────────────────────────────────── */
router.get('/automations', ...read, can('settings'), automation.list);
router.put('/automations/:key', ...write, can('settings'), feature('salon_automation'), automation.update);
router.post('/automations/run', ...write, can('settings'), feature('salon_automation'), automation.runNow);
router.get('/campaigns/audience', ...read, can('settings'), feature('salon_automation'), automation.audience);
router.post('/campaigns', ...write, can('settings'), feature('salon_automation'), automation.campaign);

export default router;
