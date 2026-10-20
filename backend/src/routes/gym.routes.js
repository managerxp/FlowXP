/*
 * /api/gym/* — the gym module's staff routes (GYM businesses only).
 *
 * Every route: signed in, scoped to one business (withBusiness), and only for a GYM business (gymOnly). Then a permission, per person from the
 * role and any overrides, and, where the feature is separately priced, a plan feature. Writes also need an active subscription.
 * Money-moving POSTs accept an Idempotency-Key.
 *
 * Permissions:  gym_desk (scan, check in, sell and renew)  gym_members (register and edit)  gym_setup (plans, settings, devices, corrections)
 *               gym_trainer (restricted health notes, classes).  Owners hold all of them.
 */
import { Router } from 'express';
import { requireAnyPermission, requireAuth, requireOutlet, requirePermission, requirePlanFeature, withBusiness } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import { uploadProductImage } from '../middleware/upload.js';
import { gymOnly } from '../modules/gym/common.js';
import setup from '../controllers/gymSetup.controller.js';
import members from '../controllers/gymMembers.controller.js';
import access from '../controllers/gymAccess.controller.js';
import reports from '../controllers/gymReports.controller.js';
import rewardsApi from '../controllers/gymRewards.controller.js';
import deviceApi from '../controllers/gymDevices.controller.js';
import trainingApi from '../controllers/gymTraining.controller.js';

const router = Router();

const read = [requireAuth, withBusiness(), gymOnly];
const write = [requireAuth, withBusiness({ requireActive: true }), gymOnly];
const any = (...p) => requireAnyPermission(...p);
const can = (p) => requirePermission(p);
const feature = (f) => requirePlanFeature(f);
const staff = any('gym_desk', 'gym_members', 'gym_setup', 'gym_trainer');
const desk = any('gym_desk', 'gym_setup');

/* ── set-up ───────────────────────────────────────────────────────────────── */
router.get('/settings', ...read, staff, setup.get);
router.put('/settings', ...write, can('gym_setup'), setup.update);
router.put('/branches/:id/settings', ...write, can('gym_setup'), setup.updateBranch);
router.post('/branches/:id/checkin-qr/rotate', ...write, can('gym_setup'), setup.rotateCheckinToken);

router.get('/plans', ...read, staff, setup.plans);
router.post('/plans', ...write, can('gym_setup'), setup.planCreate);
router.put('/plans/:id', ...write, can('gym_setup'), setup.planUpdate);
router.post('/plans/:id/archive', ...write, can('gym_setup'), setup.planArchive);
router.post('/plans/:id/restore', ...write, can('gym_setup'), setup.planRestore);

/* ── members ──────────────────────────────────────────────────────────────── */
router.get('/members', ...read, staff, members.list);
router.get('/members/duplicates', ...read, any('gym_members', 'gym_desk', 'gym_setup'), members.duplicates);
router.get('/members/export', ...read, can('export'), members.exportCsv);
router.post('/members/import', ...write, can('gym_setup'), members.importCheck);
router.post('/members/merge', ...write, can('gym_setup'), members.merge);
router.post('/members', ...write, any('gym_members', 'gym_setup'), requireOutlet, members.create);
router.get('/members/:id', ...read, staff, members.get);
router.put('/members/:id', ...write, any('gym_members', 'gym_setup'), members.update);
router.post('/members/:id/status', ...write, any('gym_members', 'gym_setup'), members.status);
router.post('/members/:id/photo', ...write, any('gym_members', 'gym_setup'), uploadProductImage, members.photo);

/* ── memberships ──────────────────────────────────────────────────────────── */
router.post('/members/:id/memberships', ...write, desk, requireOutlet, idempotent(), members.sell);
router.post('/memberships/:id/renew', ...write, desk, requireOutlet, idempotent(), members.renew);
router.post('/memberships/:id/change-plan', ...write, desk, requireOutlet, idempotent(), members.changePlan);
router.post('/memberships/:id/freeze', ...write, desk, members.freeze);
router.post('/memberships/:id/unfreeze', ...write, desk, members.unfreeze);
router.post('/memberships/:id/extend', ...write, can('gym_setup'), members.extend);
router.post('/memberships/:id/cancel', ...write, can('gym_setup'), members.cancel);
router.post('/memberships/:id/transfer', ...write, can('gym_setup'), members.transfer);
router.get('/memberships/:id/history', ...read, staff, members.history);

/* ── credentials: printed cards (phone passes are the member's own, from the member page) ── */
router.post('/members/:id/cards', ...write, desk, feature('gym_access'), members.issueCard);
router.post('/members/:id/revoke-access', ...write, desk, feature('gym_access'), members.revokeAccess);
router.post('/credentials/:id/revoke', ...write, desk, feature('gym_access'), members.revokeCredential);

/* ── access and attendance ────────────────────────────────────────────────── */
router.post('/access/scan', ...write, can('gym_desk'), feature('gym_access'), requireOutlet, access.scan);
router.post('/access/manual', ...write, can('gym_desk'), feature('gym_access'), requireOutlet, access.manual);
router.get('/access/daily-code', ...read, can('gym_desk'), feature('gym_self_checkin'), requireOutlet, access.dailyCode);
router.get('/access/events', ...read, desk, feature('gym_access'), access.events);
router.get('/attendance', ...read, any('gym_desk', 'gym_setup', 'gym_trainer'), feature('gym_access'), access.attendance);
router.post('/attendance', ...write, can('gym_setup'), feature('gym_access'), requireOutlet, access.addVisit);
router.post('/attendance/:id/correct', ...write, can('gym_setup'), feature('gym_access'), access.correct);

/* ── rewards, referrals and reminders ─────────────────────────────────────── */
const rw = feature('gym_rewards');
router.get('/rewards/rules', ...read, staff, rw, rewardsApi.getRules);
router.put('/rewards/rules', ...write, can('gym_setup'), rw, rewardsApi.putRules);
router.get('/rewards', ...read, staff, rw, rewardsApi.catalogue);
router.post('/rewards', ...write, can('gym_setup'), rw, rewardsApi.rewardCreate);
router.put('/rewards/:id', ...write, can('gym_setup'), rw, rewardsApi.rewardUpdate);
router.post('/rewards/:id/archive', ...write, can('gym_setup'), rw, rewardsApi.rewardArchive);
router.post('/rewards/:id/restore', ...write, can('gym_setup'), rw, rewardsApi.rewardRestore);
router.get('/members/:id/points', ...read, staff, rw, rewardsApi.memberPoints);
router.post('/members/:id/points/adjust', ...write, can('gym_setup'), rw, rewardsApi.adjust);
router.post('/members/:id/redeem', ...write, desk, rw, idempotent(), rewardsApi.redeem);
router.post('/members/:id/rewards-exclusion', ...write, can('gym_setup'), rw, rewardsApi.exclude);
router.get('/redemptions', ...read, desk, rw, rewardsApi.redemptions);
router.post('/redemptions/:id/fulfil', ...write, desk, rw, rewardsApi.fulfil);
router.post('/redemptions/:id/cancel', ...write, can('gym_setup'), rw, rewardsApi.cancelRedemption);
router.get('/reports/rewards', ...read, any('reports', 'gym_setup'), rw, rewardsApi.liability);
router.get('/automations', ...read, can('gym_setup'), rewardsApi.automations);
router.put('/automations/:key', ...write, can('gym_setup'), rewardsApi.putAutomation);

/* ── gate and reader devices (a manager's side; the devices call /api/device/v1) ── */
const dv = feature('gym_devices');
router.get('/devices', ...read, can('gym_setup'), dv, deviceApi.list);
router.post('/devices', ...write, can('gym_setup'), dv, deviceApi.register);
router.put('/devices/:id', ...write, can('gym_setup'), dv, deviceApi.update);
router.post('/devices/:id/rotate-secret', ...write, can('gym_setup'), dv, deviceApi.rotate);
router.post('/devices/:id/disable', ...write, can('gym_setup'), dv, deviceApi.disable);
router.post('/devices/:id/enable', ...write, can('gym_setup'), dv, deviceApi.enable);
router.get('/devices/problems', ...read, can('gym_setup'), dv, deviceApi.problems);

/* ── trainers, classes, packs, workouts ───────────────────────────────────── */
const cls = feature('gym_classes');
const trainerOrManager = any('gym_trainer', 'gym_setup');
router.get('/trainers', ...read, staff, cls, trainingApi.trainers);
router.post('/trainers', ...write, can('gym_setup'), cls, trainingApi.trainerSave);
router.put('/trainers/:id', ...write, can('gym_setup'), cls, trainingApi.trainerSave);
router.post('/members/:id/trainer', ...write, can('gym_setup'), cls, trainingApi.assign);
router.get('/class-types', ...read, staff, cls, trainingApi.classTypes);
router.post('/class-types', ...write, can('gym_setup'), cls, trainingApi.classTypeSave);
router.put('/class-types/:id', ...write, can('gym_setup'), cls, trainingApi.classTypeSave);
router.get('/classes', ...read, staff, cls, trainingApi.sessions);
router.post('/classes', ...write, can('gym_setup'), cls, requireOutlet, trainingApi.sessionCreate);
router.post('/classes/:id/cancel', ...write, can('gym_setup'), cls, trainingApi.sessionCancel);
router.get('/classes/:id/bookings', ...read, staff, cls, trainingApi.bookings);
router.post('/classes/:id/book', ...write, desk, cls, idempotent(), trainingApi.book);
router.post('/bookings/:id/cancel', ...write, desk, cls, trainingApi.cancelBooking);
router.post('/bookings/:id/attendance', ...write, any('gym_desk', 'gym_trainer', 'gym_setup'), cls, trainingApi.attend);
router.get('/members/:id/packs', ...read, staff, cls, trainingApi.packs);
router.post('/members/:id/packs', ...write, desk, cls, requireOutlet, idempotent(), trainingApi.sellPack);
router.get('/pt', ...read, any('gym_desk', 'gym_trainer', 'gym_setup'), cls, trainingApi.ptList);
router.post('/pt', ...write, desk, cls, requireOutlet, idempotent(), trainingApi.ptBook);
router.post('/pt/:id/cancel', ...write, desk, cls, trainingApi.ptCancel);
router.post('/pt/:id/finish', ...write, any('gym_desk', 'gym_trainer', 'gym_setup'), cls, trainingApi.ptFinish);
router.get('/reports/trainers', ...read, any('reports', 'gym_setup'), cls, trainingApi.trainerReport);
router.get('/exercises', ...read, trainerOrManager, cls, trainingApi.exercises);
router.post('/exercises', ...write, trainerOrManager, cls, trainingApi.exerciseSave);
router.put('/exercises/:id', ...write, trainerOrManager, cls, trainingApi.exerciseSave);
router.get('/workout-templates', ...read, trainerOrManager, cls, trainingApi.templates);
router.post('/workout-templates', ...write, trainerOrManager, cls, trainingApi.templateCreate);
router.get('/members/:id/workouts', ...read, trainerOrManager, cls, trainingApi.memberWorkouts);
router.post('/members/:id/workouts', ...write, trainerOrManager, cls, trainingApi.workoutCreate);
router.put('/workouts/:id', ...write, trainerOrManager, cls, trainingApi.workoutUpdate);
router.get('/members/:id/progress', ...read, trainerOrManager, cls, trainingApi.progress);
router.post('/members/:id/goals', ...write, trainerOrManager, cls, trainingApi.goalAdd);
router.post('/members/:id/goals/:goalId', ...write, trainerOrManager, cls, trainingApi.goalStatus);
router.post('/members/:id/measurements', ...write, trainerOrManager, cls, trainingApi.measurementAdd);

/* ── dashboard and reports ────────────────────────────────────────────────── */
router.get('/dashboard', ...read, staff, reports.dashboard);
router.get('/reports/attendance', ...read, any('reports', 'gym_setup'), reports.attendance);
router.get('/reports/memberships', ...read, any('reports', 'gym_setup'), reports.memberships);

export default router;
