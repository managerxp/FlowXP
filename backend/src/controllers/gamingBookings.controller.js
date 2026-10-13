/*
 * Station bookings and tournaments. Permissions and plan features are decided in the router (gaming.routes.js).
 */
import pool from '../config/database.js';
import { audit, inTx, int, ok, wrapAll } from '../modules/gaming/common.js';
import * as bookings from '../modules/gaming/bookings.js';
import * as tournaments from '../modules/gaming/tournaments.js';

const id = (req, label = 'Id') => int(req.params.id, label, { min: 1, required: true });
const uid = (req) => req.auth?.userId ?? req.tenant?.userId ?? null;
const now = () => new Date();

export default wrapAll({
  bookings: async (req, res) => ok(res, await bookings.listBookings(pool, req.tenant, req.query)),
  bookingCreate: async (req, res) => {
    const b = await inTx((db) => bookings.createBooking(db, req.tenant, uid(req), req.body || {}, { now: now() }));
    audit(req, 'gaming.booking_created', 'gaming_booking', b.booking_id, null, { station_id: b.station_id, starts_at: b.starts_at });
    ok(res, b, 201);
  },
  bookingUpdate: async (req, res) => ok(res, await inTx((db) => bookings.updateBooking(db, req.tenant, uid(req), id(req), req.body || {}, { now: now() }))),
  bookingCancel: async (req, res) => {
    const b = await inTx((db) => bookings.cancelBooking(db, req.tenant, uid(req), id(req)));
    audit(req, 'gaming.booking_cancelled', 'gaming_booking', b.booking_id, null, null);
    ok(res, b);
  },
  bookingNoShow: async (req, res) => {
    const b = await inTx((db) => bookings.markNoShow(db, req.tenant, uid(req), id(req), { now: now() }));
    audit(req, 'gaming.booking_noshow', 'gaming_booking', b.booking_id, null, null);
    ok(res, b);
  },
  bookingSeat: async (req, res) => {
    const out = await inTx((db) => bookings.seatBooking(db, req.tenant, uid(req), id(req), req.body || {}, { now: now() }));
    audit(req, 'gaming.booking_seated', 'gaming_booking', out.booking.booking_id, null, { session_id: out.session.session_id });
    ok(res, out, 201);
  },

  tournaments: async (req, res) => ok(res, await tournaments.listTournaments(pool, req.tenant, { status: req.query.status })),
  tournamentGet: async (req, res) => ok(res, await tournaments.getTournament(pool, req.tenant, id(req))),
  tournamentCreate: async (req, res) => {
    const t = await inTx((db) => tournaments.createTournament(db, req.tenant, uid(req), req.body || {}));
    audit(req, 'gaming.tournament_created', 'gaming_tournament', t.tournament_id, null, { name: t.name });
    ok(res, t, 201);
  },
  tournamentUpdate: async (req, res) => ok(res, await inTx((db) => tournaments.updateTournament(db, req.tenant, id(req), req.body || {}))),
  entryCreate: async (req, res) => {
    const out = await inTx((db) => tournaments.register(db, req.tenant, uid(req), id(req), req.body || {}));
    audit(req, 'gaming.tournament_entry', 'gaming_tournament', req.params.id, null, { entry_id: out.entry.entry_id, paid: Boolean(out.invoice) });
    ok(res, out, 201);
  },
  entryPay: async (req, res) => ok(res, await inTx((db) => tournaments.payEntry(db, req.tenant, uid(req), id(req), req.body || {})), 201),
  entryCheckIn: async (req, res) => ok(res, await inTx((db) => tournaments.checkIn(db, req.tenant, id(req)))),
  entryWithdraw: async (req, res) => ok(res, await inTx((db) => tournaments.withdraw(db, req.tenant, id(req)))),
  results: async (req, res) => {
    const t = await inTx((db) => tournaments.recordResults(db, req.tenant, id(req), req.body?.results));
    audit(req, 'gaming.tournament_results', 'gaming_tournament', t.tournament_id, null, { winners: (req.body?.results || []).length });
    ok(res, t);
  }
});
