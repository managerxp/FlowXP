/*
 * Getting used to the app. Three small things, all optional and all remembered on the phone so nothing is shown twice:
 *   - a short TOUR the first time (skippable, replayable from Help);
 *   - a "Getting started" CHECKLIST on Home whose ticks come from what the person has really done, not from reading;
 *   - HINTS: one sentence at the moment a screen is first used, dismissed with one tap and never shown again.
 * Reset from Help ("Show the tips again") puts all three back.
 */

export type Flag = 'tour_done' | 'checklist_hidden' | 'first_bill' | 'first_scan' | 'first_bills_page' | 'first_hold' | 'first_table' | 'first_kitchen';
export type HintId = 'sell' | 'offline' | 'tables' | 'order' | 'products' | 'kitchen';

export type Kept = { flags: Flag[]; hints: HintId[] };
export const empty = (): Kept => ({ flags: [], hints: [] });

export type Kv = { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void> };
const KEY = 'onboarding';

export const load = async (kv: Kv): Promise<Kept> => {
  try { const raw = JSON.parse((await kv.get(KEY)) || 'null') as Partial<Kept> | null; return { flags: raw?.flags ?? [], hints: raw?.hints ?? [] }; } catch { return empty(); }
};
export const save = (kv: Kv, kept: Kept) => kv.set(KEY, JSON.stringify(kept)).catch(() => {});

export const mark = (kept: Kept, flag: Flag): Kept => (kept.flags.includes(flag) ? kept : { ...kept, flags: [...kept.flags, flag] });
export const dismiss = (kept: Kept, hint: HintId): Kept => (kept.hints.includes(hint) ? kept : { ...kept, hints: [...kept.hints, hint] });
export const showHint = (kept: Kept, hint: HintId): boolean => !kept.hints.includes(hint);
export const reset = (): Kept => empty();

/** The words of each hint: one sentence of what to do, one of why it matters. Short enough to read standing at the counter. */
export const HINTS: Record<HintId, { title: string; body: string }> = {
  sell: { title: 'Making a bill', body: 'Tap an item to add it. Tap Bill to check it, then Take payment. The total shown is about right: the exact amount is worked out when you pay.' },
  offline: { title: 'No internet? Keep billing', body: 'Bills are saved on this phone and sent to FlowXP by themselves when the signal is back. You do not need to do anything.' },
  tables: { title: 'Tables', body: 'Tap a free table to start an order. Tap a busy one to add items, send them to the kitchen, or bill.' },
  order: { title: 'An order', body: 'Add items, then Send to kitchen. When the food is ready, mark it served. Bill and pay when the table is done.' },
  products: { title: 'Products', body: 'Tap a product to change its price or fix its stock. Add product is for something new.' },
  kitchen: { title: 'Kitchen screen', body: 'Tap a dish when it is done. Rush puts a table first. Undo stays on screen for a few seconds after every tap.' }
};

export type Step = { id: string; label: string; why: string; done: boolean; go: string };

/** The checklist for this kind of business, with each step ticked from what the person has actually done. */
export const checklist = (kept: Kept, food: boolean): Step[] => {
  const has = (f: Flag) => kept.flags.includes(f);
  const steps: Step[] = [
    { id: 'bill', label: 'Make your first bill', why: 'Tap items, then Take payment.', done: has('first_bill'), go: '/sell' },
    { id: 'scan', label: 'Scan a barcode', why: 'Point the camera at a product to add it.', done: has('first_scan'), go: '/scan' }
  ];
  if (food) {
    steps.push({ id: 'table', label: 'Open a table', why: 'Tap a free table to start an order.', done: has('first_table'), go: '/tables' });
    steps.push({ id: 'kitchen', label: 'See the kitchen screen', why: 'What the cooks see when you send an order.', done: has('first_kitchen'), go: '/kitchen' });
  } else {
    steps.push({ id: 'hold', label: 'Hold a bill for later', why: 'Put a bill aside when a customer steps away.', done: has('first_hold'), go: '/sell' });
  }
  steps.push({ id: 'bills', label: 'Look at your bills', why: 'Every bill you make is listed here.', done: has('first_bills_page'), go: '/sales' });
  return steps;
};

export const progress = (steps: Step[]) => ({ done: steps.filter((s) => s.done).length, total: steps.length, complete: steps.every((s) => s.done) });

/** The tour appears by itself once, on the first visit to Home; never if it was done or skipped, never for a returning person. */
export const shouldOfferTour = (kept: Kept): boolean => !kept.flags.includes('tour_done');
/** The checklist shows until it is complete or the person hides it. */
export const shouldShowChecklist = (kept: Kept, food: boolean): boolean => !kept.flags.includes('checklist_hidden') && !progress(checklist(kept, food)).complete;

export type Slide = { title: string; lines: string[]; icon: string };
export const tour = (food: boolean): Slide[] => [
  { icon: 'cart-outline', title: 'Make a bill in three taps', lines: ['Tap the items.', 'Tap Take payment.', 'Hand over the bill.'] },
  { icon: 'cloud-offline-outline', title: 'No internet? Keep selling', lines: ['Bills are saved on this phone.', 'They are sent by themselves when the signal returns.'] },
  food
    ? { icon: 'restaurant-outline', title: 'Tables and the kitchen', lines: ['Open a table, add items, send to the kitchen.', 'Cooks tap a dish when it is ready. You see it here.'] }
    : { icon: 'cube-outline', title: 'Everything else is under More', lines: ['Products, customers, stock and reports.', 'Help is always at the top of More.'] }
];
