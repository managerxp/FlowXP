/*
 * What the businesses send over WhatsApp, and roughly what Meta charges for it (the `messages` log, migrations/0024).
 *
 *   GET /api/admin/messaging/usage?from&to        one row per business: messages by kind of charge, estimated cost
 *   GET /api/admin/businesses/:id/messaging       the same for one business: by kind of message and by day
 *
 * Meta bills per delivered template, by category. Only WhatsApp messages that were handed to Meta (status SENT) count;
 * SMS and failed or skipped ones cost nothing here. The rates are an estimate for India, in rupees (check Meta's rate card).
 */
import pool from '../config/database.js';
import { adjust, balanceOf, categoryOf, walletSettings } from '../modules/messaging/wallet.js';
import { recordAudit } from '../modules/events.js';

// ponytail: fixed India rates; move to a platform setting when the rate card changes often or other countries are billed
export const RATES = { UTILITY: 0.115, AUTHENTICATION: 0.115, MARKETING: 0.86 };


const range = (q) => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  return { from, to };
};

// rows of { kind, n } -> counts per category and the estimated cost
const price = (rows) => {
  const by = { UTILITY: 0, AUTHENTICATION: 0, MARKETING: 0 };
  for (const r of rows) by[categoryOf(r.kind)] += r.n;
  const cost = Object.entries(by).reduce((s, [c, n]) => s + n * RATES[c], 0);
  return { ...by, cost: Math.round(cost * 100) / 100 };
};

export const usage = async (req, res) => {
  try {
    const { from, to } = range(req.query);
    const { rows } = await pool.query(
      `SELECT b.business_id, b.name, b.business_type, b.wallet_paise, m.kind,
              COALESCE(SUM(m.charge_paise), 0)::bigint AS charged,
              COUNT(*) FILTER (WHERE m.status = 'SENT')::int AS n,
              COUNT(*) FILTER (WHERE m.status = 'FAILED')::int AS failed,
              COUNT(*) FILTER (WHERE m.delivered_at IS NOT NULL)::int AS delivered
         FROM messages m JOIN businesses b ON b.business_id = m.business_id
        WHERE m.channel = 'WHATSAPP' AND m.created_at >= $1::date AND m.created_at < ($2::date + 1)
        GROUP BY b.business_id, b.name, b.business_type, b.wallet_paise, m.kind`, [from, to]);
    const byBusiness = new Map();
    for (const r of rows) {
      const e = byBusiness.get(r.business_id) || { business_id: r.business_id, name: r.name, business_type: r.business_type, failed: 0, delivered: 0, kinds: [], charged: 0, wallet_paise: Number(r.wallet_paise) };
      e.charged += Number(r.charged) / 100; e.failed += r.failed; e.delivered += r.delivered; e.kinds.push({ kind: r.kind, n: r.n });
      byBusiness.set(r.business_id, e);
    }
    const businesses = [...byBusiness.values()].map(({ kinds, ...e }) => ({ ...e, sent: kinds.reduce((s, k) => s + k.n, 0), ...price(kinds) })).sort((a, b) => b.cost - a.cost || b.sent - a.sent);
    const total = businesses.reduce((t, b) => ({ sent: t.sent + b.sent, failed: t.failed + b.failed, UTILITY: t.UTILITY + b.UTILITY, AUTHENTICATION: t.AUTHENTICATION + b.AUTHENTICATION, MARKETING: t.MARKETING + b.MARKETING, cost: t.cost + b.cost, charged: t.charged + b.charged }),
      { sent: 0, failed: 0, UTILITY: 0, AUTHENTICATION: 0, MARKETING: 0, cost: 0, charged: 0 });
    total.charged = Math.round(total.charged * 100) / 100;
    total.cost = Math.round(total.cost * 100) / 100;
    res.json({ success: true, data: { from, to, rates: RATES, total, businesses } });
  } catch (err) {
    console.error('admin messaging usage failed:', err);
    res.status(500).json({ success: false, message: 'Could not load message usage.' });
  }
};

export const businessUsage = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Not a business number.' });
    const { from, to } = range(req.query);
    const where = `business_id = $1 AND channel = 'WHATSAPP' AND created_at >= $2::date AND created_at < ($3::date + 1)`;
    const [kinds, days] = await Promise.all([
      pool.query(`SELECT kind, COUNT(*) FILTER (WHERE status = 'SENT')::int AS n, COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
                         COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered, COUNT(*) FILTER (WHERE read_at IS NOT NULL)::int AS read
                    FROM messages WHERE ${where} GROUP BY kind ORDER BY n DESC`, [id, from, to]),
      pool.query(`SELECT created_at::date AS day, COUNT(*) FILTER (WHERE status = 'SENT')::int AS n FROM messages WHERE ${where} GROUP BY 1 ORDER BY 1`, [id, from, to])
    ]);
    res.json({
      success: true, data: { from, to, rates: RATES,
      summary: { ...price(kinds.rows), sent: kinds.rows.reduce((s, r) => s + r.n, 0), failed: kinds.rows.reduce((s, r) => s + r.failed, 0) },
      kinds: kinds.rows.map((r) => ({ ...r, category: categoryOf(r.kind) })),
      days: days.rows }
    });
  } catch (err) {
    console.error('admin business messaging failed:', err);
    res.status(500).json({ success: false, message: 'Could not load message usage.' });
  }
};

/* GET /api/admin/businesses/:id/wallet: the credit balance and its history */
export const getWallet = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Not a business number.' });
  const [s, bal, rows] = await Promise.all([walletSettings(), balanceOf(pool, id), pool.query(`SELECT entry_id, amount_paise, kind, note, balance_after_paise, created_at FROM wallet_ledger WHERE business_id = $1 ORDER BY entry_id DESC LIMIT 50`, [id])]);
  res.json({ success: true, data: { required: s.required, prices_paise: s.prices, balance_paise: bal, entries: rows.rows } });
};

/* POST /api/admin/businesses/:id/wallet { amount, note }: add credit in rupees; a negative amount takes some back (kept as an adjustment) */
export const topUpWallet = async (req, res) => {
  const id = Number(req.params.id);
  const amount = Math.round(Number(req.body?.amount) * 100);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Not a business number.' });
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 10_000_000) return res.status(400).json({ success: false, message: 'Enter an amount in rupees, up to 1,00,000.' });
  const note = String(req.body?.note || '').trim().slice(0, 200) || null;
  const balance = await adjust(pool, id, amount, { kind: amount > 0 ? 'TOPUP' : 'ADJUST', note, by: req.auth.userId });
  if (balance === null) return res.status(404).json({ success: false, message: 'Business not found' });
  recordAudit(req, { business_id: id, action: 'admin.wallet_adjusted', resource_type: 'business', resource_id: id, metadata: { amount_paise: amount, note } });
  res.status(201).json({ success: true, data: { balance_paise: balance } });
};
