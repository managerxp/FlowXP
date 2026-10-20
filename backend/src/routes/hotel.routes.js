/*
 * /api/hotel/* — the hotel module's routes (HOTEL businesses only).
 *
 * Every route: signed in, scoped to one business (withBusiness), only for a HOTEL business (hotelOnly) and for one outlet (requireOutlet: an outlet
 * is one property, with its own rooms, rates, business date and night audit). Then a permission, per person from the role and any overrides.
 * Writes also require an active subscription.
 */
import { Router } from 'express';
import { requireAnyPermission, requireAuth, requireOutlet, requirePermission, withBusiness } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import { hotelOnly } from '../modules/hotel/common.js';
import setup from '../controllers/hotelSetup.controller.js';
import front from '../controllers/hotelFront.controller.js';
import reports from '../controllers/hotelReports.controller.js';
import banquet from '../controllers/hotelBanquet.controller.js';
import staff from '../controllers/hotelStaff.controller.js';

const router = Router();

const read = [requireAuth, withBusiness(), hotelOnly, requireOutlet];
const write = [requireAuth, withBusiness({ requireActive: true }), hotelOnly, requireOutlet];
const any = (...p) => requireAnyPermission(...p);
const can = (p) => requirePermission(p);
const desk = any('front_desk', 'night_audit', 'hotel_setup');
const floor = any('front_desk', 'housekeeping', 'night_audit', 'hotel_setup');

/* ── the till: charge a restaurant bill to a guest's room ── */
router.get('/room-charge/guests', ...read, any('billing', 'front_desk'), front.roomChargeGuests);

/* ── set-up ─────────────────────────────────────────────────── */
router.get('/settings', ...read, floor, setup.getSettings);
router.put('/settings', ...write, can('hotel_setup'), setup.updateSettings);
router.get('/room-types', ...read, floor, setup.listRoomTypes);
router.post('/room-types', ...write, can('hotel_setup'), setup.createRoomType);
router.put('/room-types/:id', ...write, can('hotel_setup'), setup.updateRoomType);
router.delete('/room-types/:id', ...write, can('hotel_setup'), setup.archiveRoomType);
router.get('/rooms', ...read, floor, setup.listRooms);
router.post('/rooms', ...write, can('hotel_setup'), setup.createRoom);
router.post('/rooms/bulk', ...write, can('hotel_setup'), setup.createRooms);
router.put('/rooms/:id', ...write, can('hotel_setup'), setup.updateRoom);
router.get('/rate-plans', ...read, desk, setup.listRatePlans);
router.post('/rate-plans', ...write, can('hotel_setup'), setup.saveRatePlan);
router.put('/rate-plans/:id', ...write, can('hotel_setup'), setup.saveRatePlan);
router.delete('/rate-plans/:id', ...write, can('hotel_setup'), setup.archiveRatePlan);
router.get('/seasonal-rates', ...read, desk, setup.listOverrides);
router.post('/seasonal-rates', ...write, can('hotel_setup'), setup.createOverride);
router.delete('/seasonal-rates/:id', ...write, can('hotel_setup'), setup.deleteOverride);
router.get('/room-blocks', ...read, floor, setup.listBlocks);
router.post('/room-blocks', ...write, any('front_desk', 'hotel_setup'), setup.createBlock);
router.delete('/room-blocks/:id', ...write, any('front_desk', 'hotel_setup'), setup.deleteBlock);

/* ── front desk ─────────────────────────────────────────────── */
router.get('/dashboard', ...read, floor, front.dashboard);
router.get('/availability', ...read, desk, front.availability);
router.get('/chart', ...read, floor, front.chart);
router.get('/quote', ...read, desk, front.quote);
router.get('/free-rooms', ...read, desk, front.freeRooms);
router.get('/guests', ...read, desk, front.searchGuests);
router.post('/guests', ...write, can('front_desk'), front.saveGuest);
router.put('/guests/:id', ...write, can('front_desk'), front.saveGuest);

router.get('/bookings', ...read, desk, front.listBookings);
router.post('/bookings', ...write, can('front_desk'), idempotent(), front.createBooking);
router.post('/walk-ins', ...write, can('front_desk'), idempotent(), front.walkIn);
router.get('/bookings/:id', ...read, desk, front.getBooking);
router.post('/bookings/:id/check-in', ...write, can('front_desk'), front.checkIn);
router.put('/bookings/:id/dates', ...write, can('front_desk'), front.changeDates);
router.post('/bookings/:id/move-room', ...write, can('front_desk'), front.moveRoom);
router.post('/bookings/:id/cancel', ...write, can('front_desk'), front.cancel);
router.post('/bookings/:id/no-show', ...write, can('front_desk'), front.noShow);
router.post('/bookings/:id/check-out', ...write, can('front_desk'), idempotent(), front.checkOut);

router.get('/bookings/:id/folio', ...read, desk, front.getFolio);
router.post('/bookings/:id/charges', ...write, can('front_desk'), idempotent(), front.postCharge);
router.post('/charges/:id/void', ...write, can('front_desk'), front.voidCharge);
router.post('/bookings/:id/payments', ...write, can('front_desk'), idempotent(), front.addPayment);

/* ── housekeeping ───────────────────────────────────────────── */
router.get('/rack', ...read, floor, front.rack);
router.post('/rooms/:id/status', ...write, any('housekeeping', 'front_desk'), front.setRoomStatus);

/* ── night audit ────────────────────────────────────────────── */
router.get('/night-audit', ...read, can('night_audit'), front.auditPreview);
router.post('/night-audit', ...write, can('night_audit'), front.runAudit);

/* ── banquet and events ─────────────────────────────────────── */
const bq = any('banquet', 'front_desk', 'hotel_setup');
const bqWrite = can('banquet');
router.get('/banquet/halls', ...read, bq, banquet.listHalls);
router.post('/banquet/halls', ...write, can('hotel_setup'), banquet.saveHall);
router.put('/banquet/halls/:id', ...write, can('hotel_setup'), banquet.saveHall);
router.delete('/banquet/halls/:id', ...write, can('hotel_setup'), banquet.archiveHall);
router.get('/banquet/packages', ...read, bq, banquet.listPackages);
router.post('/banquet/packages', ...write, any('banquet', 'hotel_setup'), banquet.savePackage);
router.put('/banquet/packages/:id', ...write, any('banquet', 'hotel_setup'), banquet.savePackage);
router.delete('/banquet/packages/:id', ...write, any('banquet', 'hotel_setup'), banquet.archivePackage);
router.get('/banquet/calendar', ...read, bq, banquet.calendar);
router.get('/banquet/check-hall', ...read, bq, banquet.checkHall);
router.get('/banquet/summary', ...read, any('banquet', 'reports'), banquet.summary);
router.get('/banquet/events', ...read, bq, banquet.listEvents);
router.post('/banquet/events', ...write, bqWrite, banquet.createEvent);
router.get('/banquet/events/:id', ...read, bq, banquet.getEvent);
router.put('/banquet/events/:id', ...write, bqWrite, banquet.updateEvent);
router.post('/banquet/events/:id/status', ...write, bqWrite, banquet.setStatus);
router.post('/banquet/events/:id/cancel', ...write, bqWrite, banquet.cancelEvent);
router.post('/banquet/events/:id/functions', ...write, bqWrite, banquet.addFunction);
router.put('/banquet/functions/:id', ...write, bqWrite, banquet.updateFunction);
router.delete('/banquet/functions/:id', ...write, bqWrite, banquet.removeFunction);
router.post('/banquet/events/:id/charges', ...write, bqWrite, banquet.postCharge);
router.post('/banquet/charges/:id/void', ...write, bqWrite, banquet.voidCharge);
router.post('/banquet/events/:id/payments', ...write, bqWrite, banquet.addPayment);
router.get('/banquet/events/:id/proforma', ...read, bq, banquet.proforma);
router.post('/banquet/events/:id/complete', ...write, bqWrite, banquet.complete);

/* ── staff ──────────────────────────────────────────────────── */
const hrAny = any('hr', 'payroll');
router.get('/staff/headcount', ...read, hrAny, staff.headcount);
router.get('/staff/departments', ...read, any('hr', 'payroll', 'hotel_setup'), staff.departments);
router.post('/staff/departments', ...write, can('hr'), staff.saveDepartment);
router.put('/staff/departments/:id', ...write, can('hr'), staff.saveDepartment);
router.delete('/staff/departments/:id', ...write, can('hr'), staff.archiveDepartment);
router.get('/staff/shifts', ...read, hrAny, staff.shifts);
router.post('/staff/shifts', ...write, can('hr'), staff.saveShift);
router.put('/staff/shifts/:id', ...write, can('hr'), staff.saveShift);
router.delete('/staff/shifts/:id', ...write, can('hr'), staff.archiveShift);
router.get('/staff/employees', ...read, any('hr', 'payroll', 'housekeeping'), staff.listEmployees);
router.get('/staff/employees/:id', ...read, hrAny, staff.getEmployee);
router.post('/staff/employees', ...write, can('hr'), staff.saveEmployee);
router.put('/staff/employees/:id', ...write, can('hr'), staff.saveEmployee);
router.get('/staff/roster', ...read, hrAny, staff.roster);
router.put('/staff/roster', ...write, can('hr'), staff.setRoster);
router.post('/staff/roster/copy-week', ...write, can('hr'), staff.copyWeek);
router.get('/staff/attendance', ...read, hrAny, staff.attendanceDay);
router.put('/staff/attendance', ...write, can('hr'), staff.markAttendance);
router.get('/staff/attendance/month', ...read, hrAny, staff.attendanceMonth);
router.get('/staff/leaves', ...read, hrAny, staff.leaves);
router.post('/staff/leaves', ...write, can('hr'), staff.requestLeave);
router.post('/staff/leaves/:id/decide', ...write, can('hr'), staff.decideLeave);
router.get('/staff/payroll', ...read, can('payroll'), staff.runs);
router.get('/staff/payroll/:month', ...read, can('payroll'), staff.getRun);
router.post('/staff/payroll', ...write, can('payroll'), staff.generate);
router.put('/staff/payslips/:id', ...write, can('payroll'), staff.adjustSlip);
router.post('/staff/payroll/finalize', ...write, can('payroll'), staff.finalize);
router.get('/staff/housekeepers', ...read, any('hr', 'housekeeping', 'front_desk'), staff.housekeepers);
router.get('/staff/assignments', ...read, any('hr', 'housekeeping', 'front_desk'), staff.assignments);
router.post('/staff/assignments', ...write, any('hr', 'housekeeping', 'front_desk'), staff.assign);

/* ── reports ────────────────────────────────────────────────── */
const rep = any('reports', 'night_audit');
const lists = any('reports', 'night_audit', 'front_desk');
router.get('/reports/flash', ...read, rep, reports.flash);
router.get('/reports/occupancy', ...read, rep, reports.occupancy);
router.get('/reports/departments', ...read, rep, reports.departments);
router.get('/reports/collections', ...read, rep, reports.collections);
router.get('/reports/lost', ...read, rep, reports.lost);
router.get('/reports/sources', ...read, rep, reports.sources);
router.get('/reports/forecast', ...read, rep, reports.forecast);
router.get('/reports/arrivals', ...read, lists, reports.arrivals);
router.get('/reports/departures', ...read, lists, reports.departures);
router.get('/reports/in-house', ...read, lists, reports.inHouse);
router.get('/reports/high-balance', ...read, lists, reports.highBalance);

export default router;
