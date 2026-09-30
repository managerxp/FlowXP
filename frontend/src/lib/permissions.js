/*
 * A read-only mirror of backend/src/middleware/auth.js's ROLE_PERMISSIONS and
 * hasPermission(), so the sidebar and screens can match what a role can
 * actually do instead of showing everything to everyone. This never decides
 * access on its own — every write and most reads are still checked server
 * side (this file has no way to enforce anything) — it only keeps the UI from
 * offering a door that is going to say no.
 */
export const ROLE_PERMISSIONS = {
  OWNER: ['*'],
  ADMIN: ['billing', 'products', 'inventory', 'purchases', 'customers', 'suppliers',
    'payments', 'expenses', 'gst', 'reports', 'export', 'ai', 'settings', 'refunds'],
  MANAGER: ['billing', 'products', 'inventory', 'purchases', 'customers', 'suppliers',
    'payments', 'expenses', 'reports', 'ai', 'refunds'],
  CASHIER: ['billing', 'customers', 'payments'],
  STAFF: ['billing'],
  WAITER: ['billing'],
  KITCHEN: ['kitchen'],
  INVENTORY_MANAGER: ['inventory', 'purchases', 'suppliers']
};

export const hasPermission = (business, permission) => {
  if (!business) return false;
  const base = ROLE_PERMISSIONS[business.role] || [];
  if (base.includes('*')) return true;
  const override = business.permissions?.[permission];
  if (override === true) return true;
  if (override === false) return false;
  return base.includes(permission);
};
