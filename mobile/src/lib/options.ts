/*
 * Choosing a drink's options (size, milk, sugar, add-ons) before it goes on the bill. The rules are the server's own (it re-checks every
 * choice and refuses a bill that breaks them); this only stops the cashier submitting something it will refuse, and shows the price.
 *   min_select 1 and max_select 1  = pick exactly one (Size, Milk, Sugar)   |   min 0, max 3 = optional extras, up to 3
 */
import { toPaise } from './money.ts';

export type Modifier = { modifier_id: number; name: string; price_delta: number };
export type Group = { group_id: number; name: string; is_variant: boolean; min_select: number; max_select: number | null; modifiers: Modifier[] };
export type Chosen = Record<number, number[]>;

/** A required single choice starts on its first option (one tap fewer for the usual drink); everything else starts empty. */
export const initialChoice = (groups: Group[]): Chosen => {
  const start: Chosen = {};
  for (const g of groups) start[g.group_id] = g.min_select === 1 && g.max_select === 1 && g.modifiers[0] ? [g.modifiers[0].modifier_id] : [];
  return start;
};

/** Tap an option: a single-choice group swaps, a multi-choice group toggles up to its maximum. */
export const toggle = (group: Group, chosen: Chosen, id: number): Chosen => {
  const current = chosen[group.group_id] || [];
  if (group.max_select === 1) return { ...chosen, [group.group_id]: [id] };
  if (current.includes(id)) return { ...chosen, [group.group_id]: current.filter((x) => x !== id) };
  if (group.max_select != null && current.length >= group.max_select) return chosen;
  return { ...chosen, [group.group_id]: [...current, id] };
};

/** The first group that still needs choices, if any. */
export const missing = (groups: Group[], chosen: Chosen): Group | undefined => groups.find((g) => (chosen[g.group_id] || []).length < g.min_select);

export type Picked = { ids: number[]; names: string[]; deltaPaise: number };
export const picked = (groups: Group[], chosen: Chosen): Picked => {
  const all = groups.flatMap((g) => g.modifiers.filter((m) => (chosen[g.group_id] || []).includes(m.modifier_id)));
  return { ids: all.map((m) => m.modifier_id), names: all.map((m) => m.name), deltaPaise: all.reduce((s, m) => s + toPaise(m.price_delta), 0) };
};
