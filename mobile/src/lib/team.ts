/*
 * Staff and outlets on the phone (owner and admin): who works here, in what role and at which outlet, what each person may do, and the places
 * the business trades from. The same rules as the website's Staff and Outlets pages (frontend StaffPage.jsx, OutletsPage.jsx); the server
 * checks everything again (an admin cannot make an owner, the last owner cannot be removed, a plan's outlet limit), and its own message is shown.
 * Role names and their one-line help stay in English, as on the website.
 */
export const ROLES: Record<string, string> = {
  OWNER: 'Owner', ADMIN: 'Admin', MANAGER: 'Manager', CASHIER: 'Cashier', WAITER: 'Waiter',
  KITCHEN: 'Kitchen', INVENTORY_MANAGER: 'Stock manager', STAFF: 'Staff', DELIVERY: 'Delivery rider',
  RECEPTIONIST: 'Receptionist', STYLIST: 'Stylist', ACCOUNTANT: 'Accountant',
  SALES_MANAGER: 'Sales manager', SALES_EXECUTIVE: 'Sales executive', WAREHOUSE_MANAGER: 'Warehouse manager', WAREHOUSE_STAFF: 'Warehouse staff', PURCHASE_MANAGER: 'Purchase manager',
  DISTRIBUTOR_ADMIN: 'Distributor admin', FIELD_SALES: 'Field sales rep', COLLECTION_EXECUTIVE: 'Collection executive', DELIVERY_MANAGER: 'Delivery manager',
  PHARMACIST: 'Pharmacist', SALES_STAFF: 'Sales staff', GRN_MANAGER: 'GRN manager', AUDITOR: 'Auditor',
  FRONT_DESK: 'Front desk', HOUSEKEEPER: 'Housekeeper', HOUSEKEEPING_SUPERVISOR: 'Housekeeping supervisor', NIGHT_AUDITOR: 'Night auditor',
  GYM_RECEPTIONIST: 'Gym front desk', TRAINER: 'Trainer', GAMING_ATTENDANT: 'Gaming attendant', STOREKEEPER: 'Storekeeper', PARTS_COUNTER: 'Parts counter'
};
export const ROLE_HELP: Record<string, string> = {
  OWNER: 'Everything, including billing and staff.', ADMIN: "Runs the business day to day; can't manage owners.",
  MANAGER: 'Reports, stock, buying and refunds.', CASHIER: 'Bills sales and takes payments.', WAITER: 'Takes and bills orders.',
  KITCHEN: 'Sees and advances kitchen tickets only.', INVENTORY_MANAGER: 'Stock, purchasing and suppliers.', STAFF: 'Billing only.',
  DELIVERY: 'Gets assigned to delivery orders and updates pickup/delivered status.',
  RECEPTIONIST: 'Books appointments, bills clients and looks after the client book.',
  STYLIST: 'Sees their own appointments and moves clients through the service. No billing or money.',
  ACCOUNTANT: 'Billing records, payments, expenses, GST and reports. Cannot change the catalogue or the team.',
  FRONT_DESK: 'Hotel bookings, check-in and check-out, the guest bill and payments. Can mark rooms clean or dirty.',
  HOUSEKEEPER: 'Sees the rooms and marks them clean, dirty or out of order. Nothing else.',
  HOUSEKEEPING_SUPERVISOR: 'Housekeeping, and can set up rooms and rates.',
  NIGHT_AUDITOR: "Closes the hotel's day, takes payments and reads the hotel reports.",
  GYM_RECEPTIONIST: 'Scans cards and phones, checks members in, signs members up and sells memberships. Cannot change plans or settings.',
  STOREKEEPER: 'Receives goods, puts stock away in racks and bins, moves and counts it. Cannot change prices or see margins.',
  PARTS_COUNTER: 'Sells parts at the counter, looks them up by vehicle or part number, takes payments. Cannot change stock or prices.',
  GAMING_ATTENDANT: 'Runs the board: starts, pauses, stops and moves sessions, takes orders for a station and the payment. Cannot change stations, rates or settings.',
  TRAINER: "Sees members' plans and their private health notes, and runs classes. No billing or door access.",
  SALES_MANAGER: 'Orders, customers, pricing, receipts, returns and sales reports. Can cancel orders and override a credit hold.',
  SALES_EXECUTIVE: 'Takes orders for their own customers. Cannot change prices or see the books.',
  WAREHOUSE_MANAGER: 'Stock, goods receipts, transfers, picking and dispatch.',
  WAREHOUSE_STAFF: 'Picks, packs and dispatches orders in their own warehouse.',
  PURCHASE_MANAGER: 'Buys, approves purchase orders and pays suppliers. Manages principals.',
  DISTRIBUTOR_ADMIN: 'Runs the distribution business day to day: territories, targets, schemes, vans, pricing and settings.',
  FIELD_SALES: 'Visits their own retailers on a beat, takes orders and collects payments. Sees only their own retailers, targets and van.',
  COLLECTION_EXECUTIVE: 'Collects payments from retailers and records visits. Cannot take orders or see the books.',
  DELIVERY_MANAGER: 'Runs the vans and the drivers: loading, counting, deliveries and dispatch.',
  PHARMACIST: 'Billing, inventory, prescriptions and dispensing. The till and the shelf.',
  SALES_STAFF: 'Bills sales and looks up customers. No inventory or buying.',
  GRN_MANAGER: 'Receives goods, manages suppliers and stock.',
  AUDITOR: 'Reports and exports only. Cannot bill, buy or change stock.'
};
/** Owners and admins always see every outlet; these roles belong to exactly one outlet (the server pins them). */
export const GROUP_ROLES = ['OWNER', 'ADMIN'];
export const FLOOR_ROLES = ['GYM_RECEPTIONIST', 'TRAINER', 'GAMING_ATTENDANT', 'STOREKEEPER', 'PARTS_COUNTER', 'FRONT_DESK', 'HOUSEKEEPER', 'HOUSEKEEPING_SUPERVISOR', 'NIGHT_AUDITOR', 'CASHIER', 'WAITER', 'KITCHEN', 'STAFF', 'DELIVERY', 'RECEPTIONIST', 'STYLIST', 'ACCOUNTANT', 'WAREHOUSE_STAFF', 'SALES_EXECUTIVE', 'FIELD_SALES', 'COLLECTION_EXECUTIVE', 'PHARMACIST', 'SALES_STAFF', 'GRN_MANAGER', 'AUDITOR'];

const SALON_ONLY = ['RECEPTIONIST', 'STYLIST'];
const WHOLESALE_ONLY = ['SALES_MANAGER', 'SALES_EXECUTIVE', 'WAREHOUSE_MANAGER', 'WAREHOUSE_STAFF', 'PURCHASE_MANAGER', 'DISTRIBUTOR_ADMIN', 'FIELD_SALES', 'COLLECTION_EXECUTIVE', 'DELIVERY_MANAGER'];
const PHARMACY_ONLY = ['PHARMACIST', 'SALES_STAFF', 'GRN_MANAGER', 'AUDITOR'];
const HOTEL_ONLY = ['FRONT_DESK', 'HOUSEKEEPER', 'HOUSEKEEPING_SUPERVISOR', 'NIGHT_AUDITOR'];
const GYM_ONLY = ['GYM_RECEPTIONIST', 'TRAINER'];
const GAMING_ONLY = ['GAMING_ATTENDANT'];
const PARTS_ONLY = ['STOREKEEPER', 'PARTS_COUNTER'];
const NOT_FOR_SALON = ['WAITER', 'KITCHEN', 'DELIVERY'];
const NOT_FOR_WHOLESALE = ['WAITER', 'KITCHEN'];
const NOT_FOR_PHARMACY = ['WAITER', 'KITCHEN', 'DELIVERY'];
const DISTRIBUTOR_ONLY = ['DISTRIBUTOR_ADMIN', 'FIELD_SALES', 'COLLECTION_EXECUTIVE', 'DELIVERY_MANAGER'];

/** The roles that make sense for this kind of business (a salon has no kitchen, a restaurant no stylists); an admin cannot hand out the top roles. */
export const rolesFor = (businessType: string | undefined, isOwner: boolean, distributorEnabled = false): string[] => {
  const t = businessType ?? '';
  const salon = t === 'SALON'; const wholesale = ['WHOLESALE', 'DISTRIBUTOR'].includes(t); const pharmacy = t === 'PHARMACY'; const hotel = t === 'HOTEL'; const gym = t === 'GYM';
  const gaming = t === 'GAMING_CAFE'; const parts = t === 'AUTO_PARTS';
  const none = (...lists: string[][]) => (r: string) => lists.every((l) => !l.includes(r));
  const kind = gym ? none(NOT_FOR_SALON, SALON_ONLY, WHOLESALE_ONLY, PHARMACY_ONLY, HOTEL_ONLY)
    : salon ? none(NOT_FOR_SALON, WHOLESALE_ONLY, PHARMACY_ONLY, HOTEL_ONLY, GYM_ONLY)
      : hotel ? none(SALON_ONLY, WHOLESALE_ONLY, PHARMACY_ONLY, GYM_ONLY)
        : wholesale ? (r: string) => none(NOT_FOR_WHOLESALE, SALON_ONLY, PHARMACY_ONLY, HOTEL_ONLY, GYM_ONLY)(r) && (distributorEnabled || !DISTRIBUTOR_ONLY.includes(r))
          : pharmacy ? none(NOT_FOR_PHARMACY, SALON_ONLY, WHOLESALE_ONLY, HOTEL_ONLY, GYM_ONLY)
            : none(SALON_ONLY, WHOLESALE_ONLY, PHARMACY_ONLY, HOTEL_ONLY, GYM_ONLY);
  return Object.keys(ROLES).filter((r) => (isOwner || !GROUP_ROLES.includes(r)) && (gaming || !GAMING_ONLY.includes(r)) && (parts || !PARTS_ONLY.includes(r)) && kind(r));
};

/** Owners and admins manage the team and the outlets (the server insists on the 'settings' permission and, for outlets, a group-level person). */
export const canManageTeam = (role: string | undefined): boolean => role === 'OWNER' || role === 'ADMIN';
/** The business types the website offers Outlets for. */
export const OUTLET_TYPES = ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN', 'HOTEL', 'GAMING_CAFE', 'RACING', 'WHOLESALE', 'DISTRIBUTOR', 'PHARMACY'];

/* ── people ──────────────────────────────────────────────────────────────── */
export type Person = { user_id: number; name: string; email: string; phone?: string | null; role: string; status: string; branch_id: number | null; branch_name: string | null; is_you: boolean; custom_permissions: number };
/** Roles the server has that nobody can be given from the website or the phone yet (hotel banquet and HR): shown by name when someone already has one. */
const DISPLAY_ONLY: Record<string, string> = { BANQUET_MANAGER: 'Banquet manager', HR_MANAGER: 'HR manager' };
export const roleLabel = (role: string): string => ROLES[role] ?? DISPLAY_ONLY[role] ?? role;
export const statusLabel = (status: string): string => (status === 'ACTIVE' ? 'Active' : status === 'DISABLED' ? 'Disabled' : 'Invited');

/** Can the person signed in change this one? Never themselves; an admin never an owner or admin. */
export const canEditPerson = (me: { role?: string }, p: Pick<Person, 'is_you' | 'role'>): boolean => !p.is_you && (me.role === 'OWNER' || !GROUP_ROLES.includes(p.role));

/** What the server takes: owners and admins have no outlet; everyone else gets the one chosen ('' = every outlet, for a group-level manager). */
export const outletFor = (role: string, branchId: number | '' | null): number | '' | undefined => (GROUP_ROLES.includes(role) ? undefined : branchId === '' || branchId == null ? '' : Number(branchId));

export const addPersonBody = (f: { name: string; email: string; role: string; branch_id: number | '' | null }) =>
  ({ name: f.name.trim(), email: f.email.trim(), role: f.role, branch_id: outletFor(f.role, f.branch_id) });
export const editPersonBody = (f: { role: string; status: string; branch_id: number | '' | null }) =>
  ({ role: f.role, status: f.status, branch_id: outletFor(f.role, f.branch_id) ?? '' });

/** A floor role must have an outlet, so the form insists on one when there are several. */
export const needsOutlet = (role: string): boolean => FLOOR_ROLES.includes(role);

/* ── permissions ─────────────────────────────────────────────────────────── */
export type PermissionRow = { key: string; label: string; role_default: boolean; override: boolean | null };
export type Choice = 'default' | 'allow' | 'deny';
export const choiceOf = (p: PermissionRow): Choice => (p.override === null || p.override === undefined ? 'default' : p.override ? 'allow' : 'deny');
export const effective = (p: PermissionRow, c: Choice): boolean => (c === 'allow' ? true : c === 'deny' ? false : p.role_default);
/** Every row goes back: true, false, or null for "the role's default". */
export const permissionsBody = (rows: PermissionRow[], choices: Record<string, Choice>): { permissions: Record<string, boolean | null> } =>
  ({ permissions: Object.fromEntries(rows.map((p) => [p.key, choices[p.key] === 'allow' ? true : choices[p.key] === 'deny' ? false : null])) });

/* ── outlets ─────────────────────────────────────────────────────────────── */
export type Outlet = { branch_id: number; name: string; code: string | null; address: string | null; phone: string | null; city: string | null; state: string | null; gstin: string | null; pincode: string | null; is_primary: boolean; status: string; invoice_prefix: string | null; invoice_next_number: number };
export const OUTLET_FIELDS = ['name', 'code', 'city', 'state', 'phone', 'address', 'pincode', 'gstin', 'invoice_prefix', 'invoice_next_number'] as const;
export type OutletKey = typeof OUTLET_FIELDS[number];
export type OutletForm = Record<OutletKey, string>;
export const emptyOutlet = (): OutletForm => Object.fromEntries(OUTLET_FIELDS.map((k) => [k, ''])) as OutletForm;
export const outletForm = (o: Outlet): OutletForm => Object.fromEntries(OUTLET_FIELDS.map((k) => [k, String(o[k] ?? '')])) as OutletForm;
/** The next number only goes with a prefix (the server refuses one without); everything else is sent as typed and checked there. */
export const outletBody = (f: OutletForm) => ({ ...f, invoice_next_number: f.invoice_prefix.trim() && f.invoice_next_number.trim() !== '' ? Number(f.invoice_next_number) : undefined });
export const seriesText = (o: Pick<Outlet, 'invoice_prefix' | 'invoice_next_number'>): string => (o.invoice_prefix ? `${o.invoice_prefix}-${String(o.invoice_next_number).padStart(4, '0')} next` : 'Business series');

export type CompareRow = { branch_id: number; name: string; orders: number; net_revenue: number; average_order: number | null; contribution: number; estimated_net: number };
/** The outlet with the most revenue, when at least two outlets traded (the website marks the best one the same way). */
export const topOutlet = (rows: CompareRow[]): number | null => {
  const traded = rows.filter((r) => r.orders > 0);
  return traded.length < 2 ? null : traded.reduce((a, b) => (b.net_revenue > a.net_revenue ? b : a)).branch_id;
};

/** Every fixed text on these screens, so the language tests can check each is translated. */
export const TEAM_TEXTS: string[] = [
  'Staff', 'Outlets', 'Who can sign in, what they can do, and where.', 'Managing staff is for owners and admins.', 'Only owners and admins can manage this.', 'Add person', 'No one yet.', 'You', 'Active', 'Disabled', 'Invited', 'Every outlet', 'Permissions', 'Name', 'Email', 'They get a link to set their own password.', 'Role', 'Outlet', 'Choose an outlet', 'They can only see and work in this outlet.', 'Leave on "Every outlet" for a group-level manager.', 'Access', 'Disabled: can\'t sign in to this business', '{role}s can see every outlet.', 'Sent {email} a link to set their password', '{email} now has access', 'Added', 'Enter a name and an email.', 'Save changes', 'Not found', 'Could not load.', 'Could not save. Check the connection and try again.', 'Role default (can)', 'Role default (can\'t)', 'Allow', 'Deny', 'Save permissions', 'Each row starts from what the role allows; change one only when this person should differ.', 'Owners always have every permission.', 'Add outlet', 'Enter the outlet name.', 'Outlet name', 'Short code', 'Optional', 'City', 'State', 'Phone', 'Address', 'Pincode', 'GSTIN', 'Invoice prefix', 'Next number', 'Decides GST place of supply for this outlet.', 'For GST e-invoices and e-way bills', 'Optional. Gives this outlet its own numbers (IND-0001). Empty uses the business-wide series.', 'Only if this outlet has its own registration.', 'Never lower than numbers already issued.', 'No outlets yet.', 'Main', 'Open', 'Closed', 'Business series', '{series} next', 'Business GSTIN', 'Close this outlet', 'Reopen this outlet', 'Closing an outlet needs its stock moved out and its open orders settled first.', 'Show closed outlets', 'Hide closed outlets', 'Compare', 'Net revenue', 'Orders', 'Estimated net', 'Avg order', 'Comparing outlets is for owners and group managers.', 'Adding up each outlet', 'The best outlet this period', '7 days', '30 days', '90 days', 'Back', 'Cancel'
];
