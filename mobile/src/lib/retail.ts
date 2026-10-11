/* Shops with batches and use-by dates (supermarket, retail): which businesses, and how an expiring batch reads. */
export const RETAIL_TYPES = ['SUPERMARKET', 'RETAIL'];

export type ExpiryRow = { batch_id: number; name: string; unit: string | null; batch_no: string; expiry_date: string; qty_on_hand: number; days_left: number; cost: number; value: number };
export type ExpirySummary = { summary: { expired: number; expiring: number; expired_value: number }; rows: ExpiryRow[] };

/** "Expired 3 days ago", "Last day today", "12 days left". */
export const daysText = (d: number): string => {
  if (d < 0) return `Expired ${-d} day${d === -1 ? '' : 's'} ago`;
  if (d === 0) return 'Last day today';
  return `${d} day${d === 1 ? '' : 's'} left`;
};

export const WHOLESALE_TYPES = ['WHOLESALE', 'DISTRIBUTOR'];
