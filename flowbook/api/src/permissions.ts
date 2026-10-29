/* What each role may do. Routes ask for a permission, never for a role, so a new role is a row here and nothing else. */
export const ROLES = ['owner', 'admin', 'accountant', 'sales', 'purchases', 'viewer', 'auditor'] as const;
export type Role = (typeof ROLES)[number];

const READ = ['org.read', 'accounts.read', 'journal.read', 'report.read', 'party.read', 'item.read', 'invoice.read', 'bill.read', 'payment.read'];
const BOOKS = ['accounts.write', 'journal.post', 'journal.reverse', 'period.manage', 'tax.manage', 'party.write', 'item.write',
  'invoice.write', 'invoice.void', 'bill.write', 'bill.void', 'payment.write', 'payment.void'];

export const PERMISSIONS: Record<Role, ReadonlySet<string>> = {
  owner: new Set([...READ, ...BOOKS, 'period.override', 'audit.read', 'members.manage', 'org.manage', 'integration.manage']),
  admin: new Set([...READ, ...BOOKS, 'audit.read', 'members.manage', 'org.manage', 'integration.manage']),
  accountant: new Set([...READ, ...BOOKS, 'period.override', 'audit.read']),
  sales: new Set(['org.read', 'accounts.read', 'party.read', 'party.write', 'item.read', 'invoice.read', 'invoice.write', 'payment.read']),
  purchases: new Set(['org.read', 'accounts.read', 'party.read', 'party.write', 'item.read', 'bill.read', 'bill.write', 'payment.read']),
  viewer: new Set(READ),
  auditor: new Set([...READ, 'audit.read'])
};

export const can = (role: Role, permission: string): boolean => PERMISSIONS[role].has(permission);
