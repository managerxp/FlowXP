/*
 * Who may do what in the Super Admin console. The owner (the account that was made a super admin first) can do everything; staff get one of the roles below.
 * A permission is a screen or a kind of action; every admin route names the one it needs (routes/admin.routes.js), and the console hides what a role cannot use.
 */
export const PERMISSIONS = {
  overview: 'See the overview',
  revenue: 'See revenue figures',
  customers: 'See and look after businesses (notes, follow-ups, trials)',
  manage: 'Change a business: status, plan, features, outlets',
  payments: 'Create payment links, mark them paid and send receipts',
  billing: 'Make and send invoices and quotations',
  support: 'Answer support tickets',
  people: 'Look after sign-ins: sign out, verify email, reset two-step',
  messaging: 'WhatsApp usage and credit',
  bugs: 'Bug reports and crashes',
  owner: 'Plans, features, add-ons, settings, staff, deletions, audit'
};

export const ROLES = {
  OWNER: { label: 'Owner', about: 'Everything, including staff, plans and settings.', can: Object.keys(PERMISSIONS) },
  ONBOARDING: { label: 'Onboarding', about: 'Gets new businesses started: looks after them, sends invoices and payment links, marks cash payments and sends receipts. Cannot see revenue or change plans.', can: ['overview', 'customers', 'payments', 'billing', 'support'] },
  ACCOUNTS: { label: 'Accounts', about: 'Money: revenue, payment links, cash payments, receipts and invoices.', can: ['overview', 'revenue', 'customers', 'payments', 'billing', 'messaging'] },
  SUPPORT: { label: 'Support', about: 'Helps customers: tickets, sign-in problems, bug reports.', can: ['overview', 'customers', 'support', 'people', 'bugs'] }
};

export const roleOf = (user) => (user?.is_super_admin && !user.admin_disabled ? (ROLES[user.admin_role] ? user.admin_role : 'OWNER') : null);
export const permissionsOf = (user) => { const r = roleOf(user); return r ? ROLES[r].can : []; };
export const can = (user, permission) => permissionsOf(user).includes(permission);
