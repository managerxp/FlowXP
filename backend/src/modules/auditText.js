/*
 * Turns an audit row ("invoice.cancelled", { ... }) into a sentence a manager
 * can read, and groups actions into a few categories for filtering. Unknown
 * actions still show, humanised, so a newly audited action is never invisible.
 */

export const CATEGORIES = {
  sales:      { label: 'Sales and orders', prefixes: ['invoice', 'order', 'payment', 'table', 'credit_note'] },
  stock:      { label: 'Stock and purchasing', prefixes: ['inventory', 'purchase', 'purchase_order', 'supplier'] },
  menu:       { label: 'Menu and kitchen', prefixes: ['product', 'recipe', 'modifier_group', 'kitchen', 'menu'] },
  money:      { label: 'Expenses and costs', prefixes: ['expense', 'settings'] },
  customers:  { label: 'Customers and offers', prefixes: ['customer', 'coupon', 'loyalty'] },
  team:       { label: 'Team and outlets', prefixes: ['staff', 'outlet'] },
  oversight:  { label: 'Oversight and AI', prefixes: ['leakage', 'ai', 'forecast', 'integration', 'business'] }
};

/** The action prefixes belonging to a category, or null for an unknown one. */
export const prefixesFor = (category) => CATEGORIES[category]?.prefixes ?? null;

export const categoryOf = (action) => {
  const prefix = String(action).split('.')[0];
  return Object.entries(CATEGORIES).find(([, c]) => c.prefixes.includes(prefix))?.[0] ?? 'other';
};

const money = (n) => (typeof n === 'number' ? `₹${n.toLocaleString('en-IN')}` : null);
const join = (...parts) => parts.filter(Boolean).join(' ');

/* Each: (metadata, target) -> sentence. `target` is the readable name of the thing acted on, when known. */
const SENTENCES = {
  'invoice.created': (m, t) => join('Billed', t || 'a sale', m.total != null && `for ${money(m.total)}`),
  'invoice.cancelled': (m, t) => join('Cancelled', t || 'an invoice'),
  'invoice.refunded': (m, t) => join('Refunded', money(m.amount), t && `on ${t}`, m.reason && `(${m.reason})`),
  'credit_note.issued': (m, t) => join('Issued credit note', t, m.total != null && `for ${money(m.total)}`, m.refunded > 0 && `(refunded ${money(m.refunded)})`, m.restocked && '(returned to stock)'),
  'payment.recorded': (m, t) => join('Recorded a payment of', money(m.amount), t && `on ${t}`),
  'order.opened': (m, t) => join('Opened', t || 'an order'),
  'order.kot_sent': (m, t) => join('Sent', t || 'an order', 'to the kitchen', m.items != null && `(${m.items} item${m.items === 1 ? '' : 's'})`),
  'order.billed': (m, t) => join('Billed', t || 'an order', m.partial && '(part of the tab)'),
  'order.cancelled': (m, t) => join('Cancelled', t || 'an order'),
  'order.transferred': (m, t) => join('Moved', t || 'an order', 'to another table'),
  'order.merged': (m, t) => join('Merged another order into', t || 'an order'),
  'order.split': (m, t) => join('Split', t || 'an order', 'between tables'),
  'order.placed_by_customer': (m, t) => join('Customer ordered from their table', t && `(${t})`),
  'reservation.created': (m) => join('Booked a table for', m.guest, m.party && `(party of ${m.party})`),
  'reservation.updated': (m, t) => join('Changed reservation', t),
  'reservation.cancelled': (m) => join('Cancelled the reservation for', m.guest),
  'reservation.no_show': (m) => join('Marked', m.guest, 'as a no-show'),
  'reservation.completed': (m) => join('Completed the reservation for', m.guest),
  'reservation.seated': (m) => join('Seated', m.guest, m.table && `at ${m.table}`),
  'waitlist.added': (m) => join('Added', m.guest, 'to the waitlist', m.party && `(party of ${m.party})`),
  'waitlist.seated': (m) => join('Seated', m.guest, 'from the waitlist', m.table && `at ${m.table}`),
  'combo.set': (m, t) => join('Made', t || 'an item', 'a combo', m.items && `of ${m.items} items`),
  'combo.cleared': (m, t) => join('Turned', t || 'a combo', 'back into a single item'),
  'order.waiter_set': (m, t) => join('Changed the waiter on', t || 'an order'),
  'table.updated': (m, t) => join('Changed', t || 'a table'),
  'inventory.adjusted': (m, t) => join('Adjusted stock of', t || 'an item', m.quantity != null && `by ${m.quantity}`, m.reason && `(${m.reason})`),
  'inventory.wastage': (m, t) => join('Logged wastage of', m.quantity, 'of', t || 'an item', m.reason_code && `(${String(m.reason_code).toLowerCase()})`),
  'inventory.transferred': (m, t) => join('Transferred', m.quantity, 'of', t || 'an item', 'between outlets'),
  'purchase.created': (m, t) => join('Recorded purchase', t, m.total != null && `of ${money(m.total)}`),
  'purchase_order.drafted': (m, t) => join('Drafted purchase order', t, m.source === 'FORECAST' && 'from the forecast'),
  'purchase_order.updated': (m, t) => join('Edited purchase order', t),
  'purchase_order.sent': (m, t) => join('Sent purchase order', t, 'to the supplier', m.emailed && '(emailed)'),
  'purchase_order.received': (m, t) => join('Received purchase order', t, m.total != null && `worth ${money(m.total)}`, m.short?.length && `(short: ${m.short.join(', ')})`),
  'purchase_order.cancelled': (m, t) => join('Cancelled purchase order', t),
  'supplier.created': (m, t) => join('Added supplier', t),
  'supplier.updated': (m, t) => join('Edited supplier', t),
  'menu.imported': (m) => join('Imported the menu from a photo:', m.created != null && `${m.created} added`, m.updated > 0 && `${m.updated} prices updated`, m.skipped > 0 && `${m.skipped} skipped`),
  'product.created': (m, t) => join('Added', t || 'a product'),
  'product.updated': (m, t) => join('Edited', t || 'a product', m.fields?.length && `(${m.fields.join(', ')})`),
  'product.archived': (m, t) => join('Archived', t || 'a product'),
  'product.image_uploaded': (m, t) => join('Uploaded a photo for', t || 'a product'),
  'product.modifiers_set': (m, t) => join('Changed the options on', t || 'a product'),
  'product.outlet_settings': (m, t) => join('Changed the price or availability of', t || 'a product', 'at an outlet'),
  'recipe.updated': (m, t) => join('Changed the recipe of', t || 'a dish'),
  'modifier_group.created': (m, t) => join('Added an option group', t),
  'modifier_group.updated': (m, t) => join('Edited an option group', t),
  'kitchen.rush': (m, t) => join('Marked', t || 'an order', 'rush'),
  'kitchen.station_created': () => 'Added a kitchen station',
  'kitchen.station_updated': () => 'Changed a kitchen station',
  'kitchen.routing_updated': () => 'Changed which station cooks which dish',
  'expense.created': (m, t) => join('Recorded an expense', t),
  'expense.updated': (m, t) => join('Edited an expense', t),
  'expense.deleted': (m, t) => join('Deleted an expense', t),
  'settings.costs_updated': () => 'Changed the cost assumptions used for profit',
  'business.updated': (m) => join('Changed business settings', m.fields?.length && `(${m.fields.join(', ')})`),
  'business.created': () => 'Created the business',
  'customer.created': (m, t) => join('Added customer', t),
  'customer.updated': (m, t) => join('Edited customer', t),
  'coupon.created': (m) => join('Created coupon', m.code),
  'coupon.updated': (m) => join('Changed a coupon', m.length && `(${m.join?.(', ')})`),
  'loyalty.program_updated': (m) => join('Changed the loyalty program', m.enabled === false && '(switched off)', m.enabled === true && '(on)'),
  'staff.added': (m, t) => join('Added', t || 'a person', m.role && `as ${String(m.role).toLowerCase().replace('_', ' ')}`),
  'staff.updated': (m, t) => join('Changed', t || 'a person', m.role && `to ${String(m.role).toLowerCase().replace('_', ' ')}`, m.status === 'DISABLED' && '(access disabled)'),
  'staff.permissions_updated': (m, t) => join('Changed the permissions of', t || 'a person', m.changes && `(${Object.entries(m.changes).map(([k, v]) => `${k}: ${v}`).join(', ')})`),
  'outlet.created': (m) => join('Opened outlet', m.name),
  'outlet.updated': () => 'Edited an outlet',
  'outlet.closed': () => 'Closed an outlet',
  'outlet.reopened': () => 'Reopened an outlet',
  'leakage.reviewed': (m) => join('Reviewed a leakage finding', m.status && `(${String(m.status).toLowerCase()})`),
  'forecast.event_added': (m) => join('Added a demand event', m.label && `“${m.label}”`),
  'forecast.event_removed': () => 'Removed a demand event',
  'integration.updated': (m, t) => join('Changed the', t || 'delivery', 'integration'),
  'integration.menu_synced': (m, t) => join('Synced the menu to', t || 'a delivery platform'),
  'ai.asked': () => 'Asked Flow AI a question',
  'ai.enabled': () => 'Turned Flow AI on',
  'ai.disabled': () => 'Turned Flow AI off'
};

export const describeAction = (action, metadata = {}, target = null) => {
  const make = SENTENCES[action];
  if (make) { try { return make(metadata || {}, target); } catch { /* fall through to the plain version */ } }
  const [thing, verb] = String(action).split('.');
  return `${verb ? verb.replace(/_/g, ' ') : 'did'} ${thing.replace(/_/g, ' ')}${target ? ` ${target}` : ''}`.replace(/^./, (c) => c.toUpperCase());
};

/** How to look up a readable name for the thing an audit row is about. */
export const TARGETS = {
  credit_note: { table: 'credit_notes', id: 'cn_id', name: "'Credit note ' || cn_number" },
  invoice: { table: 'invoices', id: 'invoice_id', name: "'Invoice ' || invoice_number" },
  order: { table: 'orders', id: 'order_id', name: 'order_number' },
  purchase_order: { table: 'purchase_orders', id: 'po_id', name: 'po_number' },
  product: { table: 'products', id: 'product_id', name: 'name' },
  customer: { table: 'customers', id: 'customer_id', name: 'name' },
  coupon: { table: 'coupons', id: 'coupon_id', name: 'code' },
  user: { table: 'users', id: 'user_id', name: 'name' },
  branch: { table: 'branches', id: 'branch_id', name: 'name' },
  supplier: { table: 'suppliers', id: 'supplier_id', name: 'name' }
};
