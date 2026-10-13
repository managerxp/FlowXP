/*
 * Players: a `customers` row plus gaming details. Most visitors are walk-ins and never become one; a wallet, a pack or a tournament entry needs one.
 * Adding a player with a mobile number that already belongs to a customer (someone billed before) makes that customer a player instead of a second record.
 */
import { SQL_PHONE_KEY, phoneKey } from '../gym/common.js';
import { GamingError, bool, like, phone, text, withRupees } from './common.js';

export const balanceOf = async (db, businessId, customerId) =>
  Number((await db.query(`SELECT COALESCE(SUM(amount_paise), 0) AS b FROM gaming_wallet_ledger WHERE business_id = $1 AND customer_id = $2`, [businessId, customerId])).rows[0].b);

const SELECT = `SELECT c.customer_id, c.name, c.phone, c.email, p.player_id, p.gamer_tag, p.is_minor, p.guardian_name, p.guardian_phone, p.notes,
  COALESCE((SELECT SUM(w.amount_paise) FROM gaming_wallet_ledger w WHERE w.business_id = c.business_id AND w.customer_id = c.customer_id), 0) AS wallet_paise
  FROM customers c LEFT JOIN gaming_players p ON p.customer_id = c.customer_id AND p.business_id = c.business_id`;

const shape = (r) => withRupees({ ...r, wallet_paise: Number(r.wallet_paise), is_minor: Boolean(r.is_minor) });

export const searchPlayers = async (db, tenant, term, { limit = 10, onlyPlayers = false } = {}) => {
  const t = String(term || '').trim();
  const params = [tenant.businessId];
  let where = `c.business_id = $1`;
  if (t) {
    params.push(like(t));
    const key = phoneKey(t);
    where += ` AND (c.name ILIKE $${params.length} OR p.gamer_tag ILIKE $${params.length}`;
    if (/\d{3,}/.test(t)) { params.push(`%${key}%`); where += ` OR ${SQL_PHONE_KEY('c.phone')} LIKE $${params.length}`; }
    where += ')';
  }
  if (onlyPlayers) where += ' AND p.player_id IS NOT NULL';
  params.push(Math.min(50, Math.max(1, limit)));
  return (await db.query(`${SELECT} WHERE ${where} ORDER BY (p.player_id IS NOT NULL) DESC, c.name LIMIT $${params.length}`, params)).rows.map(shape);
};

const fields = (b) => {
  const f = {};
  if (b.gamer_tag !== undefined) f.gamer_tag = text(b.gamer_tag, 'Gamer tag', { max: 40 });
  if (b.is_minor !== undefined) f.is_minor = bool(b.is_minor);
  if (b.guardian_name !== undefined) f.guardian_name = text(b.guardian_name, 'Guardian', { max: 60 });
  if (b.guardian_phone !== undefined) f.guardian_phone = phone(b.guardian_phone, 'Guardian phone');
  if (b.notes !== undefined) f.notes = text(b.notes, 'Notes', { max: 300 });
  return f;
};

export const createPlayer = async (db, tenant, b) => {
  const name = text(b.name, 'Name', { max: 120, required: true });
  const mobile = phone(b.phone);
  const f = fields(b);
  if (f.is_minor && !f.guardian_name) throw new GamingError(400, 'Add the name of a parent or guardian for a player under 18');
  let customerId = null;
  if (mobile && phoneKey(mobile).length >= 7) {
    customerId = (await db.query(`SELECT customer_id FROM customers WHERE business_id = $1 AND ${SQL_PHONE_KEY('phone')} = $2 ORDER BY customer_id LIMIT 1`, [tenant.businessId, phoneKey(mobile)])).rows[0]?.customer_id ?? null;
  }
  if (!customerId) customerId = (await db.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [tenant.businessId, name, mobile])).rows[0].customer_id;
  const keys = Object.keys(f);
  await db.query(
    `INSERT INTO gaming_players (business_id, customer_id${keys.length ? `, ${keys.join(', ')}` : ''}) VALUES ($1,$2${keys.map((_, i) => `,$${i + 3}`).join('')})
     ON CONFLICT (business_id, customer_id) DO UPDATE SET ${keys.length ? keys.map((k) => `${k} = EXCLUDED.${k}`).join(', ') : 'customer_id = gaming_players.customer_id'}`,
    [tenant.businessId, customerId, ...keys.map((k) => f[k])]);
  return getPlayer(db, tenant, customerId);
};

export const updatePlayer = async (db, tenant, customerId, b) => {
  const cur = await getPlayer(db, tenant, customerId);
  const f = fields(b);
  if ((f.is_minor ?? cur.is_minor) && !(f.guardian_name ?? cur.guardian_name)) throw new GamingError(400, 'Add the name of a parent or guardian for a player under 18');
  if (b.name !== undefined) await db.query(`UPDATE customers SET name = $3 WHERE customer_id = $1 AND business_id = $2`, [customerId, tenant.businessId, text(b.name, 'Name', { max: 120, required: true })]);
  const keys = Object.keys(f);
  if (keys.length) {
    await db.query(
      `INSERT INTO gaming_players (business_id, customer_id, ${keys.join(', ')}) VALUES ($1,$2,${keys.map((_, i) => `$${i + 3}`).join(',')})
       ON CONFLICT (business_id, customer_id) DO UPDATE SET ${keys.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}`, [tenant.businessId, customerId, ...keys.map((k) => f[k])]);
  }
  return getPlayer(db, tenant, customerId);
};

export const getPlayer = async (db, tenant, customerId) => {
  const r = (await db.query(`${SELECT} WHERE c.business_id = $1 AND c.customer_id = $2`, [tenant.businessId, customerId])).rows[0];
  if (!r) throw new GamingError(404, 'Not found');
  return shape(r);
};
