/* Shops with batches and use-by dates (supermarket, retail): which businesses, and how an expiring batch reads. */
export const RETAIL_TYPES = ['SUPERMARKET', 'RETAIL', 'AUTO_PARTS'];

export type ExpiryRow = { batch_id: number; name: string; unit: string | null; batch_no: string; expiry_date: string; qty_on_hand: number; days_left: number; cost: number; value: number };
export type ExpirySummary = { summary: { expired: number; expiring: number; expired_value: number }; rows: ExpiryRow[] };

/** "Expired 3 days ago", "Last day today", "12 days left". */
export const daysText = (d: number): string => {
  if (d < 0) return `Expired ${-d} day${d === -1 ? '' : 's'} ago`;
  if (d === 0) return 'Last day today';
  return `${d} day${d === 1 ? '' : 's'} left`;
};

export const WHOLESALE_TYPES = ['WHOLESALE', 'DISTRIBUTOR'];

type TypeOf = { business_type?: string; distributor_enabled?: boolean } | null | undefined;
/** Wholesale and distribution are one app: a wholesaler's orders, credit, warehouse and buying. */
export const isWholesale = (b: TypeOf): boolean => WHOLESALE_TYPES.includes(b?.business_type ?? '');
/** The field-sales extras (my route, my van, schemes, territories) show only when the distributor switch is on: a DISTRIBUTOR always has it, a wholesaler when the owner or Super Admin turned it on. */
export const isDistributor = (b: TypeOf): boolean => isWholesale(b) && (b?.business_type === 'DISTRIBUTOR' || Boolean(b?.distributor_enabled));
