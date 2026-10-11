import type { Api } from './api.ts';
import { ConflictError, type Action } from './actions.ts';
import { toPaise } from './money.ts';

/* When two devices change the same price. A change made with no signal remembers the price the phone saw when it was made. Before it is sent, the server's price is read:
   - still the price the phone saw: nobody else touched it, send it;
   - already the price this phone wants: nothing to do;
   - anything else: another device changed it, so ask a person which one to keep.
   Stock changes are "add 5" or "take away 3", not a new total, so two devices' changes add up and never conflict. */

export type PriceCheck = { kind: 'price'; product_id: number; seen: number; mine: number };
export const CHECK = '_check';

export type Verdict = 'send' | 'already' | 'conflict';
export const priceVerdict = (check: Pick<PriceCheck, 'seen' | 'mine'>, server: number): Verdict =>
  toPaise(server) === toPaise(check.mine) ? 'already' : toPaise(server) === toPaise(check.seen) ? 'send' : 'conflict';

/** The body to send (without our private notes), and the check if there is one. */
export const split = (body: Record<string, unknown>): { clean: Record<string, unknown>; check: PriceCheck | null; server: number | null } => {
  const { _check, _conflict, ...clean } = body as Record<string, unknown> & { _check?: PriceCheck; _conflict?: { server: number } };
  return { clean, check: _check ?? null, server: _conflict?.server ?? null };
};

/** What a queued price change carries so it can be checked later. */
export const withCheck = (body: Record<string, unknown>, check: PriceCheck): Record<string, unknown> => ({ ...body, [CHECK]: check });

/** Before sending a queued change: read the server's price. 'skip' = nothing to send. Throws ConflictError when another device changed it. */
export const guard = async (api: Pick<Api, 'get'>, a: Pick<Action, 'body'>): Promise<'send' | 'skip'> => {
  const { check } = split(a.body);
  if (!check) return 'send';
  const server = (await api.get<{ selling_price: number }>(`/products/${check.product_id}`)).selling_price;
  const verdict = priceVerdict(check, server);
  if (verdict === 'conflict') throw new ConflictError(server);
  return verdict === 'already' ? 'skip' : 'send';
};

/** The words of the question. `tr` translates a sentence with {placeholders} (the phone's own words); by default it only fills them in. */
export type Tr = (text: string, vars?: Record<string, string | number>) => string;
const fill: Tr = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? '')) : text);
export const conflictText = (label: string, mine: number, server: number, money: (n: number) => string, tr: Tr = fill): { title: string; body: string; keepMine: string; keepServer: string } => ({
  title: tr('Something changed on another device'),
  body: tr('{label}. FlowXP now has {price}. Which one should we keep?', { label: tr(label), price: money(server) }),
  keepMine: tr('Keep my change ({price})', { price: money(mine) }),
  keepServer: tr("Keep FlowXP's ({price})", { price: money(server) })
});
