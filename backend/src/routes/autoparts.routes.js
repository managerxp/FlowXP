/*
 * /api/autoparts/* — the automotive spare parts module's staff routes (AUTO_PARTS businesses only).
 *
 * Every route: signed in, scoped to one business (withBusiness), and only for an AUTO_PARTS business (partsOnly). Then a permission, per person from the role and
 * any overrides, then the plan feature. Writes also need an active subscription. Stock-changing and money-moving POSTs accept an Idempotency-Key.
 *
 * Permissions:  parts_catalog (parts, numbers, vehicles, fitment)  warehouse (racks, bins, put-away, bin moves)  grn (receiving)  stock_approve (adjustments,
 *               count differences, transfers)  stock_count  returns_process  price_change  valuation  warehouse_settings.  Owners hold all of them.
 *               Everyone who sells or stocks can READ the catalogue (billing, inventory, ...).
 */
import { Router } from 'express';
import { requireAnyPermission, requireAuth, requirePermission, requirePlanFeature, withBusiness } from '../middleware/auth.js';
import { bulkLimiter, importLimiter } from '../middleware/limits.js';
import { idempotent } from '../middleware/idempotency.js';
import { partsOnly } from '../modules/autoparts/common.js';
import catalog from '../controllers/autopartsCatalog.controller.js';
import wh from '../controllers/autopartsWarehouse.controller.js';
import recv from '../controllers/autopartsReceiving.controller.js';
import sell from '../controllers/autopartsSales.controller.js';
import rets from '../controllers/autopartsReturns.controller.js';
import rep from '../controllers/autopartsReports.controller.js';
import staff from '../controllers/hotelStaff.controller.js';
import jobs from '../controllers/autopartsJobcards.controller.js';

const router = Router();

const read = [requireAuth, withBusiness(), partsOnly];
const write = [requireAuth, withBusiness({ requireActive: true }), partsOnly];
const any = (...p) => requireAnyPermission(...p);
const can = (p) => requirePermission(p);
const feature = (f) => requirePlanFeature(f);
const viewer = any('billing', 'parts_catalog', 'warehouse', 'grn', 'stock_count', 'inventory', 'reports', 'valuation');
const cat = feature('ap_catalog');
const racks = feature('ap_racks');
const staffF = feature('ap_staff');
const jobF = feature('ap_jobcards');

/* -- catalogue and fitment ---------------------------------------------- */
router.get('/parts', ...read, viewer, cat, catalog.list);
router.get('/parts/lookup', ...read, viewer, cat, catalog.lookup);
router.get('/parts/duplicates', ...read, can('parts_catalog'), cat, catalog.duplicates);
router.post('/parts', ...write, can('parts_catalog'), cat, catalog.create);
router.get('/parts/:id', ...read, viewer, cat, catalog.get);
router.put('/parts/:id/profile', ...write, can('parts_catalog'), cat, catalog.saveProfile);
router.post('/parts/:id/numbers', ...write, can('parts_catalog'), cat, catalog.numberAdd);
router.delete('/parts/:id/numbers/:pn', ...write, can('parts_catalog'), cat, catalog.numberRemove);
router.get('/parts/:id/fitment/check', ...read, viewer, cat, catalog.fitCheck);
router.get('/parts/:id/alternates', ...read, viewer, cat, catalog.alternates);
router.post('/parts/:id/fitment', ...write, can('parts_catalog'), cat, catalog.fitAdd);
router.post('/parts/:id/fitment/copy', ...write, can('parts_catalog'), cat, catalog.fitCopy);
router.put('/fitment/:id', ...write, can('parts_catalog'), cat, catalog.fitSet);
router.delete('/fitment/:id', ...write, can('parts_catalog'), cat, catalog.fitRemove);

router.get('/vehicles', ...read, viewer, cat, catalog.vehicles);
router.get('/vehicles/parts', ...read, viewer, cat, catalog.byVehicle);
router.post('/vehicles/defaults', ...write, bulkLimiter, can('parts_catalog'), cat, catalog.loadDefaultVehicles);
router.post('/vehicles/makes', ...write, can('parts_catalog'), cat, catalog.makeCreate);
router.put('/vehicles/makes/:id', ...write, can('parts_catalog'), cat, catalog.makeUpdate);
router.post('/vehicles/models', ...write, can('parts_catalog'), cat, catalog.modelCreate);
router.put('/vehicles/models/:id', ...write, can('parts_catalog'), cat, catalog.modelUpdate);
router.post('/vehicles/variants', ...write, can('parts_catalog'), cat, catalog.variantCreate);
router.put('/vehicles/variants/:id', ...write, can('parts_catalog'), cat, catalog.variantUpdate);
router.post('/vehicles/import', ...write, importLimiter, can('parts_catalog'), cat, catalog.vehiclesImport);

/* -- warehouse: locations, bins, put-away -------------------------------- */
const whView = any('warehouse', 'grn', 'stock_count', 'inventory', 'billing', 'reports');
router.get('/locations', ...read, whView, racks, wh.tree);
router.get('/locations/scan', ...read, whView, racks, wh.scan);
router.post('/locations', ...write, can('warehouse'), racks, wh.create);
router.post('/locations/bulk', ...write, bulkLimiter, can('warehouse'), racks, wh.createMany);
router.get('/locations/:id', ...read, whView, racks, wh.location);
router.put('/locations/:id', ...write, can('warehouse'), racks, wh.update);
router.get('/warehouse/settings', ...read, whView, racks, wh.settings);
router.put('/warehouse/settings', ...write, can('warehouse_settings'), racks, wh.saveSettings);
router.get('/warehouse/unassigned', ...read, whView, racks, wh.unassigned);
router.get('/warehouse/tasks', ...read, whView, racks, wh.tasks);
router.get('/warehouse/reconcile', ...read, any('warehouse', 'reports', 'valuation'), racks, wh.reconcile);
router.get('/parts/:id/locations', ...read, whView, racks, wh.partLocations);
router.get('/parts/:id/pick', ...read, whView, racks, wh.pick);
router.post('/warehouse/put-away', ...write, can('warehouse'), racks, idempotent(), wh.putAway);
router.post('/warehouse/move', ...write, can('warehouse'), racks, idempotent(), wh.move);
router.put('/parts/:id/primary-bin', ...write, can('warehouse'), racks, wh.primary);

/* -- receiving (GRN) -------------------------------------------------------- */
const grnF = feature('ap_grn');
router.get('/grns', ...read, any('grn', 'purchases', 'reports', 'warehouse'), grnF, recv.list);
router.get('/grns/:id', ...read, any('grn', 'purchases', 'reports', 'warehouse'), grnF, recv.get);
router.post('/grns', ...write, can('grn'), grnF, idempotent(), recv.create);
router.post('/grns/:id/cancel', ...write, can('stock_approve'), grnF, recv.cancel);

/* -- holds, trade prices, customer terms ------------------------------------ */
const priceF = feature('ap_pricing');
router.get('/reservations', ...read, any('billing', 'inventory', 'warehouse'), cat, sell.reservations);
router.post('/reservations', ...write, any('billing', 'warehouse'), cat, idempotent(), sell.reserve);
router.post('/reservations/:id/release', ...write, any('billing', 'warehouse'), cat, sell.release);
router.get('/price-lists', ...read, any('billing', 'price_change'), priceF, sell.priceLists);
router.post('/price-lists', ...write, can('price_change'), priceF, sell.priceListSave);
router.put('/price-lists/:id', ...write, can('price_change'), priceF, sell.priceListSave);
router.put('/price-lists/:id/items/:pid', ...write, can('price_change'), priceF, sell.priceListItem);
router.get('/customers/:id/terms', ...read, any('billing', 'customers'), priceF, sell.profile);
router.put('/customers/:id/terms', ...write, can('price_change'), priceF, sell.profileSave);
router.get('/customers/:id/credit-check', ...read, can('billing'), priceF, sell.creditCheck);

/* -- returns log and supplier claims ---------------------------------------- */
router.get('/returns', ...read, any('returns_process', 'reports', 'refunds'), cat, rets.log);
router.get('/claims', ...read, any('returns_process', 'grn', 'purchases'), cat, rets.claims);
router.post('/claims', ...write, any('returns_process', 'grn'), cat, rets.claimCreate);
router.post('/claims/:id/resolve', ...write, any('returns_process', 'stock_approve'), cat, rets.claimResolve);

/* -- dashboards, reports, suggestions (read-only) ----------------------------- */
const intelF = feature('ap_intelligence');
router.get('/overview', ...read, any('reports', 'inventory', 'warehouse', 'valuation', 'grn'), cat, rep.overview);
router.get('/reports/movers', ...read, any('reports', 'inventory'), intelF, rep.movers);
router.get('/reports/ageing', ...read, any('reports', 'valuation'), intelF, rep.ageing);
router.get('/reports/reorder', ...read, any('reports', 'purchases', 'inventory'), intelF, rep.reorder);
router.get('/reports/suppliers', ...read, any('reports', 'purchases'), intelF, rep.suppliers);
router.get('/reports/valuation', ...read, can('valuation'), intelF, rep.valuation);
router.get('/reports/occupancy', ...read, any('reports', 'warehouse'), racks, rep.occupancy);
router.get('/parts/:id/together', ...read, viewer, intelF, rep.together);
router.get('/parts/:id/ledger', ...read, any('reports', 'inventory', 'warehouse', 'valuation'), cat, rep.ledger);

/* -- workshop job cards: a vehicle in for service, its parts and labour, one bill. The counter ('billing') runs them; billing a card is billing. ------------------------- */
router.get('/jobcards', ...read, can('billing'), jobF, jobs.list);
router.get('/jobcards/due', ...read, can('billing'), jobF, jobs.due);
router.get('/jobcards/mechanics', ...read, can('billing'), jobF, jobs.mechanics);
router.get('/jobcards/report', ...read, can('billing'), jobF, jobs.report);
router.get('/jobcards/services', ...read, can('billing'), jobF, jobs.services);
router.post('/jobcards/services', ...write, can('billing'), jobF, jobs.saveService);
router.delete('/jobcards/services/:id', ...write, can('billing'), jobF, jobs.removeService);
router.post('/jobcards', ...write, can('billing'), jobF, jobs.create);
router.get('/jobcards/:id', ...read, can('billing'), jobF, jobs.get);
router.get('/jobcards/:id/share', ...read, can('billing'), jobF, jobs.share);
router.put('/jobcards/:id', ...write, can('billing'), jobF, jobs.update);
router.post('/jobcards/:id/status', ...write, can('billing'), jobF, jobs.status);
router.post('/jobcards/:id/lines', ...write, can('billing'), jobF, jobs.lineAdd);
router.put('/jobcards/lines/:id', ...write, can('billing'), jobF, jobs.lineUpdate);
router.delete('/jobcards/lines/:id', ...write, can('billing'), jobF, jobs.lineRemove);
router.post('/jobcards/:id/bill', ...write, can('billing'), jobF, idempotent(), jobs.bill);

/* -- staff and payroll: the same engine a hotel uses (controllers/hotelStaff.controller.js), without the housekeeping routes. 'hr' covers records, roster, attendance and
      leave; 'payroll' covers pay. A mechanic is an employee here, and a job card can name one. ------------------------------ */
const hrAny = any('hr', 'payroll');
router.get('/staff/headcount', ...read, hrAny, staffF, staff.headcount);
router.get('/staff/departments', ...read, hrAny, staffF, staff.departments);
router.post('/staff/departments', ...write, can('hr'), staffF, staff.saveDepartment);
router.put('/staff/departments/:id', ...write, can('hr'), staffF, staff.saveDepartment);
router.delete('/staff/departments/:id', ...write, can('hr'), staffF, staff.archiveDepartment);
router.get('/staff/shifts', ...read, hrAny, staffF, staff.shifts);
router.post('/staff/shifts', ...write, can('hr'), staffF, staff.saveShift);
router.put('/staff/shifts/:id', ...write, can('hr'), staffF, staff.saveShift);
router.delete('/staff/shifts/:id', ...write, can('hr'), staffF, staff.archiveShift);
router.get('/staff/employees', ...read, hrAny, staffF, staff.listEmployees);
router.get('/staff/employees/:id', ...read, hrAny, staffF, staff.getEmployee);
router.post('/staff/employees', ...write, can('hr'), staffF, staff.saveEmployee);
router.put('/staff/employees/:id', ...write, can('hr'), staffF, staff.saveEmployee);
router.get('/staff/roster', ...read, hrAny, staffF, staff.roster);
router.put('/staff/roster', ...write, can('hr'), staffF, staff.setRoster);
router.post('/staff/roster/copy-week', ...write, can('hr'), staffF, staff.copyWeek);
router.get('/staff/attendance', ...read, hrAny, staffF, staff.attendanceDay);
router.put('/staff/attendance', ...write, can('hr'), staffF, staff.markAttendance);
router.get('/staff/attendance/month', ...read, hrAny, staffF, staff.attendanceMonth);
router.get('/staff/leaves', ...read, hrAny, staffF, staff.leaves);
router.post('/staff/leaves', ...write, can('hr'), staffF, staff.requestLeave);
router.post('/staff/leaves/:id/decide', ...write, can('hr'), staffF, staff.decideLeave);
router.get('/staff/payroll', ...read, can('payroll'), staffF, staff.runs);
router.get('/staff/payroll/:month', ...read, can('payroll'), staffF, staff.getRun);
router.post('/staff/payroll', ...write, can('payroll'), staffF, staff.generate);
router.put('/staff/payslips/:id', ...write, can('payroll'), staffF, staff.adjustSlip);
router.post('/staff/payroll/finalize', ...write, can('payroll'), staffF, staff.finalize);

export default router;
