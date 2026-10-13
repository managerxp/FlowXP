/*
 * Tournaments: a FIFA or pool night with an entry fee and a prize pool. Light by design: entries, check-in, results and prizes. There is no bracket.
 *
 * MONEY. An entry fee is an ordinary GST invoice with one line, paid at registration (or later); the invoice is linked to the entry. A withdrawn entry is refunded
 * by credit note on that invoice, like any bill. Prizes are a record of what was won: this module does not move prize money.
 *
 * CAPACITY is checked under a lock on the tournament, so the last place cannot be taken twice.
 */
import { createInvoiceInTransaction } from '../billing.js';
import { GamingError, ensureProduct, getSettings, int, localDate, money, oneOf, phone, text, withRupees } from './common.js';

export const STATUSES = ['PLANNED', 'OPEN', 'RUNNING', 'DONE', 'CANCELLED'];

const shape = (t) => withRupees({
  tournament_id: t.tournament_id, name: t.name, game_name: t.game_name, starts_at: t.starts_at, entry_fee_paise: Number(t.entry_fee_paise), prize_pool_paise: Number(t.prize_pool_paise),
  max_players: t.max_players, status: t.status, notes: t.notes,
  entries: t.entries == null ? undefined : Number(t.entries), paid: t.paid == null ? undefined : Number(t.paid), checked_in: t.checked_in == null ? undefined : Number(t.checked_in)
});

const COUNTS = `(SELECT COUNT(*) FROM gaming_tournament_entries e WHERE e.tournament_id = t.tournament_id AND e.status <> 'WITHDRAWN') AS entries,
  (SELECT COUNT(*) FROM gaming_tournament_entries e WHERE e.tournament_id = t.tournament_id AND e.status <> 'WITHDRAWN' AND e.invoice_id IS NOT NULL) AS paid,
  (SELECT COUNT(*) FROM gaming_tournament_entries e WHERE e.tournament_id = t.tournament_id AND e.status = 'CHECKED_IN') AS checked_in`;

export const listTournaments = async (db, tenant, { status = null } = {}) => {
  const params = [tenant.businessId];
  let where = 't.business_id = $1';
  if (tenant.scopeBranchId != null) { params.push(tenant.scopeBranchId); where += ` AND t.branch_id = $${params.length}`; }
  if (status) { params.push(String(status).toUpperCase()); where += ` AND t.status = $${params.length}`; }
  return (await db.query(`SELECT t.*, ${COUNTS} FROM gaming_tournaments t WHERE ${where} ORDER BY t.starts_at DESC, t.tournament_id DESC LIMIT 200`, params)).rows.map(shape);
};

const load = async (db, tenant, id, { lock = false } = {}) => {
  // Lock first and count in a second statement: a count taken in the locking statement is read from the snapshot taken BEFORE the wait for the lock, so a
  // second registration would see the first one's place as still free.
  if (lock) await db.query(`SELECT 1 FROM gaming_tournaments WHERE tournament_id = $1 AND business_id = $2 FOR UPDATE`, [id, tenant.businessId]);
  const t = (await db.query(`SELECT t.*, ${COUNTS} FROM gaming_tournaments t WHERE t.tournament_id = $1 AND t.business_id = $2`, [id, tenant.businessId])).rows[0];
  if (!t || (tenant.scopeBranchId != null && t.branch_id !== tenant.scopeBranchId)) throw new GamingError(404, 'Not found');
  return t;
};

const entryShape = (e) => withRupees({
  entry_id: e.entry_id, tournament_id: e.tournament_id, customer_id: e.customer_id, name: e.player_name, phone: e.phone, status: e.status, placement: e.placement,
  prize_paise: Number(e.prize_paise), invoice_id: e.invoice_id, invoice_number: e.invoice_number ?? null, paid: e.invoice_id != null
});

export const getTournament = async (db, tenant, id) => {
  const t = await load(db, tenant, id);
  const entries = (await db.query(
    `SELECT e.*, i.invoice_number FROM gaming_tournament_entries e LEFT JOIN invoices i ON i.invoice_id = e.invoice_id WHERE e.tournament_id = $1 ORDER BY (e.status = 'WITHDRAWN'), e.placement NULLS LAST, e.created_at, e.entry_id`, [id])).rows.map(entryShape);
  return { ...shape(t), entries_list: entries };
};

const fields = (b, { creating }) => {
  const f = {};
  if (creating || b.name !== undefined) f.name = text(b.name, 'Name', { max: 80, required: true });
  if (b.game_name !== undefined) f.game_name = text(b.game_name, 'Game', { max: 80 });
  if (creating || b.starts_at !== undefined) {
    const d = new Date(b.starts_at);
    if (!b.starts_at || Number.isNaN(d.getTime())) throw new GamingError(400, 'Start must be a date and time');
    f.starts_at = d;
  }
  if (b.entry_fee !== undefined) f.entry_fee_paise = money(b.entry_fee || 0, 'Entry fee', { min: 0 });
  if (b.prize_pool !== undefined) f.prize_pool_paise = money(b.prize_pool || 0, 'Prize pool', { min: 0 });
  if (b.max_players !== undefined) f.max_players = b.max_players === '' || b.max_players == null ? null : int(b.max_players, 'Most players', { min: 2, max: 500 });
  if (b.notes !== undefined) f.notes = text(b.notes, 'Notes', { max: 300 });
  if (b.status !== undefined) f.status = oneOf(b.status, 'Status', STATUSES, { required: true });
  return f;
};

export const createTournament = async (db, tenant, userId, b) => {
  const f = fields(b, { creating: true });
  const keys = Object.keys(f);
  const id = (await db.query(
    `INSERT INTO gaming_tournaments (business_id, branch_id, created_by, ${keys.join(', ')}) VALUES ($1,$2,$3,${keys.map((_, i) => `$${i + 4}`).join(',')}) RETURNING tournament_id`,
    [tenant.businessId, tenant.branchId, userId, ...keys.map((k) => f[k])])).rows[0].tournament_id;
  return getTournament(db, tenant, id);
};

export const updateTournament = async (db, tenant, id, b) => {
  const cur = await load(db, tenant, id, { lock: true });
  const f = fields(b, { creating: false });
  if (f.max_players != null && f.max_players < Number(cur.entries)) throw new GamingError(409, `${cur.entries} players are already in`);
  if (f.entry_fee_paise !== undefined && f.entry_fee_paise !== Number(cur.entry_fee_paise) && Number(cur.paid) > 0) throw new GamingError(409, 'Entries have been paid at the old fee. Leave the fee as it is');
  const keys = Object.keys(f);
  if (keys.length) await db.query(`UPDATE gaming_tournaments SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE tournament_id = $1`, [id, ...keys.map((k) => f[k])]);
  return getTournament(db, tenant, id);
};

const entryOf = async (db, tenant, entryId, { lock = false } = {}) => {
  const e = (await db.query(`SELECT e.* FROM gaming_tournament_entries e WHERE e.entry_id = $1 AND e.business_id = $2${lock ? ' FOR UPDATE OF e' : ''}`, [entryId, tenant.businessId])).rows[0];
  if (!e) throw new GamingError(404, 'Not found');
  await load(db, tenant, e.tournament_id);          // the outlet scope applies to the tournament
  return e;
};

/** Take the fee for an entry: one invoice line, paid now. */
const bill = async (db, tenant, userId, tournament, entry, payment) => {
  const settings = await getSettings(db, tenant.businessId);
  await ensureProduct(db, tenant.businessId, 'tournament');
  const invoice = await createInvoiceInTransaction(db, tenant, userId, {
    customerId: entry.customer_id ?? undefined,
    items: [{ description: `Tournament entry: ${tournament.name} (${entry.player_name})`, quantity: 1, unit_price: Number(tournament.entry_fee_paise) / 100, tax_rate: Number(settings.gst_rate) }],
    payment: payment.payment, payments: payment.payments, notes: `Tournament entry fee: ${tournament.name}`, invoiceDate: await localDate(db, tenant.businessId)
  });
  if (Number(invoice.balance_due) > 0) throw new GamingError(400, 'The entry fee must be paid in full');
  await db.query(`UPDATE gaming_tournament_entries SET invoice_id = $2 WHERE entry_id = $1`, [entry.entry_id, invoice.invoice_id]);
  return invoice;
};

export const register = async (db, tenant, userId, tournamentId, b) => {
  const t = await load(db, tenant, tournamentId, { lock: true });
  if (!['OPEN', 'PLANNED'].includes(t.status)) throw new GamingError(409, 'This tournament is not taking entries');
  if (t.max_players && Number(t.entries) >= t.max_players) throw new GamingError(409, 'The tournament is full', { code: 'FULL' });
  let customerId = null; let name = text(b.player_name, 'Name', { max: 60 }); let mobile = phone(b.phone, 'Mobile');
  if (b.customer_id) {
    const c = (await db.query(`SELECT customer_id, name, phone FROM customers WHERE customer_id = $1 AND business_id = $2`, [Number(b.customer_id), tenant.businessId])).rows[0];
    if (!c) throw new GamingError(400, 'That customer does not exist');
    customerId = c.customer_id; name = name || c.name; mobile = mobile || c.phone;
  }
  if (!name) throw new GamingError(400, 'Say who is entering');
  let entry;
  try {
    entry = (await db.query(`INSERT INTO gaming_tournament_entries (tournament_id, business_id, customer_id, player_name, phone) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [tournamentId, tenant.businessId, customerId, name, mobile])).rows[0];
  } catch (error) {
    if (error.code === '23505') throw new GamingError(409, `${name} has already entered`);
    throw error;
  }
  let invoice = null;
  if (Number(t.entry_fee_paise) > 0 && (b.payment || b.payments)) invoice = await bill(db, tenant, userId, t, entry, b);
  return { entry: entryShape({ ...entry, invoice_id: invoice?.invoice_id ?? null }), invoice };
};

/** Pay an entry that was registered unpaid. */
export const payEntry = async (db, tenant, userId, entryId, b) => {
  const e = await entryOf(db, tenant, entryId, { lock: true });
  if (e.status === 'WITHDRAWN') throw new GamingError(409, 'This entry was withdrawn');
  if (e.invoice_id) throw new GamingError(409, 'This entry is already paid');
  const t = await load(db, tenant, e.tournament_id);
  if (!(Number(t.entry_fee_paise) > 0)) throw new GamingError(400, 'This tournament has no entry fee');
  if (!b.payment && !b.payments) throw new GamingError(400, 'Take the payment');
  const invoice = await bill(db, tenant, userId, t, e, b);
  return { entry_id: entryId, invoice };
};

export const checkIn = async (db, tenant, entryId) => {
  const e = await entryOf(db, tenant, entryId, { lock: true });
  if (e.status === 'WITHDRAWN') throw new GamingError(409, 'This entry was withdrawn');
  const t = await load(db, tenant, e.tournament_id);
  if (Number(t.entry_fee_paise) > 0 && !e.invoice_id) throw new GamingError(409, 'The entry fee has not been paid yet', { code: 'UNPAID' });
  await db.query(`UPDATE gaming_tournament_entries SET status = 'CHECKED_IN' WHERE entry_id = $1`, [entryId]);
  return { entry_id: entryId, status: 'CHECKED_IN' };
};

export const withdraw = async (db, tenant, entryId) => {
  const e = await entryOf(db, tenant, entryId, { lock: true });
  const t = await load(db, tenant, e.tournament_id);
  if (t.status === 'DONE') throw new GamingError(409, 'The tournament is over');
  await db.query(`UPDATE gaming_tournament_entries SET status = 'WITHDRAWN', placement = NULL, prize_paise = 0 WHERE entry_id = $1`, [entryId]);
  return { entry_id: entryId, status: 'WITHDRAWN', refund_hint: e.invoice_id ? 'The fee was paid. Refund it with a credit note on its invoice.' : null };
};

/** Placements and prizes: [{ entry_id, placement, prize }]. Placements are distinct, prizes add up to no more than the pool. Closes the tournament. */
export const recordResults = async (db, tenant, tournamentId, results) => {
  const t = await load(db, tenant, tournamentId, { lock: true });
  if (t.status === 'CANCELLED') throw new GamingError(409, 'This tournament was cancelled');
  if (!Array.isArray(results) || !results.length) throw new GamingError(400, 'Enter at least the winner');
  const places = new Set(); const ids = new Set(); let total = 0;
  const clean = results.map((r) => {
    const entryId = int(r.entry_id, 'Entry', { min: 1, required: true });
    const placement = int(r.placement, 'Place', { min: 1, max: 500, required: true });
    const prize = money(r.prize || 0, 'Prize', { min: 0 });
    if (places.has(placement)) throw new GamingError(400, `Two people cannot both finish ${placement}`);
    if (ids.has(entryId)) throw new GamingError(400, 'A player is listed twice');
    places.add(placement); ids.add(entryId); total += prize;
    return { entryId, placement, prize };
  });
  if (total > Number(t.prize_pool_paise)) throw new GamingError(400, `The prizes add up to more than the prize pool`);
  const valid = (await db.query(`SELECT entry_id FROM gaming_tournament_entries WHERE tournament_id = $1 AND entry_id = ANY($2::int[]) AND status <> 'WITHDRAWN'`, [tournamentId, [...ids]])).rows.length;
  if (valid !== ids.size) throw new GamingError(400, 'One of those players is not in this tournament');
  await db.query(`UPDATE gaming_tournament_entries SET placement = NULL, prize_paise = 0 WHERE tournament_id = $1`, [tournamentId]);
  for (const r of clean) await db.query(`UPDATE gaming_tournament_entries SET placement = $2, prize_paise = $3 WHERE entry_id = $1`, [r.entryId, r.placement, r.prize]);
  await db.query(`UPDATE gaming_tournaments SET status = 'DONE' WHERE tournament_id = $1`, [tournamentId]);
  return getTournament(db, tenant, tournamentId);
};
