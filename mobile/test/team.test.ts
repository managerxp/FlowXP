/* Staff and outlets on the phone: which roles each kind of business can give, who may edit whom, and what is sent to the server. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOOR_ROLES, GROUP_ROLES, OUTLET_TYPES, ROLES, ROLE_HELP, TEAM_TEXTS, addPersonBody, canEditPerson, canManageTeam, choiceOf, editPersonBody, effective, emptyOutlet, needsOutlet, outletBody, outletForm, outletFor,
  permissionsBody, roleLabel, rolesFor, seriesText, statusLabel, topOutlet, type Outlet, type PermissionRow
} from '../src/lib/team.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('every role has a name and a help line, and a floor role is a known role', () => {
  for (const r of Object.keys(ROLES)) assert.ok(ROLE_HELP[r], `${r} has no help text`);
  for (const r of [...FLOOR_ROLES, ...GROUP_ROLES]) assert.ok(ROLES[r], `${r} is not a role`);
  assert.equal(roleLabel('CASHIER'), 'Cashier'); assert.equal(roleLabel('HR_MANAGER'), 'HR manager'); assert.equal(roleLabel('SOMETHING_NEW'), 'SOMETHING_NEW');
  assert.equal(statusLabel('ACTIVE'), 'Active'); assert.equal(statusLabel('DISABLED'), 'Disabled'); assert.equal(statusLabel('INVITED'), 'Invited');
});

test('a business is offered only the roles that make sense for it, and an admin never the top roles', () => {
  const rest = rolesFor('RESTAURANT', true);
  assert.ok(rest.includes('WAITER') && rest.includes('KITCHEN') && rest.includes('OWNER')); assert.ok(!rest.includes('STYLIST') && !rest.includes('PHARMACIST') && !rest.includes('FIELD_SALES') && !rest.includes('TRAINER') && !rest.includes('GAMING_ATTENDANT') && !rest.includes('STOREKEEPER'));
  const salon = rolesFor('SALON', true); assert.ok(salon.includes('STYLIST') && salon.includes('RECEPTIONIST')); assert.ok(!salon.includes('WAITER') && !salon.includes('KITCHEN') && !salon.includes('DELIVERY'));
  const pharmacy = rolesFor('PHARMACY', true); assert.ok(pharmacy.includes('PHARMACIST') && pharmacy.includes('GRN_MANAGER')); assert.ok(!pharmacy.includes('WAITER'));
  const hotel = rolesFor('HOTEL', true); assert.ok(hotel.includes('FRONT_DESK') && hotel.includes('NIGHT_AUDITOR') && hotel.includes('WAITER')); assert.ok(!hotel.includes('STYLIST'));
  assert.ok(rolesFor('GYM', true).includes('TRAINER') && !rolesFor('GYM', true).includes('WAITER'));
  assert.ok(rolesFor('GAMING_CAFE', true).includes('GAMING_ATTENDANT') && !rolesFor('RESTAURANT', true).includes('GAMING_ATTENDANT'));
  assert.ok(rolesFor('AUTO_PARTS', true).includes('PARTS_COUNTER') && !rolesFor('RESTAURANT', true).includes('PARTS_COUNTER'));
  // a wholesaler gets the distributor roles only once the distributor features are on
  assert.ok(rolesFor('WHOLESALE', true).includes('SALES_MANAGER') && !rolesFor('WHOLESALE', true).includes('FIELD_SALES'));
  assert.ok(rolesFor('WHOLESALE', true, true).includes('FIELD_SALES') && !rolesFor('WHOLESALE', true, true).includes('WAITER'));
  assert.deepEqual(rolesFor('RESTAURANT', false).filter((r) => GROUP_ROLES.includes(r)), []);
  assert.ok(!rolesFor(undefined, true).includes('STYLIST'));
});

test('who may manage the team, and who may be edited by whom', () => {
  assert.equal(canManageTeam('OWNER'), true); assert.equal(canManageTeam('ADMIN'), true); assert.equal(canManageTeam('MANAGER'), false); assert.equal(canManageTeam(undefined), false);
  assert.equal(canEditPerson({ role: 'OWNER' }, { is_you: true, role: 'OWNER' }), false, 'nobody edits themselves');
  assert.equal(canEditPerson({ role: 'OWNER' }, { is_you: false, role: 'ADMIN' }), true); assert.equal(canEditPerson({ role: 'ADMIN' }, { is_you: false, role: 'ADMIN' }), false);
  assert.equal(canEditPerson({ role: 'ADMIN' }, { is_you: false, role: 'CASHIER' }), true);
  assert.ok(OUTLET_TYPES.includes('RESTAURANT') && !OUTLET_TYPES.includes('SALON'));
});

test('what is sent when adding or changing a person: owners and admins have no outlet, others get the one chosen', () => {
  assert.equal(outletFor('ADMIN', 5), undefined); assert.equal(outletFor('CASHIER', 5), 5); assert.equal(outletFor('MANAGER', ''), ''); assert.equal(outletFor('CASHIER', null), '');
  assert.deepEqual(addPersonBody({ name: ' Asha ', email: ' a@b.test ', role: 'CASHIER', branch_id: 7 }), { name: 'Asha', email: 'a@b.test', role: 'CASHIER', branch_id: 7 });
  assert.deepEqual(editPersonBody({ role: 'ADMIN', status: 'DISABLED', branch_id: 7 }), { role: 'ADMIN', status: 'DISABLED', branch_id: '' });
  assert.equal(needsOutlet('CASHIER'), true); assert.equal(needsOutlet('MANAGER'), false);
});

test('permissions: a row is the role default, allowed or denied, and every row goes back', () => {
  const rows: PermissionRow[] = [{ key: 'refunds', label: 'Refunds', role_default: false, override: null }, { key: 'billing', label: 'Billing', role_default: true, override: false }, { key: 'reports', label: 'Reports', role_default: false, override: true }];
  assert.deepEqual(rows.map(choiceOf), ['default', 'deny', 'allow']);
  assert.equal(effective(rows[0], 'default'), false); assert.equal(effective(rows[0], 'allow'), true); assert.equal(effective(rows[1], 'deny'), false); assert.equal(effective(rows[1], 'default'), true);
  assert.deepEqual(permissionsBody(rows, { refunds: 'allow', billing: 'default', reports: 'deny' }), { permissions: { refunds: true, billing: null, reports: false } });
});

test('outlets: the form mirrors the record, the next number only goes with a prefix, and the series reads plainly', () => {
  const o: Outlet = { branch_id: 3, name: 'Indiranagar', code: 'IND', address: null, phone: '98', city: 'Bengaluru', state: 'Karnataka', gstin: null, pincode: '560038', is_primary: false, status: 'ACTIVE', invoice_prefix: 'IND', invoice_next_number: 12 };
  const f = outletForm(o);
  assert.equal(f.name, 'Indiranagar'); assert.equal(f.address, ''); assert.equal(f.invoice_next_number, '12'); assert.deepEqual(Object.keys(emptyOutlet()), Object.keys(f));
  assert.equal(outletBody(f).invoice_next_number, 12); assert.equal(outletBody({ ...f, invoice_prefix: '' }).invoice_next_number, undefined); assert.equal(outletBody({ ...f, invoice_next_number: '' }).invoice_next_number, undefined);
  assert.equal(seriesText(o), 'IND-0012 next'); assert.equal(seriesText({ invoice_prefix: null, invoice_next_number: 1 }), 'Business series');
});

test('the comparison marks the top outlet only when at least two traded', () => {
  const row = (id: number, orders: number, rev: number) => ({ branch_id: id, name: `O${id}`, orders, net_revenue: rev, average_order: null, contribution: 0, estimated_net: 0 });
  assert.equal(topOutlet([row(1, 5, 100), row(2, 3, 300), row(3, 0, 0)]), 2); assert.equal(topOutlet([row(1, 5, 100), row(2, 0, 0)]), null); assert.equal(topOutlet([]), null);
});

test('every text on the staff and outlet screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(TEAM_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
