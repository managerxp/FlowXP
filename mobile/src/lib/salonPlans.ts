/* The salon's membership plans and service packages: how they read, what the forms hold and check, what is sent (only what changed on an edit). The server has the last word.
   Selling one to a client happens at the till; clients who already hold one keep the terms they bought. */

export type FreeService = { service_id: number; qty: number };
export type Benefits = { discount_pct?: number; discount_applies_to?: string[]; free_services?: FreeService[]; priority_booking?: boolean; points_multiplier?: number; perks?: string[] };
export type Plan = { plan_id: number; name: string; description: string | null; price: number; tax_rate: number; duration_days: number; benefits: Benefits; is_active: boolean; active_members?: number };
export type Package = { package_id: number; name: string; description: string | null; price: number; tax_rate: number; validity_days: number; is_active: boolean; services_value: number; saving: number; items: { service_id: number; name: string; quantity: number }[] };
export type ServiceRef = { service_id: number; name: string; price: number };

export const GST = ['0', '5', '12', '18'];
export const DAYS: { id: string; label: string }[] = [{ id: '30', label: '1 month' }, { id: '90', label: '3 months' }, { id: '180', label: '6 months' }, { id: '365', label: '1 year' }];
export const APPLIES: { id: string; label: string }[] = [{ id: 'SERVICE', label: 'Services' }, { id: 'PRODUCT', label: 'Products' }, { id: 'BOTH', label: 'Both' }];

export const daysText = (d: number): string => {
  const known = DAYS.find((x) => Number(x.id) === d);
  if (known) return known.label;
  return d % 30 === 0 && d < 365 ? `${d / 30} months` : d % 365 === 0 ? `${d / 365} years` : `${d} days`;
};

/* ── membership plans ── */
export type PlanDraft = {
  name: string; price: string; gst: string; days: string; discount: string; applies: string; free: { service_id: number; qty: string }[]; priority: boolean; active: boolean; extra: Pick<Benefits, 'points_multiplier' | 'perks'>;
};
export const blankPlan = (gst = '18'): PlanDraft => ({ name: '', price: '', gst, days: '365', discount: '', applies: 'SERVICE', free: [], priority: false, active: true, extra: {} });

export const planFrom = (p: Plan): PlanDraft => {
  const a = p.benefits.discount_applies_to ?? ['SERVICE'];
  return {
    name: p.name, price: String(p.price), gst: String(p.tax_rate), days: String(p.duration_days), discount: p.benefits.discount_pct ? String(p.benefits.discount_pct) : '',
    applies: a.includes('SERVICE') && a.includes('PRODUCT') ? 'BOTH' : a[0] ?? 'SERVICE', free: (p.benefits.free_services ?? []).map((f) => ({ service_id: f.service_id, qty: String(f.qty) })),
    priority: Boolean(p.benefits.priority_booking), active: p.is_active, extra: { ...(p.benefits.points_multiplier != null ? { points_multiplier: p.benefits.points_multiplier } : {}), ...(p.benefits.perks ? { perks: p.benefits.perks } : {}) }
  };
};

const wholeDays = (v: string): boolean => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 3660;
const goodQty = (q: string): boolean => Number.isInteger(Number(q)) && Number(q) >= 1 && Number(q) <= 500;

export const planProblem = (d: PlanDraft): string => {
  if (d.name.trim().length < 2) return 'Give the plan a name';
  if (d.price.trim() === '' || !(Number(d.price) >= 0)) return 'Enter the price';
  if (!wholeDays(d.days)) return 'Enter how many days it lasts';
  if (d.discount.trim() !== '' && !(Number(d.discount) >= 0 && Number(d.discount) <= 100)) return 'The discount must be from 0 to 100 percent';
  if (d.free.some((f) => !goodQty(f.qty))) return 'Each free service needs a number of 1 or more';
  if (!d.discount.trim() && !d.free.length && !d.priority) return 'Give the plan something: a discount, free services or priority booking';
  return '';
};

export const planBody = (d: PlanDraft) => ({
  name: d.name.trim(), price: Number(d.price), tax_rate: Number(d.gst), duration_days: Number(d.days), is_active: d.active,
  benefits: {
    ...(d.discount.trim() ? { discount_pct: Number(d.discount) } : {}), discount_applies_to: d.applies === 'BOTH' ? ['SERVICE', 'PRODUCT'] : [d.applies],
    ...(d.free.length ? { free_services: d.free.map((f) => ({ service_id: f.service_id, qty: Number(f.qty) })) } : {}), ...(d.priority ? { priority_booking: true } : {}), ...d.extra
  }
});

const diffBody = (was: Record<string, unknown>, now: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(now).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(was[k])));
export const planChanged = (before: PlanDraft, after: PlanDraft) => diffBody(planBody(before), planBody(after));

/* ── packages ── */
export type PackageDraft = { name: string; price: string; gst: string; days: string; items: { service_id: number; qty: string }[]; active: boolean };
export const blankPackage = (gst = '18'): PackageDraft => ({ name: '', price: '', gst, days: '180', items: [], active: true });
export const packageFrom = (p: Package): PackageDraft => ({ name: p.name, price: String(p.price), gst: String(p.tax_rate), days: String(p.validity_days), items: p.items.map((i) => ({ service_id: i.service_id, qty: String(i.quantity) })), active: p.is_active });

export const packageProblem = (d: PackageDraft): string => {
  if (d.name.trim().length < 2) return 'Give the package a name';
  if (d.price.trim() === '' || !(Number(d.price) >= 0)) return 'Enter the price';
  if (!wholeDays(d.days)) return 'Enter how many days it lasts';
  if (!d.items.length) return 'Add at least one service';
  if (d.items.some((i) => !goodQty(i.qty))) return 'Each service needs a number of 1 or more';
  return '';
};
export const packageBody = (d: PackageDraft) => ({ name: d.name.trim(), price: Number(d.price), tax_rate: Number(d.gst), validity_days: Number(d.days), is_active: d.active, items: d.items.map((i) => ({ service_id: i.service_id, quantity: Number(i.qty) })) });
export const packageChanged = (before: PackageDraft, after: PackageDraft) => diffBody(packageBody(before), packageBody(after));

/** What the services in a package would cost one by one, and what the client saves. */
export const valueOf = (items: { service_id: number; qty: string }[], services: ServiceRef[]): number =>
  Math.round(items.reduce((a, i) => a + (services.find((s) => s.service_id === i.service_id)?.price ?? 0) * (Number(i.qty) || 0), 0) * 100) / 100;
export const savingText = (price: string, value: number, money: (n: number) => string): string => {
  const p = Number(price);
  if (!value || !Number.isFinite(p) || price.trim() === '') return '';
  return p < value ? `Worth ${money(value)} bought one by one: the client saves ${money(Math.round((value - p) * 100) / 100)}.` : p === value ? `Worth ${money(value)} bought one by one: no saving for the client.` : `Worth ${money(value)} bought one by one: the package costs more than that.`;
};

/* ── how a plan reads in a list ── */
export const planLine = (p: Plan): string => [
  daysText(p.duration_days),
  p.benefits.discount_pct ? `${p.benefits.discount_pct}% off` : null,
  p.benefits.free_services?.length ? `${p.benefits.free_services.length} free service${p.benefits.free_services.length === 1 ? '' : 's'}` : null,
  p.benefits.priority_booking ? 'priority booking' : null,
  p.active_members ? `${p.active_members} member${p.active_members === 1 ? '' : 's'}` : null,
  p.is_active ? null : 'switched off'
].filter(Boolean).join(' · ');

export const packageLine = (p: Package): string => [
  daysText(p.validity_days), `${p.items.reduce((a, i) => a + i.quantity, 0)} visits`, p.saving > 0 ? 'saves the client money' : null, p.is_active ? null : 'switched off'
].filter(Boolean).join(' · ');
