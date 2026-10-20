/* Options & add-ons on the phone: the rule in words, the form and its checks, the body sent, the dish picker, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_OPTION_TEXTS, blankOption, canOptions, chosenText, dishesByCategory, emptyGroup, groupBody, groupForm, groupProblem, groupSub, ingredientLine, previewRule, productsBody, ruleOf, toggleBody, toggleIds, usedText, type Group } from '../src/lib/menuOptions.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const group: Group = {
  group_id: 3, name: 'Extras', is_variant: false, min_select: 0, max_select: 2, is_active: true,
  modifiers: [{ modifier_id: 11, name: 'Cheese', price_delta: 20, ingredient_product_id: 7, ingredient_qty: 20 }, { modifier_id: 12, name: 'Egg', price_delta: 0, ingredient_product_id: null, ingredient_qty: null }, { modifier_id: 13, name: 'Old', price_delta: 5, ingredient_product_id: null, ingredient_qty: null, is_active: false }],
  products: [{ product_id: 1, name: 'Burger' }]
};

test('the rule, the way a waiter would say it', () => {
  assert.equal(ruleOf({ is_variant: true, min_select: 1, max_select: 1 }), 'Pick exactly one'); assert.equal(ruleOf({ is_variant: false, min_select: 0, max_select: null }), 'Optional, pick any');
  assert.equal(ruleOf(group), 'Optional, up to 2'); assert.equal(ruleOf({ is_variant: false, min_select: 2, max_select: null }), 'Pick at least 2'); assert.equal(ruleOf({ is_variant: false, min_select: 2, max_select: 2 }), 'Pick exactly 2'); assert.equal(ruleOf({ is_variant: false, min_select: 1, max_select: 3 }), 'Pick 1 to 3');
});

test('lines shown: active options only, price change, ingredient, how many dishes', () => {
  assert.equal(groupSub(group), 'Cheese, Egg'); assert.equal(usedText(group), 'on 1 dish'); assert.equal(usedText({ ...group, products: [] }), 'not on any dish'); assert.equal(usedText({ ...group, products: [group.products[0], group.products[0]] }), 'on 2 dishes');
  assert.equal(ingredientLine(group.modifiers[0], [{ product_id: 7, name: 'Cheese slice', unit: 'g' }]), 'uses 20 g Cheese slice'); assert.equal(ingredientLine(group.modifiers[1], []), '');
  assert.equal(canOptions((p) => p === 'products'), true); assert.equal(canOptions(() => false), false);
});

test('the form: round trip keeps ids, the rule is checked, the body drops empty options', () => {
  const f = groupForm(group);
  assert.deepEqual(f.options.map((o) => o.name), ['Cheese', 'Egg']); assert.equal(f.options[0].modifier_id, 11); assert.equal(f.max_select, '2'); assert.equal(groupProblem(f), '');
  const body = groupBody({ ...f, options: [...f.options, blankOption()] }) as { modifiers: { modifier_id?: number; ingredient_qty: number | null }[]; max_select: number | null; is_variant: boolean };
  assert.equal(body.modifiers.length, 2); assert.equal(body.modifiers[0].modifier_id, 11); assert.equal(body.modifiers[0].ingredient_qty, 20); assert.equal(body.modifiers[1].ingredient_qty, null); assert.equal(body.max_select, 2); assert.equal(body.is_variant, false);
  const variant = { ...emptyGroup(), name: 'Size', options: [{ ...blankOption(), name: 'Half' }, { ...blankOption(), name: 'Full', price_delta: '40' }] };
  assert.deepEqual(previewRule(variant), { is_variant: true, min_select: 1, max_select: 1 }); assert.equal(groupProblem(variant), ''); assert.equal((groupBody(variant) as { max_select: number }).max_select, 1);
  assert.notEqual(groupProblem({ ...variant, name: ' ' }), ''); assert.notEqual(groupProblem({ ...variant, options: [blankOption()] }), ''); assert.notEqual(groupProblem({ ...variant, options: [{ ...blankOption(), name: 'A', price_delta: 'x' }] }), '');
  assert.notEqual(groupProblem({ ...variant, options: [{ ...blankOption(), name: 'A', ingredient_product_id: '7' }] }), '', 'an ingredient needs a quantity');
  const addon = { ...f, kind: 'addon' as const };
  assert.notEqual(groupProblem({ ...addon, min_select: '3', max_select: '2' }), ''); assert.notEqual(groupProblem({ ...addon, min_select: '3', max_select: '' }), '', 'fewer options than the least'); assert.notEqual(groupProblem({ ...addon, max_select: '0' }), '');
});

test('turning a group off sends it whole with one flag changed', () => {
  const b = toggleBody(group) as { is_active: boolean; modifiers: unknown[]; name: string };
  assert.equal(b.is_active, false); assert.equal(b.name, 'Extras'); assert.equal(b.modifiers.length, 2); assert.equal((toggleBody({ ...group, is_active: false }) as { is_active: boolean }).is_active, true);
});

test('choosing dishes: grouped by category, searched, combos left out, all/none per category', () => {
  const dishes = [{ product_id: 1, name: 'Burger', category_name: 'Mains', selling_price: 100 }, { product_id: 2, name: 'Fries', category_name: 'Sides', selling_price: 50 }, { product_id: 3, name: 'Combo', category_name: 'Mains', selling_price: 1, is_combo: true }, { product_id: 4, name: 'Loose', category_name: null, selling_price: 5 }];
  assert.deepEqual(dishesByCategory(dishes, '').map(([c, l]) => [c, l.map((d) => d.product_id)]), [['', [4]], ['Mains', [1]], ['Sides', [2]]]); assert.deepEqual(dishesByCategory(dishes, 'fri').map(([, l]) => l.map((d) => d.product_id)), [[2]]);
  const s = toggleIds(new Set([1]), [1, 2], true); assert.deepEqual([...s].sort(), [1, 2]); assert.deepEqual([...toggleIds(s, [1, 2], false)], []); assert.deepEqual(productsBody(new Set([9, 2])), { product_ids: [2, 9] });
  assert.equal(chosenText(1), '1 dish chosen'); assert.equal(chosenText(4), '4 dishes chosen');
});

test('every text of the Options & add-ons screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(MENU_OPTION_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
