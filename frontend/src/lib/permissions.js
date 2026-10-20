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
    'payments', 'expenses', 'gst', 'reports', 'export', 'ai', 'settings', 'refunds', 'appointments', 'staff_commission',
    'sales_orders', 'sales_cancel', 'fulfilment', 'pricing', 'purchase_approve',
    'principals', 'territories', 'schemes', 'targets', 'vehicles', 'field_sales', 'collections', 'prescriptions', 'dispensing', 'approvals', 'front_desk', 'housekeeping', 'night_audit', 'hotel_setup', 'gym_desk', 'gym_members', 'gym_setup', 'gym_trainer', 'gaming_desk', 'gaming_setup', 'parts_catalog', 'warehouse', 'grn', 'stock_approve', 'stock_count', 'returns_process', 'price_change', 'valuation', 'warehouse_settings'],
  MANAGER: ['billing', 'products', 'inventory', 'purchases', 'customers', 'suppliers',
    'payments', 'expenses', 'reports', 'ai', 'refunds', 'appointments', 'staff_commission',
    'sales_orders', 'sales_cancel', 'fulfilment', 'pricing', 'purchase_approve',
    'principals', 'territories', 'schemes', 'targets', 'vehicles', 'field_sales', 'collections', 'prescriptions', 'dispensing', 'approvals', 'front_desk', 'housekeeping', 'night_audit', 'hotel_setup', 'gym_desk', 'gym_members', 'gym_setup', 'gym_trainer', 'gaming_desk', 'gaming_setup', 'parts_catalog', 'warehouse', 'grn', 'stock_approve', 'stock_count', 'returns_process', 'price_change', 'valuation', 'warehouse_settings'],
  CASHIER: ['billing', 'customers', 'payments'],
  STAFF: ['billing'],
  // Gym roles (see backend/src/middleware/auth.js)
  GYM_RECEPTIONIST: ['gym_desk', 'gym_members', 'customers', 'billing', 'payments'],
  TRAINER: ['gym_trainer'],
  // Gaming lounge role (see backend/src/middleware/auth.js)
  GAMING_ATTENDANT: ['gaming_desk', 'customers', 'billing', 'payments'],
  // Auto spare parts: the storekeeper receives, puts away, moves and counts; the counter sells and looks parts up by vehicle or part number.
  STOREKEEPER: ['warehouse', 'grn', 'stock_count', 'inventory', 'suppliers'],
  PARTS_COUNTER: ['billing', 'customers', 'payments'],
  // Hotel roles (see backend/src/middleware/auth.js)
  FRONT_DESK: ['front_desk', 'housekeeping', 'customers', 'payments'],
  HOUSEKEEPER: ['housekeeping'],
  HOUSEKEEPING_SUPERVISOR: ['housekeeping', 'hotel_setup'],
  NIGHT_AUDITOR: ['night_audit', 'front_desk', 'housekeeping', 'payments', 'reports'],
  WAITER: ['billing'],
  KITCHEN: ['kitchen'],
  INVENTORY_MANAGER: ['inventory', 'purchases', 'suppliers'],
  DELIVERY: ['billing', 'fulfilment'],
  // Salon floor roles (see backend/src/middleware/auth.js)
  RECEPTIONIST: ['billing', 'customers', 'payments', 'appointments'],
  STYLIST: ['appointments'],
  ACCOUNTANT: ['billing', 'payments', 'expenses', 'gst', 'reports', 'export', 'refunds', 'collections'],
  // Wholesale roles (see backend/src/middleware/auth.js)
  SALES_MANAGER: ['billing', 'customers', 'payments', 'reports', 'refunds', 'approvals', 'sales_orders', 'sales_cancel', 'pricing', 'export', 'territories', 'schemes', 'targets', 'field_sales', 'collections'],
  SALES_EXECUTIVE: ['billing', 'customers', 'sales_orders', 'field_sales'],
  WAREHOUSE_MANAGER: ['inventory', 'purchases', 'fulfilment', 'suppliers', 'vehicles'],
  WAREHOUSE_STAFF: ['fulfilment'],
  PURCHASE_MANAGER: ['purchases', 'suppliers', 'inventory', 'purchase_approve', 'payments', 'reports', 'principals'],
  // Distributor roles (see backend/src/middleware/auth.js)
  FIELD_SALES: ['customers', 'sales_orders', 'field_sales', 'collections'],
  COLLECTION_EXECUTIVE: ['customers', 'collections', 'field_sales'],
  DELIVERY_MANAGER: ['fulfilment', 'vehicles', 'inventory'],
  DISTRIBUTOR_ADMIN: ['approvals', 'billing', 'products', 'inventory', 'purchases', 'customers', 'suppliers', 'payments', 'expenses', 'gst', 'reports', 'export', 'ai', 'settings', 'refunds',
    'sales_orders', 'sales_cancel', 'fulfilment', 'pricing', 'purchase_approve', 'principals', 'territories', 'schemes', 'targets', 'vehicles', 'field_sales', 'collections'],
  // Pharmacy roles (see backend/src/middleware/auth.js)
  PHARMACIST: ['billing', 'inventory', 'prescriptions', 'dispensing', 'customers'],
  SALES_STAFF: ['billing', 'customers'],
  GRN_MANAGER: ['purchases', 'inventory', 'suppliers'],
  AUDITOR: ['reports', 'export']
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
