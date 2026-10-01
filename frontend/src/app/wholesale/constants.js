/* Shared look-ups for the wholesale screens that are not components. */

/* Ageing buckets: the colour of each (current → 90+ days). */
export const BUCKET_TONES = { current: 'bg-teal-500', d1_30: 'bg-amber-400', d31_60: 'bg-orange-500', d61_90: 'bg-red-400', d90_plus: 'bg-red-700' };
export const BUCKETS = [['current', 'Current'], ['d1_30', '1–30 days'], ['d31_60', '31–60 days'], ['d61_90', '61–90 days'], ['d90_plus', '90+ days']];
