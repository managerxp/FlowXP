/*
 * Options & add-ons on the phone (anyone with the products permission, in a kitchen business): a group is a size or level (pick one) or add-ons
 * (pick any, within limits); each option changes the price and can use up an ingredient; the group is offered on chosen dishes. The same as the
 * website's Options & add-ons page; the server checks everything again. (lib/options.ts is the till's picker, which uses these groups.)
 * Pure: types, the rule in plain words, the form, its checks and the body sent.
 */
import { t } from './i18n.ts';
import { rupees, toPaise } from './money.ts';

export type GroupOption = { modifier_id?: number; name: string; price_delta: number; ingredient_product_id: number | null; ingredient_qty: number | null; is_active?: boolean };
export type Group = {
  group_id: number; name: string; is_variant: boolean; min_select: number; max_select: number | null; is_active: boolean;
  modifiers: GroupOption[]; products: { product_id: number; name: string }[];
};
export type Ingredient = { product_id: number; name: string; unit: string | null };
export type Dish = { product_id: number; name: string; category_name: string | null; selling_price: number; is_combo?: boolean };

export const canOptions = (can: (perm: string) => boolean): boolean => can('products');

/* ── wording ─────────────────────────────────────────────────────────────── */
/** The group's rule the way a waiter would say it. */
export const ruleOf = (g: Pick<Group, 'is_variant' | 'min_select' | 'max_select'>): string => {
  if (g.is_variant) return t('Pick exactly one');
  const min = g.min_select || 0; const max = g.max_select;
  if (min === 0 && max == null) return t('Optional, pick any');
  if (min === 0) return t('Optional, up to {n}', { n: max ?? 0 });
  if (max == null) return t('Pick at least {n}', { n: min });
  if (min === max) return t('Pick exactly {n}', { n: min });
  return t('Pick {min} to {max}', { min, max });
};
export const priceText = (d: number): string => (d > 0 ? `+${rupees(toPaise(d))}` : d < 0 ? `−${rupees(toPaise(-d))}` : t('no charge'));
export const activeOptions = (g: Group): GroupOption[] => g.modifiers.filter((m) => m.is_active !== false);
export const groupSub = (g: Group): string => activeOptions(g).map((m) => m.name).join(', ');
export const usedText = (g: Group): string => (g.products.length === 0 ? t('not on any dish') : g.products.length === 1 ? t('on 1 dish') : t('on {n} dishes', { n: g.products.length }));
export const ingredientLine = (m: GroupOption, ingredients: Ingredient[]): string => {
  if (!m.ingredient_product_id) return '';
  const ing = ingredients.find((p) => p.product_id === m.ingredient_product_id);
  return t('uses {qty} {unit} {name}', { qty: Number(m.ingredient_qty || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 }), unit: ing?.unit ?? '', name: ing?.name ?? t('of an ingredient') }).replace(/\s+/g, ' ');
};

/* ── the form ────────────────────────────────────────────────────────────── */
export type OptionForm = { name: string; price_delta: string; ingredient_product_id: string; ingredient_qty: string; modifier_id?: number };
export type GroupForm = { name: string; kind: 'variant' | 'addon'; min_select: string; max_select: string; options: OptionForm[] };
export const blankOption = (): OptionForm => ({ name: '', price_delta: '0', ingredient_product_id: '', ingredient_qty: '' });
export const emptyGroup = (): GroupForm => ({ name: '', kind: 'variant', min_select: '0', max_select: '', options: [blankOption(), blankOption()] });
export const groupForm = (g: Group): GroupForm => ({
  name: g.name, kind: g.is_variant ? 'variant' : 'addon', min_select: String(g.min_select ?? 0), max_select: g.max_select == null ? '' : String(g.max_select),
  options: activeOptions(g).map((m) => ({ modifier_id: m.modifier_id, name: m.name, price_delta: String(m.price_delta), ingredient_product_id: m.ingredient_product_id ? String(m.ingredient_product_id) : '', ingredient_qty: m.ingredient_qty == null ? '' : String(m.ingredient_qty) }))
});
/** The rule being built, so the form can say it in words as it changes. */
export const previewRule = (f: GroupForm): Pick<Group, 'is_variant' | 'min_select' | 'max_select'> => {
  const variant = f.kind === 'variant';
  return { is_variant: variant, min_select: variant ? 1 : Number(f.min_select) || 0, max_select: variant ? 1 : f.max_select === '' ? null : Number(f.max_select) };
};
export const groupProblem = (f: GroupForm): string => {
  if (!f.name.trim()) return 'Give the group a name, like Size or Extras';
  const named = f.options.filter((o) => o.name.trim());
  if (named.length === 0) return 'Add at least one option';
  for (const o of named) {
    if (o.price_delta.trim() !== '' && !Number.isFinite(Number(o.price_delta))) return 'The price change must be a number';
    if (o.ingredient_product_id && !(Number(o.ingredient_qty) > 0)) return 'Say how much of the ingredient an option uses';
  }
  if (f.kind === 'addon') {
    const min = Number(f.min_select || 0); const max = f.max_select === '' ? null : Number(f.max_select);
    if (!Number.isInteger(min) || min < 0) return 'At least must be 0 or a whole number';
    if (max != null && (!Number.isInteger(max) || max < 1)) return 'At most must be a whole number from 1, or blank for no limit';
    if (max != null && max < min) return 'At most cannot be less than at least';
    if (named.length < min) return 'There are fewer options than the least a customer must pick';
  }
  return '';
};
/** The body of POST/PUT /modifier-groups; options with no name are left out, and an existing option keeps its id so old bills stay matched. */
export const groupBody = (f: GroupForm, isActive = true): Record<string, unknown> => {
  const r = previewRule(f);
  return {
    name: f.name.trim(), is_variant: r.is_variant, is_active: isActive, min_select: r.min_select, max_select: r.max_select,
    modifiers: f.options.filter((o) => o.name.trim()).map((o) => ({
      modifier_id: o.modifier_id, name: o.name.trim(), price_delta: Number(o.price_delta) || 0,
      ingredient_product_id: o.ingredient_product_id ? Number(o.ingredient_product_id) : null, ingredient_qty: o.ingredient_product_id && o.ingredient_qty !== '' ? Number(o.ingredient_qty) : null
    }))
  };
};
/** Turning a group on or off sends it back whole with the one flag changed (the server replaces the group). */
export const toggleBody = (g: Group): Record<string, unknown> => ({ ...groupBody(groupForm(g), !g.is_active) });

/* ── choosing the dishes ─────────────────────────────────────────────────── */
export const dishesByCategory = (dishes: Dish[], search: string): [string, Dish[]][] => {
  const q = search.trim().toLowerCase();
  const map = new Map<string, Dish[]>();
  for (const d of dishes.filter((x) => !x.is_combo && (!q || x.name.toLowerCase().includes(q)))) { const k = d.category_name || ''; (map.get(k) ?? map.set(k, []).get(k)!).push(d); }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};
export const toggleIds = (chosen: Set<number>, ids: number[], on: boolean): Set<number> => { const n = new Set(chosen); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; };
export const chosenText = (n: number): string => (n === 1 ? t('1 dish chosen') : t('{n} dishes chosen', { n }));
export const productsBody = (chosen: Set<number>): { product_ids: number[] } => ({ product_ids: [...chosen].sort((a, b) => a - b) });

/** Every fixed text on the Options & add-ons screens, so the language tests can check each is translated. */
export const MENU_OPTION_TEXTS: string[] = [
  'Search ingredients', 'Sizes, levels and add-ons for dishes',
  'Options & add-ons', 'Sizes, levels and add-ons customers choose on a dish', '{n} in use', '{n} not on any dish', 'New group', 'No option groups yet', 'Make one for a size (Half / Full), a level (Mild / Hot) or extras (Cheese, Egg), then choose the dishes that offer it.', 'Make the first group',
  'Pick exactly one', 'Optional, pick any', 'Optional, up to {n}', 'Pick at least {n}', 'Pick exactly {n}', 'Pick {min} to {max}', 'no charge', 'not on any dish', 'on 1 dish', 'on {n} dishes', 'uses {qty} {unit} {name}', 'of an ingredient', 'Off', 'Back', 'Cancel',
  'One of these', 'Add-ons', 'Edit', 'Choose dishes', 'Turn off', 'Turn on', 'Off: the till does not offer it and bills do not ask for it. Turn it on to offer it again on the same dishes.', 'Options', 'Offered on', 'Not on any dish yet, so no one is asked.', 'Optional',
  'Group name', 'What the waiter asks: Size, Spice level, Extras', 'How customers choose', 'A size or a level: Half / Full, Mild / Hot. Always asked.', 'Add-ons and extras, within the limits you set.', 'At least', '0 = optional', 'At most', 'Blank = no limit',
  'The price change is added to the dish\'s price. An option can use up an ingredient (extra cheese uses 20 g of cheese), so stock stays right.', 'Option name', 'e.g. Full plate', 'Price change ₹', 'Uses ingredient', 'Nothing extra', 'How much', 'Add an option', 'Remove', 'A removed option is kept on old bills; it just stops being offered.',
  'Create group', 'Save changes', 'Which dishes offer {name}?', 'Search dishes', 'No dishes match.', 'No dishes on the menu yet.', 'No category', 'All', 'None', '1 dish chosen', '{n} dishes chosen', 'Save',
  'Give the group a name, like Size or Extras', 'Add at least one option', 'The price change must be a number', 'Say how much of the ingredient an option uses', 'At least must be 0 or a whole number', 'At most must be a whole number from 1, or blank for no limit', 'At most cannot be less than at least',
  'There are fewer options than the least a customer must pick', 'You do not have access to options.', 'Could not load.', 'Could not save. Check the connection and try again.'
];
