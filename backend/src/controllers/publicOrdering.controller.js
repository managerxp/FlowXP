/*
 * Customer QR ordering — the one place in this API a request carries no
 * session at all. A customer scans the code taped to their table, gets a
 * menu, and places an order, all without ever signing in. The table's
 * qr_token (schema.orders.js) is the only thing that says which business and
 * table a request is for; see the identical reasoning for
 * delivery_integrations.webhook_token in integrations.controller.js.
 *
 * Reuses orders.controller.js's exported core (insertOrderItems, sendKotCore,
 * getOrCreateOpenOrderForTable) rather than re-implementing "add an item" —
 * the validation rules (an archived product can't be ordered, a custom line
 * needs its own price) must stay identical between the staff app and here.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { recordAudit, recordEvent } from '../modules/events.js';
import { loadProductGroups, outletSettingsFor } from '../modules/menu.js';
import { describe, findCustomerByPhone, getProgram, isLive, normalisePhone, progressFor } from '../modules/loyalty.js';
import { businessToday } from '../utils/dates.js';
import { OrderItemsError, getOrCreateOpenOrderForTable, insertOrderItems, sendKotCore } from './orders.controller.js';

const resolveTable = async (client, token) => {
  const { rows } = await client.query(
    `SELECT t.table_id, t.branch_id, t.name AS table_name, t.status AS table_status, t.business_id,
            b.name AS business_name, b.currency, b.status AS business_status, b.upi_vpa
     FROM dining_tables t
     JOIN businesses b ON b.business_id = t.business_id
     WHERE t.qr_token = $1`,
    [token]
  );
  return rows[0] || null;
};

/* ==========================================================================
   GET /api/public/menu/:token
   ========================================================================== */
export const getMenu = async (req, res) => {
  try {
    const table = await resolveTable(pool, req.params.token);
    if (!table || table.table_status === 'CLOSED' || table.business_status !== 'ACTIVE') {
      return res.status(404).json({ success: false, message: 'This ordering link is not available right now' });
    }

    const { rows } = await pool.query(
      `SELECT p.product_id, p.name, p.description, p.image_url, p.unit,
              p.selling_price_paise, p.category_id, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.category_id = p.category_id
       WHERE p.business_id = $1 AND p.status = 'ACTIVE' AND p.kind = 'DISH'
       ORDER BY c.name NULLS LAST, p.name`,
      [table.business_id]
    );

    // The table's outlet decides what is on the menu and what it costs there.
    const outletSettings = await outletSettingsFor(pool, table.branch_id, rows.map((r) => r.product_id));
    const menu = rows.filter((r) => outletSettings.get(r.product_id)?.is_available !== false)
      .map((r) => ({ ...r, selling_price_paise: outletSettings.get(r.product_id)?.price_paise ?? r.selling_price_paise }));

    const groupsByProduct = new Map();
    for (const row of menu) groupsByProduct.set(row.product_id, await loadProductGroups(pool, table.business_id, row.product_id));

    const byCategory = new Map();
    for (const row of menu) {
      const key = row.category_id ?? 0;
      if (!byCategory.has(key)) byCategory.set(key, { category_id: row.category_id, name: row.category_name || 'Menu', products: [] });
      byCategory.get(key).products.push({
        product_id: row.product_id,
        name: row.name,
        description: row.description,
        image_url: row.image_url,
        unit: row.unit,
        price: toRupees(row.selling_price_paise),
        modifier_groups: groupsByProduct.get(row.product_id).map((g) => ({
          group_id: g.group_id, name: g.name, is_variant: g.is_variant, min_select: g.min_select, max_select: g.max_select,
          modifiers: g.modifiers.map((m) => ({ modifier_id: m.modifier_id, name: m.name, price_delta: toRupees(m.price_delta_paise) }))
        }))
      });
    }

    const program = await getProgram(pool, table.business_id);
    const loyalty = isLive(program) ? {
      visits_required: program.visits_required, reward_item: `${program.reward_quantity > 1 ? `${program.reward_quantity} × ` : ''}${program.reward_name}`,
      min_bill: toRupees(program.min_bill_paise)
    } : null;

    res.json({
      success: true,
      data: {
        loyalty,
        // upi_vpa reaches the customer's own confirmation screen so it can
        // show a "pay now" QR — this is the same idea as a UPI QR sticker on
        // the counter, not a payment gateway; see the column comment.
        business: { name: table.business_name, currency: table.currency, upi_vpa: table.upi_vpa },
        table: { table_id: table.table_id, name: table.table_name },
        categories: [...byCategory.values()]
      }
    });
  } catch (error) {
    console.error('[public-ordering] getMenu failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load the menu' });
  }
};

/* ==========================================================================
   POST /api/public/menu/:token/loyalty { phone }

   A customer types their mobile number to see their visit card. Nothing is
   created and no name is returned: it says how many visits the number has,
   and nothing else about the person.
   ========================================================================== */
export const loyaltyCard = async (req, res) => {
  try {
    const table = await resolveTable(pool, req.params.token);
    if (!table || table.table_status === 'CLOSED' || table.business_status !== 'ACTIVE') {
      return res.status(404).json({ success: false, message: 'This ordering link is not available right now' });
    }
    if (!normalisePhone(req.body?.phone)) return res.status(400).json({ success: false, message: 'Enter a 10-digit mobile number' });
    const program = await getProgram(pool, table.business_id);
    if (!isLive(program)) return res.status(404).json({ success: false, message: 'There is no loyalty card here yet' });

    const customer = await findCustomerByPhone(pool, table.business_id, req.body.phone);
    const progress = customer
      ? await progressFor(pool, table.business_id, customer.customer_id, program, await businessToday(table.business_id))
      : { stamps: 0, visits: 0, rewards_redeemed: 0, last_visit: null, day_event: null, reward_ready: false };
    const card = describe(program, progress);
    res.json({ success: true, data: { ...card, member: Boolean(customer), visits: progress.visits } });
  } catch (error) {
    console.error('[public-ordering] loyalty failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not look that up' });
  }
};

/* ==========================================================================
   POST /api/public/menu/:token/order

   Lands on the table's existing open order if it has one (a second round at
   the same tab), else opens one — then adds the items and sends them to the
   kitchen immediately. A customer has no "send to kitchen" button to press.
   ========================================================================== */
export const placeOrder = async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ success: false, message: 'Add at least one item' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const table = await resolveTable(client, req.params.token);
    if (!table || table.table_status === 'CLOSED' || table.business_status !== 'ACTIVE') {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'This ordering link is not available right now' });
    }

    const notes = [req.body?.customer_name, req.body?.customer_phone, req.body?.notes]
      .filter(Boolean).join(' · ') || null;

    const order = await getOrCreateOpenOrderForTable(client, {
      businessId: table.business_id,
      branchId: table.branch_id,
      tableId: table.table_id,
      notes
    });

    /* A mobile number given with the order identifies the customer (created if new), so when staff bill
       this table the visit lands on their loyalty card without anyone re-typing it. */
    const mobile = normalisePhone(req.body?.customer_phone);
    if (mobile && !order.customer_id) {
      let customer = await findCustomerByPhone(client, table.business_id, mobile);
      if (!customer) {
        const name = String(req.body?.customer_name || '').trim().slice(0, 160) || `Guest ${mobile.slice(-4)}`;
        customer = (await client.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [table.business_id, name, mobile])).rows[0];
      }
      await client.query(`UPDATE orders SET customer_id = $1 WHERE order_id = $2`, [customer.customer_id, order.order_id]);
    }

    let inserted;
    try {
      inserted = await insertOrderItems(client, table.business_id, order.order_id, items);
    } catch (itemError) {
      await client.query('ROLLBACK');
      if (itemError instanceof OrderItemsError) {
        return res.status(itemError.status).json({ success: false, message: itemError.message });
      }
      throw itemError;
    }

    const sent = await sendKotCore(client, { businessId: table.business_id, orderId: order.order_id, createdBy: null });

    await client.query('COMMIT');

    recordAudit(req, {
      business_id: table.business_id,
      action: 'order.placed_by_customer',
      resource_type: 'order',
      resource_id: order.order_id,
      metadata: { table_id: table.table_id, items: inserted.length }
    });
    recordEvent('customer_qr_order', { businessId: table.business_id, properties: { table_id: table.table_id } });

    res.status(201).json({
      success: true,
      data: {
        order_number: order.order_number,
        table_name: table.table_name,
        kot_number: sent?.kot?.kot_number || null
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.message?.includes('positive number') || error.message?.includes('must be a number')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('[public-ordering] placeOrder failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not place your order' });
  } finally {
    client.release();
  }
};
