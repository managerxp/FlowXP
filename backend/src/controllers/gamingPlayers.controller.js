/*
 * Gaming players: find one by name, mobile or gamer tag, add one, see one with their recent sessions. Permissions are decided in the router.
 */
import pool from '../config/database.js';
import { audit, inTx, int, ok, wrapAll } from '../modules/gaming/common.js';
import * as players from '../modules/gaming/players.js';
import { listSessions } from '../modules/gaming/sessions.js';

const id = (req) => int(req.params.id, 'Player', { min: 1, required: true });

export default wrapAll({
  list: async (req, res) => ok(res, await players.searchPlayers(pool, req.tenant, req.query.search, { limit: Number(req.query.limit) || 10, onlyPlayers: req.query.only === 'players' })),
  create: async (req, res) => {
    const p = await inTx((db) => players.createPlayer(db, req.tenant, req.body || {}));
    audit(req, 'gaming.player_added', 'customer', p.customer_id, null, { name: p.name });
    ok(res, p, 201);
  },
  get: async (req, res) => {
    const p = await players.getPlayer(pool, req.tenant, id(req));
    const { rows } = await listSessions(pool, req.tenant, { customer_id: p.customer_id }, { limit: 10, offset: 0 });
    ok(res, { ...p, recent_sessions: rows });
  },
  update: async (req, res) => {
    const p = await inTx((db) => players.updatePlayer(db, req.tenant, id(req), req.body || {}));
    audit(req, 'gaming.player_updated', 'customer', p.customer_id, null, req.body || {});
    ok(res, p);
  }
});
