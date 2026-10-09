import { toPaise } from './money.ts';

export type PriceList = {
  list_id: number; name: string; kind: 'STANDARD' | 'PROMOTION'; customer_type: string | null; starts_on: string | null; ends_on: string | null;
  is_active: boolean; notes: string | null; items?: number; customers?: number; is_default: boolean;
};
export type PriceRule = { item_id: number; product_id: number | null; product: string | null; category_id: number | null; category: string | null; unit_name: string | null; min_qty: number; price: number | null; discount_pct: number | null };
export type RuleDraft = { product_id: number; name: string; unit_name: string | null; min_qty: string; mode: 'price' | 'percent'; value: string };

export const KIND_LABEL: Record<PriceList['kind'], string> = { STANDARD: 'Everyday prices', PROMOTION: 'Offer prices' };

/** One line about a list: what it is, how many prices it has, who uses it. */
export const listSummary = (l: Pick<PriceList, 'kind' | 'items' | 'customers' | 'is_default' | 'is_active' | 'starts_on' | 'ends_on'>): string => [
  KIND_LABEL[l.kind],
  `${l.items ?? 0} price${l.items === 1 ? '' : 's'}`,
  l.is_default ? 'for everyone without their own list' : (l.customers ?? 0) > 0 ? `${l.customers} customer${l.customers === 1 ? '' : 's'}` : 'no customer yet',
  l.starts_on || l.ends_on ? `${l.starts_on ? String(l.starts_on).slice(0, 10) : 'now'} to ${l.ends_on ? String(l.ends_on).slice(0, 10) : 'no end'}` : null,
  l.is_active ? null : 'switched off'
].filter(Boolean).join(' · ');

/** What a rule says, in plain words: "₹42 each from 10 cartons" / "5% off". */
export const ruleText = (r: Pick<PriceRule, 'price' | 'discount_pct' | 'min_qty' | 'unit_name'>, money: (n: number) => string): string => {
  const unit = r.unit_name ?? 'piece';
  const what = r.price != null ? `${money(r.price)} per ${unit}` : `${r.discount_pct}% off`;
  return r.min_qty > 1 ? `${what}, from ${r.min_qty} ${unit}` : what;
};

export const ruleProblem = (d: RuleDraft | null): string => {
  if (!d) return 'Choose an item first';
  const v = Number(d.value);
  if (!d.value.trim() || !Number.isFinite(v) || v < 0) return d.mode === 'price' ? 'Enter the price' : 'Enter how much off';
  if (d.mode === 'percent' && v > 100) return 'The discount cannot be more than 100%';
  if (d.mode === 'price' && toPaise(v) <= 0) return 'Enter the price';
  const q = Number(d.min_qty || '1');
  if (!Number.isFinite(q) || q <= 0) return 'Enter how many they must buy for this price';
  return '';
};

/** The body for PUT /wholesale/price-lists/:id/items: the same item, unit and quantity again changes that price instead of adding another. */
export const ruleBody = (d: RuleDraft) => ({
  items: [{ product_id: d.product_id, ...(d.unit_name ? { unit_name: d.unit_name } : {}), min_qty: Number(d.min_qty || '1'), ...(d.mode === 'price' ? { price: Number(d.value) } : { discount_pct: Number(d.value) }) }]
});

export const newListProblem = (name: string): string => (name.trim().length < 2 ? 'Give the list a name' : '');
export const newListBody = (name: string, kind: PriceList['kind']) => ({ name: name.trim(), kind });
