/*
 * /api/payroll/* — the Payroll add-on, for every kind of business. Signed in, scoped to one business, the "payroll" plan feature (the add-on, or the Enterprise plan), then
 * a permission: 'hr' for the people, roster, attendance and leave (same engine as the staff screens), 'payroll' for pay. Writes need an active subscription.
 */
import { Router } from 'express';
import { requireAnyPermission, requireAuth, requirePermission, requirePlanFeature, withBusiness } from '../middleware/auth.js';
import staff from '../controllers/hr.controller.js';
import payroll from '../controllers/payroll.controller.js';

const router = Router();
const read = [requireAuth, withBusiness(), requirePlanFeature('payroll')];
const write = [requireAuth, withBusiness({ requireActive: true }), requirePlanFeature('payroll')];
const can = (p) => requirePermission(p);
const hrAny = requireAnyPermission('hr', 'payroll');

/* people, roster, attendance and leave: the staff engine */
router.get('/staff/headcount', ...read, hrAny, staff.headcount);
router.get('/staff/departments', ...read, hrAny, staff.departments);
router.post('/staff/departments', ...write, can('hr'), staff.saveDepartment);
router.put('/staff/departments/:id', ...write, can('hr'), staff.saveDepartment);
router.delete('/staff/departments/:id', ...write, can('hr'), staff.archiveDepartment);
router.get('/staff/shifts', ...read, hrAny, staff.shifts);
router.post('/staff/shifts', ...write, can('hr'), staff.saveShift);
router.put('/staff/shifts/:id', ...write, can('hr'), staff.saveShift);
router.delete('/staff/shifts/:id', ...write, can('hr'), staff.archiveShift);
router.get('/staff/employees', ...read, hrAny, staff.listEmployees);
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

/* pay: settings, profiles, loans, the run, the files */
router.get('/settings', ...read, can('payroll'), payroll.settings);
router.put('/settings', ...write, can('payroll'), payroll.saveSettings);
router.get('/profiles', ...read, can('payroll'), payroll.profiles);
router.put('/profiles/:id', ...write, can('payroll'), payroll.saveProfile);
router.get('/loans', ...read, can('payroll'), payroll.loans);
router.post('/loans', ...write, can('payroll'), payroll.addLoan);
router.post('/loans/:id/close', ...write, can('payroll'), payroll.closeLoan);
router.get('/runs/:month', ...read, can('payroll'), payroll.getRun);
router.post('/runs', ...write, can('payroll'), payroll.generate);
router.put('/payslips/:id', ...write, can('payroll'), payroll.adjustSlip);
router.post('/runs/finalize', ...write, can('payroll'), payroll.finalize);
router.post('/runs/paid', ...write, can('payroll'), payroll.markPaid);
router.post('/runs/dues', ...write, can('payroll'), payroll.payDues);
router.get('/runs/:month/file/:kind', ...read, can('payroll'), payroll.file);

export default router;
