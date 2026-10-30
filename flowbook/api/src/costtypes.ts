import { LedgerError } from './ledger.ts';

/** The kinds of cost a project's bills and expenses are sorted into. Goods taken from stock for the project are always Materials. */
export const COST_TYPES = ['Materials', 'Labour', 'Transport', 'Contractors', 'Equipment', 'Other'] as const;
export type CostType = (typeof COST_TYPES)[number];
export const costType = (v: unknown, fallback: CostType): CostType => {
  if (v === undefined || v === null || v === '') return fallback;
  if (!(COST_TYPES as readonly unknown[]).includes(v)) throw new LedgerError('bad_cost_type', `the kind of cost must be one of ${COST_TYPES.join(', ')}`);
  return v as CostType;
};
