/* Distributor set-up on the phone: principals, territories and beats, vans, schemes, the sales team, targets, commission rules, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIST_SETUP_TEXTS, beatBody, beatForm, beatProblem, beatSub, brandProblem, emptyBeat, emptyPrincipal, emptyVehicle, flattenTerritories, placeBody, placePath, placeProblem, placeSub, principalBody, principalForm, principalProblem, principalSub,
  vehicleBody, vehicleForm, vehicleProblem, vehicleSub, type Beat, type Principal, type Territory, type Vehicle
} from '../src/lib/distributorSetup.ts';
import {
  DIST_SALES_TEXTS, announceText, emptyMember, emptyRule, emptyScheme, emptyTarget, memberBody, memberForm, memberProblem, memberSub, ruleBody, ruleForm, ruleProblem, ruleSub, schemeBody, schemeForm, schemeProblem, schemeSub, targetBody, targetProblem, targetSub,
  type Member, type Rule, type SchemeFull, type SchemeRow, type Target
} from '../src/lib/distributorSales.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const principal: Principal = { principal_id: 1, name: 'Parle', company_name: 'Parle Products', contact_person: 'Anil', phone: '9876543210', email: null, gstin: '36AABCP1234F1Z5', pan: null, address: null, territory_note: null, agreement_start: '2026-04-01T00:00:00Z', agreement_end: '2027-03-31', agreement_status: 'ACTIVE', margin_pct: '4.50', payment_terms_days: 30, credit_limit: 500000, notes: null, status: 'ACTIVE', brands: 3, products: 40, payable: 125000 };

test('principals: round trip, checks, body, line', () => {
  const f = principalForm(principal);
  assert.equal(f.agreement_start, '2026-04-01'); assert.equal(f.email, ''); assert.equal(principalProblem(f), '');
  const b = principalBody({ ...f, name: ' Parle G ', gstin: '36aabcp1234f1z5', credit_limit: '' });
  assert.equal(b.name, 'Parle G'); assert.equal(b.gstin, '36AABCP1234F1Z5'); assert.equal(b.credit_limit, 0); assert.equal(b.payment_terms_days, 30); assert.equal(principalBody({ ...f, agreement_end: '' }).agreement_end, null);
  assert.notEqual(principalProblem({ ...f, name: 'A' }), ''); assert.notEqual(principalProblem({ ...f, gstin: '123' }), ''); assert.notEqual(principalProblem({ ...f, pan: 'x' }), ''); assert.notEqual(principalProblem({ ...f, email: 'x' }), '');
  assert.notEqual(principalProblem({ ...f, agreement_end: '2026-01-01' }), ''); assert.notEqual(principalProblem({ ...f, agreement_start: '2026-13-01' }), ''); assert.notEqual(principalProblem({ ...f, margin_pct: '101' }), ''); assert.notEqual(principalProblem({ ...f, payment_terms_days: '2.5' }), '');
  assert.equal(principalProblem(emptyPrincipal()), 'Give the principal a name'); assert.equal(brandProblem('A'), 'Give the brand a name');
  assert.equal(principalSub(principal), 'In force · Anil · 9876543210 · 3 brands · 40 products · You owe ₹1,25,000.00');
});

test('territories and beats', () => {
  const list: Territory[] = [
    { territory_id: 3, name: 'Ameerpet', code: null, level: 'AREA', parent_id: 2, status: 'ACTIVE', customers: 12, beats: 1, salespeople: 1 },
    { territory_id: 1, name: 'Hyderabad', code: 'HYD', level: 'REGION', parent_id: null, status: 'ACTIVE', customers: 40, beats: 2, salespeople: 3 },
    { territory_id: 2, name: 'Central', code: null, level: 'TERRITORY', parent_id: 1, status: 'INACTIVE', customers: 20, beats: 0, salespeople: 0 }
  ];
  assert.deepEqual(flattenTerritories(list).map((x) => `${x.depth}:${x.place.name}`), ['0:Hyderabad', '1:Central', '2:Ameerpet']); assert.equal(placePath(list, 3), 'Hyderabad › Central › Ameerpet');
  assert.equal(placeSub(list[1]), 'Region · 40 shops · 2 beats'); assert.equal(placeSub(list[2]), 'Territory · 20 shops · Inactive'); assert.equal(placeProblem(' '), 'Give the place a name');
  assert.deepEqual(placeBody(' North ', ''), { name: 'North', code: null }); assert.deepEqual(placeBody('North', 'N', 'TERRITORY', 1), { name: 'North', code: 'N', level: 'TERRITORY', parent_id: 1 });
  const beat: Beat = { beat_id: 9, name: 'Monday Ameerpet', weekday: 1, weekday_name: 'Monday', territory_id: 3, territory: 'Ameerpet', salesperson_id: 4, salesperson: 'Ravi', customers: 18, status: 'ACTIVE' };
  const f = beatForm(beat);
  assert.equal(beatProblem(f), ''); assert.deepEqual(beatBody(f, true), { name: 'Monday Ameerpet', weekday: 1, territory_id: 3, salesperson_id: 4, status: 'ACTIVE' }); assert.equal('status' in beatBody(f, false), false);
  assert.equal(beatBody({ ...emptyBeat(), name: 'Any' }, false).weekday, null); assert.equal(beatBody({ ...f, weekday: '0' }, true).weekday, 0); assert.notEqual(beatProblem({ ...f, name: '' }), '');
  assert.equal(beatSub(beat), 'Monday · Ameerpet · Ravi · 18 shops'); assert.equal(beatSub({ ...beat, weekday_name: null, salesperson: null }), 'Any day · Ameerpet · Unassigned · 18 shops');
});

test('vans', () => {
  const v: Vehicle = { vehicle_id: 2, vehicle_no: 'TS09UB1234', branch_id: 7, warehouse: 'Main', driver_name: 'Raju', driver_user_id: null, salesperson_id: 4, salesperson: 'Ravi', route: 'Ameerpet', capacity_kg: 800, notes: null, status: 'ACTIVE', items: 5, stock_value: 12000 };
  const f = vehicleForm(v);
  assert.equal(vehicleProblem(f), ''); assert.deepEqual(vehicleBody({ ...f, vehicle_no: ' ts09ub1234 ', route: '' }, true), { vehicle_no: 'TS09UB1234', branch_id: 7, driver_name: 'Raju', salesperson_id: 4, route: null, capacity_kg: 800, status: 'ACTIVE' });
  assert.equal('status' in vehicleBody(f, false), false); assert.equal(vehicleBody(emptyVehicle(), false).branch_id, undefined); assert.equal(emptyVehicle(3).branch_id, '3');
  assert.notEqual(vehicleProblem({ ...f, vehicle_no: 'AB' }), ''); assert.notEqual(vehicleProblem({ ...f, capacity_kg: 'x' }), '');
  assert.equal(vehicleSub(v), 'Raju · Ravi · Main · 5 items on board, worth ₹12,000.00'); assert.equal(vehicleSub({ ...v, items: 0, driver_name: null, salesperson: null, status: 'INACTIVE' }), 'Main · Empty · Inactive');
});

const full: SchemeFull = { name: 'Buy 10 get 1', kind: 'BUY_X_GET_Y', funded_by: 'DISTRIBUTOR', principal_id: null, buy_scope: 'PRODUCT', buy_product_id: 5, buy_brand_id: null, buy_category_id: null, buy_principal_id: null, buy_scope_name: 'Parle G 800g', buy_min_qty: 10, min_value: null, free_qty: 1, free_product_id: null, free_product: null, repeat: true, max_free_qty: null, discount_pct: null, discount: null, customer_types: ['RETAILER'], starts_on: '2026-11-01T00:00:00Z', ends_on: null, is_active: true, stackable: false, priority: 0, notes: null };

test('schemes: round trip, checks per type, body', () => {
  const f = schemeForm(full);
  assert.equal(f.scope, 'PRODUCT'); assert.equal(f.scope_id, '5'); assert.equal(f.starts_on, '2026-11-01'); assert.equal(schemeProblem(f), '');
  const b = schemeBody(f);
  assert.equal(b.buy_scope_id, 5); assert.equal(b.free_product_id, null); assert.equal(b.free_qty, 1); assert.equal(b.discount_pct, null); assert.equal(b.min_value, null); assert.equal(b.buy_unit_name, undefined); assert.deepEqual(b.customer_types, ['RETAILER']);
  assert.equal(schemeBody({ ...f, scope: 'BRAND', scope_id: '3' }).buy_unit_name, null);
  assert.notEqual(schemeProblem({ ...f, name: 'x' }), ''); assert.notEqual(schemeProblem({ ...f, buy_min_qty: '' }), ''); assert.notEqual(schemeProblem({ ...f, free_qty: '0' }), ''); assert.notEqual(schemeProblem({ ...f, scope: 'BRAND', scope_id: '' }), '');
  assert.notEqual(schemeProblem({ ...f, scope: 'BRAND', scope_id: '3', free_id: '' }), ''); assert.equal(schemeProblem({ ...f, scope: 'BRAND', scope_id: '3', free_id: '8' }), ''); assert.notEqual(schemeProblem({ ...f, funded_by: 'PRINCIPAL' }), '');
  assert.notEqual(schemeProblem({ ...f, ends_on: '2026-10-01' }), ''); assert.notEqual(schemeProblem({ ...f, starts_on: 'x' }), ''); assert.notEqual(schemeProblem({ ...f, priority: '500' }), '');
  const q = { ...f, kind: 'QTY_DISCOUNT', discount_pct: '5' };
  assert.equal(schemeProblem(q), ''); assert.equal(schemeBody(q).discount_pct, 5); assert.equal(schemeBody(q).free_qty, null); assert.notEqual(schemeProblem({ ...q, discount_pct: '101' }), '');
  const v = { ...emptyScheme(), name: 'Big order', kind: 'VALUE_DISCOUNT', min_value: '50000', discount: '2000' };
  assert.equal(schemeProblem(v), ''); assert.deepEqual([schemeBody(v).discount, schemeBody(v).discount_pct, schemeBody(v).buy_min_qty, schemeBody(v).min_value], [2000, null, null, 50000]);
  assert.equal(schemeBody({ ...v, value_mode: 'PERCENT', discount_pct: '3' }).discount_pct, 3); assert.notEqual(schemeProblem({ ...v, discount: '' }), ''); assert.notEqual(schemeProblem({ ...v, min_value: '' }), '');
  assert.equal(schemeForm({ ...full, kind: 'VALUE_DISCOUNT', discount: 2000 }).value_mode, 'AMOUNT'); assert.equal(schemeForm({ ...full, kind: 'VALUE_DISCOUNT', discount_pct: 4 }).value_mode, 'PERCENT');
  const row: SchemeRow = { scheme_id: 1, name: 'x', kind: 'BUY_X_GET_Y', funded_by: 'PRINCIPAL', principal: 'Parle', starts_on: null, ends_on: '2026-11-05', status: 'ACTIVE', days_left: 3, orders: 12, cost: 4500, description: '', is_active: true };
  assert.equal(schemeSub(row), 'Running · Buy X, get Y free · Funded by Parle · 3 days left · 12 bills · Cost ₹4,500.00');
  assert.equal(announceText({ sent: 8, qualifying: 10 }), '8 of 10 shops were messaged'); assert.match(announceText({ sent: 8, qualifying: 10, skipped: 2 }), /2 skipped/);
});

test('sales team, targets and commission rules', () => {
  const m: Member = { salesperson_id: 4, name: 'Ravi', phone: '98', email: null, employee_id: 'E1', sales_role: 'FIELD_SALES', territory_id: 3, territory: 'Ameerpet', manager_id: null, commission_pct: 1.5, status: 'ACTIVE', customers: 30, beats: 2, month_sales: 250000, month_target: 500000, achievement_pct: 50 };
  const f = memberForm(m);
  assert.equal(f.commission_on, ''); assert.equal(memberProblem(f), ''); assert.equal('commission_on' in memberBody(f, true), false); assert.equal(memberBody({ ...f, commission_on: 'COLLECTIONS' }, true).commission_on, 'COLLECTIONS'); assert.equal(memberBody(emptyMember(), false).commission_on, 'SALES');
  assert.deepEqual([memberBody(f, true).territory_id, memberBody(f, true).manager_id, memberBody(f, true).commission_pct], [3, null, 1.5]);
  assert.notEqual(memberProblem({ ...f, name: 'R' }), ''); assert.notEqual(memberProblem({ ...f, email: 'x' }), ''); assert.notEqual(memberProblem({ ...f, commission_pct: '101' }), '');
  assert.equal(memberSub(m), 'Field sales representative · Ameerpet · 30 shops · 2 beats · ₹2,50,000.00 of ₹5,00,000.00 this month');
  const t0 = { ...emptyTarget('2026-11-01'), scope_id: '4', target: '500000' };
  assert.equal(targetProblem(t0), ''); assert.deepEqual(targetBody(t0), { scope_type: 'SALESPERSON', scope_id: 4, period_type: 'MONTHLY', date: '2026-11-01', metric: 'VALUE', target: 500000 });
  assert.equal(targetBody({ ...t0, scope_type: 'BUSINESS', scope_id: '' }).scope_id, null); assert.equal(targetProblem({ ...t0, scope_type: 'BUSINESS', scope_id: '' }), ''); assert.notEqual(targetProblem({ ...t0, scope_id: '' }), ''); assert.notEqual(targetProblem({ ...t0, target: '' }), ''); assert.notEqual(targetProblem({ ...t0, date: 'x' }), '');
  const target: Target = { target_id: 1, scope_type: 'SALESPERSON', scope_name: 'Ravi', period_start: '2026-11-01', period_end: '2026-11-30', metric: 'VALUE', target: 500000, actual: 250000, achievement_pct: 50, remaining: 250000, days_left: 10, required_per_day: 25000, status: 'ON_TRACK' };
  assert.equal(targetSub(target), '2026-11-01 → 2026-11-30 · ₹2,50,000.00 of ₹5,00,000.00 · 50%');
  const rule: Rule = { rule_id: 1, name: '2%', basis: 'VALUE', rate_pct: 2, per_unit: null, scope_type: 'BRAND', scope_id: 5, scope_name: 'Parle', salesperson_id: null, min_achievement_pct: 80, starts_on: null, ends_on: null, priority: 0, is_active: false };
  const rf = ruleForm(rule);
  assert.equal(ruleProblem(rf), ''); assert.deepEqual([(ruleBody(rf) as Record<string, unknown>).rate_pct, 'per_unit' in ruleBody(rf), ruleBody(rf).scope_id, ruleBody(rf).min_achievement_pct], [2, false, 5, 80]);
  const q = { ...emptyRule(), name: 'Per unit', basis: 'QTY', per_unit: '3' };
  assert.equal(ruleProblem(q), ''); assert.equal((ruleBody(q) as Record<string, unknown>).per_unit, 3); assert.equal('rate_pct' in ruleBody(q), false); assert.equal(ruleBody(q).scope_id, null);
  assert.notEqual(ruleProblem({ ...rf, name: '' }), ''); assert.notEqual(ruleProblem({ ...rf, rate_pct: '' }), ''); assert.notEqual(ruleProblem({ ...rf, scope_id: '' }), ''); assert.notEqual(ruleProblem({ ...q, per_unit: '' }), ''); assert.notEqual(ruleProblem({ ...rf, ends_on: '2026-01-01', starts_on: '2026-02-01' }), '');
  assert.equal(ruleSub(rule), '2% of sales · Parle · once target is 80% · Off'); assert.equal(ruleSub({ ...rule, basis: 'QTY', per_unit: 3, scope_type: 'ALL', min_achievement_pct: null, is_active: true }), '₹3.00 a unit · Everything');
});

test('every text of the distributor set-up screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set([...DIST_SETUP_TEXTS, ...DIST_SALES_TEXTS])) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
