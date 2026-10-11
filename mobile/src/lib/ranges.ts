/* The date ranges the Sales and Reports pages offer, as YYYY-MM-DD in the phone's own calendar (the server reads them as the business's days). */
export type Range = { id: 'today' | 'yesterday' | '7d' | '30d' | 'month'; label: string; from: string; to: string };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const back = (from: Date, days: number) => { const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - days); return d; };

export const ranges = (now: Date = new Date()): Range[] => {
  const today = iso(now);
  return [
    { id: 'today', label: 'Today', from: today, to: today },
    { id: 'yesterday', label: 'Yesterday', from: iso(back(now, 1)), to: iso(back(now, 1)) },
    { id: '7d', label: '7 days', from: iso(back(now, 6)), to: today },
    { id: '30d', label: '30 days', from: iso(back(now, 29)), to: today },
    { id: 'month', label: 'This month', from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today }
  ];
};

/** Heights (0 to 1) for a small bar chart: the biggest value is full height, zero is a hairline so an empty day is still visible. */
export const barHeights = (values: number[]): number[] => {
  const max = Math.max(0, ...values);
  return values.map((v) => (max <= 0 ? 0.02 : Math.max(0.02, v / max)));
};

/** "5 min ago", "2 h ago", or the date: for the "showing what was saved" note. */
export const ago = (at: number, now: number = Date.now()): string => {
  const m = Math.round((now - at) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  return new Date(at).toLocaleDateString();
};
