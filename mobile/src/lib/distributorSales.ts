/* Distributor set-up on the phone, part two: schemes, the sales team, targets and commission rules. Pure helpers, no screens. */
import { t } from './i18n.ts';
import { rupees, toPaise } from './money.ts';

const whole = (s: string): boolean => /^-?\d+$/.test(s.trim());
const amount = (s: string): boolean => s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) >= 0;
const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const day = (s: string | null | undefined): string => (s ? String(s).slice(0, 10) : '');
const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));
const money = (n: number): string => rupees(toPaise(n));

/* ── schemes ─────────────────────────────────────────────────────────────── */
export const SCHEME_KIND_LABEL: Record<string, string> = { BUY_X_GET_Y: 'Buy X, get Y free', QTY_DISCOUNT: 'Quantity discount', VALUE_DISCOUNT: 'Value discount' };
export const SCHEME_STATUS_LABEL: Record<string, string> = { ACTIVE: 'Running', UPCOMING: 'Starts soon', EXPIRED: 'Ended', INACTIVE: 'Switched off' };
export const SCOPE_LABEL: Record<string, string> = { ALL: 'The whole order', PRODUCT: 'One product', BRAND: 'A brand', CATEGORY: 'A category', PRINCIPAL: "A principal's products" };
export const CUSTOMER_TYPE_CHOICES: { id: string; label: string }[] = [{ id: 'RETAILER', label: 'Retailer' }, { id: 'DEALER', label: 'Dealer' }, { id: 'DISTRIBUTOR', label: 'Distributor' }, { id: 'BUSINESS', label: 'Business' }, { id: 'CORPORATE', label: 'Corporate' }, { id: 'OTHER', label: 'Other' }];

export type SchemeRow = { scheme_id: number; name: string; kind: string; funded_by: string; principal: string | null; starts_on: string | null; ends_on: string | null; status: string; days_left: number | null; orders: number; cost: number; description: string; is_active: boolean };
export type SchemeFull = {
  name: string; kind: string; funded_by: string; principal_id: number | null; buy_scope: string; buy_product_id: number | null; buy_brand_id: number | null; buy_category_id: number | null; buy_principal_id: number | null; buy_scope_name: string | null;
  buy_min_qty: number | null; min_value: number | null; free_qty: number | null; free_product_id: number | null; free_product: string | null; repeat: boolean; max_free_qty: number | null; discount_pct: number | null; discount: number | null;
  customer_types: string[] | null; starts_on: string | null; ends_on: string | null; is_active: boolean; stackable: boolean; priority: number; notes: string | null;
};
export type SchemeForm = {
  name: string; kind: string; funded_by: string; principal_id: string; scope: string; scope_id: string; scope_name: string; buy_min_qty: string; min_value: string; free_qty: string; free_id: string; free_name: string; repeat: boolean;
  max_free_qty: string; discount_pct: string; discount: string; value_mode: 'AMOUNT' | 'PERCENT'; customer_types: string[]; starts_on: string; ends_on: string; is_active: boolean; stackable: boolean; priority: string; notes: string;
};
export const emptyScheme = (): SchemeForm => ({
  name: '', kind: 'BUY_X_GET_Y', funded_by: 'DISTRIBUTOR', principal_id: '', scope: 'ALL', scope_id: '', scope_name: '', buy_min_qty: '', min_value: '', free_qty: '', free_id: '', free_name: '', repeat: true, max_free_qty: '', discount_pct: '', discount: '',
  value_mode: 'AMOUNT', customer_types: [], starts_on: '', ends_on: '', is_active: true, stackable: false, priority: '0', notes: ''
});
const str = (v: number | null | undefined): string => (v == null ? '' : String(v));
export const schemeForm = (s: SchemeFull): SchemeForm => {
  const scopeId = s.buy_product_id ?? s.buy_brand_id ?? s.buy_category_id ?? s.buy_principal_id;
  return {
    name: s.name, kind: s.kind, funded_by: s.funded_by, principal_id: str(s.principal_id), scope: s.buy_scope || 'ALL', scope_id: str(scopeId), scope_name: s.buy_scope_name ?? '', buy_min_qty: str(s.buy_min_qty), min_value: str(s.min_value), free_qty: str(s.free_qty),
    free_id: str(s.free_product_id), free_name: s.free_product ?? '', repeat: s.repeat, max_free_qty: str(s.max_free_qty), discount_pct: str(s.discount_pct), discount: str(s.discount), value_mode: s.discount != null ? 'AMOUNT' : 'PERCENT',
    customer_types: s.customer_types ?? [], starts_on: day(s.starts_on), ends_on: day(s.ends_on), is_active: s.is_active, stackable: s.stackable, priority: String(s.priority ?? 0), notes: s.notes ?? ''
  };
};
const positive = (s: string): boolean => Number(s) > 0 && Number.isFinite(Number(s));
export const schemeProblem = (f: SchemeForm): string => {
  if (f.name.trim().length < 2) return 'Give the scheme a name';
  if (f.funded_by === 'PRINCIPAL' && !f.principal_id) return 'Choose the principal that funds this scheme';
  if (f.scope !== 'ALL' && !f.scope_id) return 'Choose what the scheme applies to';
  if (f.kind === 'BUY_X_GET_Y') {
    if (!positive(f.buy_min_qty)) return 'Enter how much has to be bought';
    if (!positive(f.free_qty)) return 'Enter how much comes free';
    if (!f.free_id && f.scope !== 'PRODUCT') return 'Choose the product that comes free';
  } else if (f.kind === 'QTY_DISCOUNT') {
    if (!positive(f.buy_min_qty)) return 'Enter the quantity that earns the discount';
    if (!positive(f.discount_pct) || Number(f.discount_pct) > 100) return 'Enter the discount percentage';
  } else {
    if (!positive(f.min_value)) return 'Enter the order value that earns the discount';
    if (f.value_mode === 'AMOUNT' ? !positive(f.discount) : !positive(f.discount_pct) || Number(f.discount_pct) > 100) return 'Enter the discount amount or percentage';
  }
  if ((f.starts_on.trim() && !isDate(f.starts_on.trim())) || (f.ends_on.trim() && !isDate(f.ends_on.trim()))) return 'Dates are written like 2026-11-01';
  if (f.starts_on.trim() && f.ends_on.trim() && f.ends_on.trim() < f.starts_on.trim()) return 'The scheme cannot end before it starts';
  if (!whole(f.priority) || Math.abs(Number(f.priority)) > 100) return 'Priority is a whole number from -100 to 100';
  return '';
};
export const schemeBody = (f: SchemeForm) => {
  const bxgy = f.kind === 'BUY_X_GET_Y'; const value = f.kind === 'VALUE_DISCOUNT';
  return {
    name: f.name.trim(), kind: f.kind, funded_by: f.funded_by, principal_id: f.principal_id ? Number(f.principal_id) : null, buy_scope: f.scope, buy_scope_id: f.scope === 'ALL' ? null : Number(f.scope_id),
    buy_unit_name: f.scope === 'PRODUCT' ? undefined : null, buy_min_qty: value ? null : num(f.buy_min_qty), min_value: value ? num(f.min_value) : null,
    free_product_id: bxgy && f.free_id ? Number(f.free_id) : null, free_qty: bxgy ? num(f.free_qty) : null, repeat: f.repeat, max_free_qty: bxgy ? num(f.max_free_qty) : null,
    discount_pct: f.kind === 'QTY_DISCOUNT' || (value && f.value_mode === 'PERCENT') ? num(f.discount_pct) : null, discount: value && f.value_mode === 'AMOUNT' ? num(f.discount) : null,
    customer_types: f.customer_types, starts_on: f.starts_on.trim() || null, ends_on: f.ends_on.trim() || null, is_active: f.is_active, stackable: f.stackable, priority: Number(f.priority) || 0, notes: f.notes.trim() || null
  };
};
export const schemeSub = (s: SchemeRow): string => [
  t(SCHEME_STATUS_LABEL[s.status] ?? s.status), t(SCHEME_KIND_LABEL[s.kind] ?? s.kind), s.funded_by === 'PRINCIPAL' ? t('Funded by {name}', { name: s.principal || t('a principal') }) : '',
  s.status === 'ACTIVE' && s.days_left != null && s.days_left <= 7 ? t('{n} days left', { n: s.days_left }) : '', t('{n} bills', { n: s.orders }), t('Cost {value}', { value: money(s.cost) })
].filter(Boolean).join(' · ');
export const announceText = (r: { sent: number; qualifying: number; skipped?: number }): string =>
  r.skipped ? t('{sent} of {total} shops were messaged; {skipped} skipped (messaging off, no number, or opted out)', { sent: r.sent, total: r.qualifying, skipped: r.skipped }) : t('{sent} of {total} shops were messaged', { sent: r.sent, total: r.qualifying });

/* ── the sales team ──────────────────────────────────────────────────────── */
export const ROLE_CHOICES: { id: string; label: string }[] = [
  { id: 'SALES_MANAGER', label: 'Sales manager' }, { id: 'SALES_EXECUTIVE', label: 'Sales executive' }, { id: 'FIELD_SALES', label: 'Field sales representative' }, { id: 'COLLECTION_EXECUTIVE', label: 'Collection executive' }, { id: 'DELIVERY_EXECUTIVE', label: 'Delivery executive' }
];
export type Member = {
  salesperson_id: number; name: string; phone: string | null; email: string | null; employee_id: string | null; sales_role: string; territory_id: number | null; territory: string | null; manager_id: number | null; commission_pct: number; status: string;
  customers: number; beats: number; month_sales: number; month_target: number | null; achievement_pct: number | null;
};
export type MemberForm = { name: string; phone: string; email: string; employee_id: string; sales_role: string; territory_id: string; manager_id: string; commission_pct: string; commission_on: string; status: string };
export const emptyMember = (): MemberForm => ({ name: '', phone: '', email: '', employee_id: '', sales_role: 'SALES_EXECUTIVE', territory_id: '', manager_id: '', commission_pct: '', commission_on: 'SALES', status: 'ACTIVE' });
export const memberForm = (m: Member): MemberForm => ({ name: m.name, phone: m.phone ?? '', email: m.email ?? '', employee_id: m.employee_id ?? '', sales_role: m.sales_role, territory_id: str(m.territory_id), manager_id: str(m.manager_id), commission_pct: String(m.commission_pct ?? ''), commission_on: '', status: m.status });
export const memberProblem = (f: MemberForm): string =>
  f.name.trim().length < 2 ? 'Give the person a name' : f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim()) ? 'That email does not look right' : f.commission_pct.trim() && (!amount(f.commission_pct) || Number(f.commission_pct) > 100) ? 'The commission is a percentage from 0 to 100' : '';
export const memberBody = (f: MemberForm, editing: boolean) => ({
  name: f.name.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null, employee_id: f.employee_id.trim() || null, sales_role: f.sales_role, territory_id: f.territory_id ? Number(f.territory_id) : null,
  manager_id: f.manager_id ? Number(f.manager_id) : null, commission_pct: Number(f.commission_pct) || 0, ...(f.commission_on || !editing ? { commission_on: f.commission_on || 'SALES' } : {}), ...(editing ? { status: f.status } : {})
});
export const memberSub = (m: Member): string => [
  t(ROLE_CHOICES.find((r) => r.id === m.sales_role)?.label ?? m.sales_role), m.territory || '', t('{n} shops', { n: m.customers }), m.beats ? t('{n} beats', { n: m.beats }) : '',
  m.month_target != null ? t('{value} of {target} this month', { value: money(m.month_sales), target: money(m.month_target) }) : t('{value} this month', { value: money(m.month_sales) })
].filter(Boolean).join(' · ');

/* ── targets ─────────────────────────────────────────────────────────────── */
export const TARGET_SCOPE_CHOICES: { id: string; label: string }[] = [{ id: 'BUSINESS', label: 'Whole business' }, { id: 'SALESPERSON', label: 'Salesperson' }, { id: 'TERRITORY', label: 'Territory' }, { id: 'BRAND', label: 'Brand' }, { id: 'CATEGORY', label: 'Category' }];
export const PERIOD_CHOICES: { id: string; label: string }[] = [{ id: 'DAILY', label: 'Daily' }, { id: 'WEEKLY', label: 'Weekly' }, { id: 'MONTHLY', label: 'Monthly' }, { id: 'QUARTERLY', label: 'Quarterly' }, { id: 'YEARLY', label: 'Yearly' }];
export type Target = { target_id: number; scope_type: string; scope_name: string; period_start: string; period_end: string; metric: string; target: number; actual: number; achievement_pct: number | null; remaining: number; days_left: number; required_per_day: number; status: string };
export type TargetForm = { scope_type: string; scope_id: string; period_type: string; date: string; metric: string; target: string };
export const emptyTarget = (today: string): TargetForm => ({ scope_type: 'SALESPERSON', scope_id: '', period_type: 'MONTHLY', date: today, metric: 'VALUE', target: '' });
export const targetProblem = (f: TargetForm): string =>
  f.scope_type !== 'BUSINESS' && !f.scope_id ? 'Choose who or what the target is for' : !isDate(f.date.trim()) ? 'The date is written like 2026-11-01' : !positive(f.target) ? 'Enter the target' : f.metric === 'VALUE' && Number(f.target) < 1 ? 'The target is at least ₹1' : '';
export const targetBody = (f: TargetForm) => ({ scope_type: f.scope_type, scope_id: f.scope_type === 'BUSINESS' ? null : Number(f.scope_id), period_type: f.period_type, date: f.date.trim(), metric: f.metric, target: Number(f.target) });
const figure = (t0: Pick<Target, 'metric'>, v: number): string => (t0.metric === 'QTY' ? String(Math.round(v * 100) / 100) : money(v));
export const targetSub = (x: Target): string => [
  `${day(x.period_start)} → ${day(x.period_end)}`, t('{value} of {target}', { value: figure(x, x.actual), target: figure(x, x.target) }), x.achievement_pct == null ? '' : `${Math.round(x.achievement_pct)}%`
].filter(Boolean).join(' · ');

/* ── commission rules ────────────────────────────────────────────────────── */
export const RULE_SCOPE_CHOICES: { id: string; label: string }[] = [{ id: 'ALL', label: 'Everything' }, { id: 'BRAND', label: 'Brand' }, { id: 'CATEGORY', label: 'Category' }, { id: 'TERRITORY', label: 'Territory' }];
export const BASIS_CHOICES: { id: string; label: string }[] = [{ id: 'VALUE', label: 'Sales value (before GST)' }, { id: 'MARGIN', label: 'Gross margin' }, { id: 'QTY', label: 'Quantity sold' }];
export type Rule = { rule_id: number; name: string; basis: string; rate_pct: number | null; per_unit: number | null; scope_type: string; scope_id: number | null; scope_name: string | null; salesperson_id: number | null; min_achievement_pct: number | null; starts_on: string | null; ends_on: string | null; priority: number; is_active: boolean };
export type RuleForm = { name: string; basis: string; rate_pct: string; per_unit: string; scope_type: string; scope_id: string; salesperson_id: string; min_achievement_pct: string; starts_on: string; ends_on: string; priority: string; is_active: boolean };
export const emptyRule = (): RuleForm => ({ name: '', basis: 'VALUE', rate_pct: '', per_unit: '', scope_type: 'ALL', scope_id: '', salesperson_id: '', min_achievement_pct: '', starts_on: '', ends_on: '', priority: '0', is_active: true });
export const ruleForm = (r: Rule): RuleForm => ({ name: r.name, basis: r.basis, rate_pct: str(r.rate_pct), per_unit: str(r.per_unit), scope_type: r.scope_type, scope_id: str(r.scope_id), salesperson_id: str(r.salesperson_id), min_achievement_pct: str(r.min_achievement_pct), starts_on: day(r.starts_on), ends_on: day(r.ends_on), priority: String(r.priority ?? 0), is_active: r.is_active });
export const ruleProblem = (f: RuleForm): string => {
  if (f.name.trim().length < 2) return 'Give the rule a name';
  if (f.basis === 'QTY' ? !amount(f.per_unit) : !amount(f.rate_pct) || Number(f.rate_pct) > 100) return f.basis === 'QTY' ? 'Enter the amount paid per unit' : 'Enter the commission percentage';
  if (f.scope_type !== 'ALL' && !f.scope_id) return 'Choose what the rule applies to';
  if (f.min_achievement_pct.trim() && !amount(f.min_achievement_pct)) return 'The target to reach is a percentage';
  if ((f.starts_on.trim() && !isDate(f.starts_on.trim())) || (f.ends_on.trim() && !isDate(f.ends_on.trim()))) return 'Dates are written like 2026-11-01';
  if (f.starts_on.trim() && f.ends_on.trim() && f.ends_on.trim() < f.starts_on.trim()) return 'The rule cannot end before it starts';
  if (!whole(f.priority) || Math.abs(Number(f.priority)) > 100) return 'Priority is a whole number from -100 to 100';
  return '';
};
export const ruleBody = (f: RuleForm) => ({
  name: f.name.trim(), basis: f.basis, scope_type: f.scope_type, scope_id: f.scope_type === 'ALL' ? null : Number(f.scope_id), salesperson_id: f.salesperson_id ? Number(f.salesperson_id) : null,
  ...(f.basis === 'QTY' ? { per_unit: Number(f.per_unit) } : { rate_pct: Number(f.rate_pct) }), min_achievement_pct: num(f.min_achievement_pct), starts_on: f.starts_on.trim() || null, ends_on: f.ends_on.trim() || null, priority: Number(f.priority) || 0, is_active: f.is_active
});
export const ruleSub = (r: Rule): string => [
  r.basis === 'QTY' ? t('{value} a unit', { value: money(r.per_unit ?? 0) }) : t('{pct}% of {what}', { pct: r.rate_pct ?? 0, what: r.basis === 'MARGIN' ? t('margin') : t('sales') }),
  r.scope_type === 'ALL' ? t('Everything') : r.scope_name || '', r.min_achievement_pct != null ? t('once target is {pct}%', { pct: r.min_achievement_pct }) : '', r.is_active ? '' : t('Off')
].filter(Boolean).join(' · ');

export const canDistributorSetup = (can: (p: string) => boolean, ...keys: string[]): boolean => keys.some((k) => can(k));

export const DIST_SALES_TEXTS: string[] = [
  'Schemes', 'Free goods and discounts for shops: who gets them, when, and what they cost', 'You do not have access to schemes.', 'New scheme', 'Make an offer: buy 10 cartons, get 1 free; 5% off 100 units; ₹2,000 off an order above ₹50,000.',
  'Tell qualifying shops?', 'A message goes out through your messaging channel to every shop that qualifies. Those who opted out are skipped.', 'Send', 'Edit', 'Switch off', 'Switch on', 'Tell the shops', 'Delete', 'Delete {name}?', 'Close', 'Cancel', 'Save',
  'A scheme that orders have used can only be switched off.', 'Switched on', 'Deleted', 'Scheme name', 'Buy 10 cartons, get 1 free', 'Type', 'Applies to', 'Product', 'Name or barcode', 'Change', 'Buy at least', "Counted in the product's own unit (pieces, kg…)",
  'Free quantity', 'Free product', 'Leave empty to give the same product free.', 'Choose a free product, as this scheme is not for one product.', 'Repeat for every multiple', 'Buy 30 with a 10+1 scheme: 3 free; otherwise 1', 'Most that can be given free',
  'Blank for no limit', 'Discount (%)', 'When the order is at least', 'Discount as', '₹ off', '% off', 'Discount (₹)', 'Who gets it, and when', 'Starts', 'Like 2026-11-01. Blank: now', 'Ends', 'Blank: no end date', 'Types of shop', 'None ticked: all', 'Funded by',
  'You', 'A principal', 'Principal', 'You claim the cost back from them', 'None', 'Priority', 'When schemes compete, the higher priority wins even if it gives less', 'Can be combined with other schemes', 'Notes',
  'Only named shops and territories are set on the web. A scheme you edit here keeps the ones it has.', 'Save scheme', 'All', 'Active',
  'Sales team', 'Your salespeople, their targets and what they earn', 'You do not have access to the sales team.', 'Team', 'Targets', 'Commission', 'Inactive', 'Add a person', 'Add your salespeople, field reps and collection executives.', 'Name', 'Employee ID',
  'Phone', 'Email', 'Role', 'Territory', 'Reports to', 'Nobody', 'None', 'Default commission (%)', 'Used where no commission rule applies', 'Default commission on', 'Leave as it is, or choose', 'As it is', 'Sales invoiced', 'Payments collected',
  'Linking a sign-in account is done on the web.', 'Targets running today. Setting one again for the same period changes it; it never adds a second.', 'Set a target', 'Set a monthly target for each salesperson, territory or brand to track how far they are.',
  'Remove this target?', 'Remove', 'Removed', 'Target for', 'Choose', 'Period', 'Any day in the period', 'Like 2026-11-01', 'Measured in', 'Target', 'Save target', 'Target saved',
  'Each sold line earns under the most specific rule that fits. Without rules each person earns their own default percentage.', 'New rule', 'No rules yet.', '2% on everything', 'Paid on', 'Amount per unit', 'Commission (%)', 'Applies to', 'For',
  'Every salesperson', 'Only once target is at least (%)', 'Blank: no condition', 'From', 'To', 'Blank: always', 'Higher wins between equally specific rules', 'Rule is switched on', 'Save rule', 'Rule saved',
  'Buy X, get Y free', 'Quantity discount', 'Value discount', 'Running', 'Starts soon', 'Ended', 'Switched off', 'The whole order', 'One product', 'A brand', 'A category', "A principal's products",
  'Retailer', 'Dealer', 'Distributor', 'Business', 'Corporate', 'Other',
  'Give the scheme a name', 'Choose the principal that funds this scheme', 'Choose what the scheme applies to', 'Enter how much has to be bought', 'Enter how much comes free', 'Choose the product that comes free',
  'Enter the quantity that earns the discount', 'Enter the discount percentage', 'Enter the order value that earns the discount', 'Enter the discount amount or percentage', 'Dates are written like 2026-11-01',
  'The scheme cannot end before it starts', 'Priority is a whole number from -100 to 100',
  'Funded by {name}', 'a principal', '{n} days left', '{n} bills', 'Cost {value}',
  '{sent} of {total} shops were messaged; {skipped} skipped (messaging off, no number, or opted out)', '{sent} of {total} shops were messaged',
  'Sales manager', 'Sales executive', 'Field sales representative', 'Collection executive', 'Delivery executive',
  'Give the person a name', 'That email does not look right', 'The commission is a percentage from 0 to 100', '{n} shops', '{n} beats', '{value} of {target} this month', '{value} this month',
  'Whole business', 'Salesperson', 'Territory', 'Brand', 'Category', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly',
  'Choose who or what the target is for', 'The date is written like 2026-11-01', 'Enter the target', 'The target is at least ₹1', '{value} of {target}',
  'Everything', 'Sales value (before GST)', 'Gross margin', 'Quantity sold',
  'Give the rule a name', 'Enter the amount paid per unit', 'Enter the commission percentage', 'Choose what the rule applies to', 'The target to reach is a percentage', 'The rule cannot end before it starts',
  '{value} a unit', '{pct}% of {what}', 'margin', 'sales', 'once target is {pct}%', 'Off'
];
