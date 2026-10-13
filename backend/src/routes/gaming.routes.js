/*
 * /api/gaming/* — the gaming lounge module's staff routes (GAMING_CAFE businesses only).
 *
 * Every route: signed in, scoped to one business (withBusiness), and only for a GAMING_CAFE business (gamingOnly). Then a permission, per person
 * from the role and any overrides, and the plan feature. Writes also need an active subscription. Starting and stopping a session accept an
 * Idempotency-Key.
 *
 * Permissions:  gaming_desk (the board, sessions, top-ups, bookings)  gaming_setup (stations, rates, offers, settings, corrections).
 *               Owners, admins and managers hold both. Food and drink on a station's tab use the ordinary orders and billing permissions.
 */
import { Router } from 'express';
import { requireAnyPermission, requireAuth, requirePermission, requirePlanFeature, withBusiness } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import { gamingOnly } from '../modules/gaming/common.js';
import setup from '../controllers/gamingSetup.controller.js';
import sessions from '../controllers/gamingSessions.controller.js';
import playersApi from '../controllers/gamingPlayers.controller.js';
import walletApi from '../controllers/gamingWallet.controller.js';
import bookingApi from '../controllers/gamingBookings.controller.js';
import reportApi from '../controllers/gamingReports.controller.js';
import '../modules/gaming/alerts.js';   // registers the timer alerts with the worker

const router = Router();

const read = [requireAuth, withBusiness(), gamingOnly];
const write = [requireAuth, withBusiness({ requireActive: true }), gamingOnly];
const any = (...p) => requireAnyPermission(...p);
const can = (p) => requirePermission(p);
const feature = (f) => requirePlanFeature(f);
const staff = any('gaming_desk', 'gaming_setup');
const core = feature('gaming_stations');

/* ── set-up ───────────────────────────────────────────────────────────────── */
router.get('/settings', ...read, staff, core, setup.settings);
router.put('/settings', ...write, can('gaming_setup'), core, setup.updateSettings);

router.get('/zones', ...read, staff, core, setup.zones);
router.post('/zones', ...write, can('gaming_setup'), core, setup.zoneCreate);
router.put('/zones/:id', ...write, can('gaming_setup'), core, setup.zoneUpdate);
router.delete('/zones/:id', ...write, can('gaming_setup'), core, setup.zoneDelete);

router.get('/stations', ...read, staff, core, setup.stations);
router.post('/stations', ...write, can('gaming_setup'), core, setup.stationCreate);
router.put('/stations/:id', ...write, can('gaming_setup'), core, setup.stationUpdate);
router.post('/stations/:id/status', ...write, can('gaming_setup'), core, setup.stationStatus);
router.post('/stations/:id/archive', ...write, can('gaming_setup'), core, setup.stationArchive);

router.get('/rates', ...read, staff, core, setup.rates);
router.post('/rates', ...write, can('gaming_setup'), core, setup.rateCreate);
router.put('/rates/:id', ...write, can('gaming_setup'), core, setup.rateUpdate);
router.delete('/rates/:id', ...write, can('gaming_setup'), core, setup.rateDelete);

router.get('/bundles', ...read, staff, core, setup.bundles);
router.post('/bundles', ...write, can('gaming_setup'), core, setup.bundleCreate);
router.put('/bundles/:id', ...write, can('gaming_setup'), core, setup.bundleUpdate);
router.delete('/bundles/:id', ...write, can('gaming_setup'), core, setup.bundleDelete);

router.get('/games', ...read, staff, core, setup.games);
router.post('/games', ...write, can('gaming_setup'), core, setup.gameCreate);
router.delete('/games/:id', ...write, can('gaming_setup'), core, setup.gameDelete);

/* ── players ──────────────────────────────────────────────────────────────── */
router.get('/players', ...read, staff, core, playersApi.list);
router.post('/players', ...write, can('gaming_desk'), core, playersApi.create);
router.get('/players/:id', ...read, staff, core, playersApi.get);
router.put('/players/:id', ...write, can('gaming_desk'), core, playersApi.update);

/* ── the prepaid wallet and hour packs ────────────────────────────────────── */
const wal = feature('gaming_wallet');
router.get('/players/:id/wallet', ...read, staff, core, wal, walletApi.wallet);
router.post('/players/:id/wallet/topup', ...write, can('gaming_desk'), core, wal, idempotent(), walletApi.topup);
router.post('/players/:id/wallet/adjust', ...write, can('gaming_setup'), core, wal, walletApi.adjust);
router.get('/wallet/liability', ...read, any('gaming_setup', 'reports'), core, wal, walletApi.liability);
router.get('/players/:id/passes', ...read, staff, core, wal, walletApi.passes);
router.post('/players/:id/passes', ...write, can('gaming_desk'), core, wal, idempotent(), walletApi.passSell);
router.post('/passes/:id/cancel', ...write, can('gaming_setup'), core, wal, walletApi.passCancel);

/* ── station bookings ─────────────────────────────────────────────────────── */
const bk = feature('gaming_bookings');
router.get('/bookings', ...read, staff, core, bk, bookingApi.bookings);
router.post('/bookings', ...write, can('gaming_desk'), core, bk, bookingApi.bookingCreate);
router.put('/bookings/:id', ...write, can('gaming_desk'), core, bk, bookingApi.bookingUpdate);
router.post('/bookings/:id/cancel', ...write, can('gaming_desk'), core, bk, bookingApi.bookingCancel);
router.post('/bookings/:id/no-show', ...write, can('gaming_desk'), core, bk, bookingApi.bookingNoShow);
router.post('/bookings/:id/seat', ...write, can('gaming_desk'), core, bk, idempotent(), bookingApi.bookingSeat);

/* ── tournaments ──────────────────────────────────────────────────────────── */
const tn = feature('gaming_tournaments');
router.get('/tournaments', ...read, staff, core, tn, bookingApi.tournaments);
router.post('/tournaments', ...write, can('gaming_setup'), core, tn, bookingApi.tournamentCreate);
router.get('/tournaments/:id', ...read, staff, core, tn, bookingApi.tournamentGet);
router.put('/tournaments/:id', ...write, can('gaming_setup'), core, tn, bookingApi.tournamentUpdate);
router.post('/tournaments/:id/entries', ...write, can('gaming_desk'), core, tn, idempotent(), bookingApi.entryCreate);
router.post('/tournaments/:id/results', ...write, can('gaming_setup'), core, tn, bookingApi.results);
router.post('/entries/:id/pay', ...write, can('gaming_desk'), core, tn, idempotent(), bookingApi.entryPay);
router.post('/entries/:id/check-in', ...write, can('gaming_desk'), core, tn, bookingApi.entryCheckIn);
router.post('/entries/:id/withdraw', ...write, can('gaming_desk'), core, tn, bookingApi.entryWithdraw);

/* ── reports ──────────────────────────────────────────────────────────────── */
const rep = any('gaming_setup', 'reports');
router.get('/dashboard', ...read, rep, core, reportApi.dashboard);
router.get('/reports/summary', ...read, rep, core, reportApi.summary);
router.get('/reports/stations', ...read, rep, core, reportApi.stations);
router.get('/reports/heatmap', ...read, rep, core, reportApi.heatmap);
router.get('/reports/days', ...read, rep, core, reportApi.days);
router.get('/reports/games', ...read, rep, core, reportApi.games);

/* ── the board and sessions ───────────────────────────────────────────────── */
router.get('/board', ...read, staff, core, sessions.board);
router.get('/sessions', ...read, staff, core, sessions.list);
router.post('/sessions', ...write, can('gaming_desk'), core, idempotent(), sessions.start);
router.get('/sessions/:id', ...read, staff, core, sessions.get);
router.get('/sessions/:id/events', ...read, staff, core, sessions.events);
router.put('/sessions/:id', ...write, can('gaming_desk'), core, sessions.edit);
router.post('/sessions/:id/pause', ...write, can('gaming_desk'), core, sessions.pause);
router.post('/sessions/:id/resume', ...write, can('gaming_desk'), core, sessions.resume);
router.post('/sessions/:id/players', ...write, can('gaming_desk'), core, sessions.players);
router.post('/sessions/:id/units', ...write, can('gaming_desk'), core, sessions.units);
router.post('/sessions/:id/extend', ...write, can('gaming_desk'), core, sessions.extend);
router.post('/sessions/:id/transfer', ...write, can('gaming_desk'), core, sessions.transfer);
router.post('/sessions/:id/stop', ...write, can('gaming_desk'), core, idempotent(), sessions.stop);
router.post('/sessions/:id/reopen', ...write, can('gaming_desk'), core, sessions.reopen);

export default router;
