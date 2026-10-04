/*
 * The permissions FlowXP checks, in words a manager can read, and how a
 * person's overrides combine with their role.
 *
 * A role gives a default set (middleware/auth.js ROLE_PERMISSIONS). An owner can
 * then grant one more thing to a particular person, or take one away, without
 * inventing a new role. Overrides are stored in business_users.permissions as
 * { permission: true | false }; only entries that differ from the role's default
 * are kept, so changing a role later never leaves stale overrides behind.
 */
import { ROLE_PERMISSIONS } from '../middleware/auth.js';

export const PERMISSION_INFO = {
  billing:   { label: 'Billing and orders', description: 'Take orders, bill sales, record customer payments, open the till.' },
  kitchen:   { label: 'Kitchen display', description: 'See and advance kitchen tickets.' },
  products:  { label: 'Menu and products', description: 'Add and edit products, prices, recipes, modifiers and kitchen routing.' },
  inventory: { label: 'Stock', description: 'See stock, adjust it, log wastage, move stock between outlets.' },
  barcode_reassign: { label: 'Move barcodes', description: 'Take a barcode off one product and put it on another.' },
  product_quick_add: { label: 'Add products at the till', description: 'Create a missing product while billing: name, price, GST. FlowXP makes its SKU.' },
  purchases: { label: 'Purchasing', description: 'Create, send and receive purchase orders.' },
  suppliers: { label: 'Suppliers', description: 'Add and edit suppliers.' },
  customers: { label: 'Customers', description: 'Add and edit customers.' },
  payments:  { label: 'Payments', description: 'See all payments and record standalone ones.' },
  expenses:  { label: 'Expenses', description: 'Record and edit operating expenses.' },
  refunds:   { label: 'Refunds', description: 'Refund money on an invoice.' },
  reports:   { label: 'Reports and profit', description: 'Sales, profitability, forecasts and kitchen performance.' },
  gst:       { label: 'GST reports', description: 'GST summaries and HSN breakdowns.' },
  export:    { label: 'Export data', description: 'Download the activity log as a file.' },
  appointments:     { label: 'Appointments', description: 'Book, move and cancel appointments and see who is free (a stylist sees only their own).' },
  staff_commission: { label: 'Salon team and commission', description: 'Salon staff profiles, attendance, commission and payouts.' },
  sales_orders:     { label: 'Sales orders', description: 'Create, edit and confirm wholesale sales orders and invoice them.' },
  sales_cancel:     { label: 'Cancel sales orders', description: 'Cancel confirmed sales orders and release their stock.' },
  fulfilment:       { label: 'Warehouse fulfilment', description: 'See pick lists, pick, pack, dispatch and update deliveries.' },
  pricing:          { label: 'Wholesale pricing', description: 'Manage price lists, customer prices and bulk price updates.' },
  purchase_approve: { label: 'Approve purchases', description: 'Approve purchase orders and post goods receipts above the limit.' },
  principals:  { label: 'Principals and brands', description: 'Manage the manufacturers and brands you distribute, and their agreements.' },
  territories: { label: 'Territories and beats', description: 'Manage regions, territories, areas and beat plans, and assign retailers to them.' },
  schemes:     { label: 'Schemes', description: 'Create and change schemes: free quantity, quantity and value discounts.' },
  targets:     { label: 'Targets and commission', description: 'Set sales targets and commission rules, and see the team\'s achievement.' },
  vehicles:    { label: 'Vehicle stock', description: 'Load vans, sell from them, take unsold stock back and reconcile.' },
  field_sales: { label: 'Field sales', description: 'Visit retailers on a beat, record visits and take orders in the field.' },
  collections: { label: 'Collections', description: 'Record payments collected from retailers and allocate them to invoices.' },
  prescriptions: { label: 'Prescriptions', description: 'Create, review and approve prescriptions.' },
  dispensing:    { label: 'Dispensing', description: 'Select batches and dispense medicines against a prescription.' },
  ai:        { label: 'Flow AI', description: 'Ask the AI assistant about the business.' },
  settings:  { label: 'Settings and team', description: 'Business settings, outlets, staff, loyalty, coupons, leakage checks and the activity log.' }
};

export const PERMISSIONS = Object.keys(PERMISSION_INFO);

/** What a role allows with no overrides. */
export const roleDefaults = (role) => {
  const base = ROLE_PERMISSIONS[role] || [];
  return Object.fromEntries(PERMISSIONS.map((p) => [p, base.includes('*') || base.includes(p)]));
};

/** The full picture for one person: default, override and the result. */
export const describePermissions = (role, overrides = {}) => {
  const defaults = roleDefaults(role);
  return PERMISSIONS.map((key) => {
    const override = typeof overrides[key] === 'boolean' ? overrides[key] : null;
    return { key, ...PERMISSION_INFO[key], role_default: defaults[key], override, effective: override ?? defaults[key] };
  });
};

/**
 * Turn a request ({ key: true | false | null }) into what should be stored.
 * Unknown keys are an error; a value equal to the role default is dropped.
 */
export const cleanOverrides = (role, input, current = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Send the permissions to change' };
  const defaults = roleDefaults(role);
  const next = { ...current };
  for (const [key, value] of Object.entries(input)) {
    if (!PERMISSIONS.includes(key)) return { error: `Unknown permission: ${key}` };
    if (value !== true && value !== false && value !== null) return { error: `${PERMISSION_INFO[key].label}: choose allow, deny or the role default` };
    if (value === null) delete next[key]; else next[key] = value;
  }
  for (const key of Object.keys(next)) if (!PERMISSIONS.includes(key) || next[key] === defaults[key]) delete next[key];
  return { overrides: next };
};
