/* Stock requests between outlets (the server owns them: /transfer-requests). The rules the screens use: what an asked-for list looks like, what may be sent, and the sentence when something is missing. */
export type RequestItem = { item_id: number; product_id: number; name: string; unit: string | null; requested: number; sent: number; remaining: number };
export type StockRequest = {
  request_id: number; status: 'PENDING' | 'PARTIAL' | 'FULFILLED' | 'REJECTED' | 'CANCELLED' | 'CLOSED'; notes: string | null; decision_note: string | null; created_at: string;
  from_branch_id: number; from_name: string; to_branch_id: number; to_name: string; items: RequestItem[];
};
export type AskLine = { product_id: number; name: string; unit: string | null; quantity: string };

export const isOpen = (r: Pick<StockRequest, 'status'>): boolean => r.status === 'PENDING' || r.status === 'PARTIAL';

export const addAsk = (lines: AskLine[], p: { product_id: number; name: string; unit: string | null }): AskLine[] =>
  lines.some((l) => l.product_id === p.product_id) ? lines : [...lines, { product_id: p.product_id, name: p.name, unit: p.unit, quantity: '' }];
export const setAskQty = (lines: AskLine[], id: number, quantity: string): AskLine[] => lines.map((l) => (l.product_id === id ? { ...l, quantity: quantity.replace(/[^0-9.]/g, '') } : l));
export const dropAsk = (lines: AskLine[], id: number): AskLine[] => lines.filter((l) => l.product_id !== id);

/** The sentence for what is missing before a request can be sent, or '' when it is ready. */
export const askProblem = (fromBranchId: number | null, lines: AskLine[]): string => {
  if (!fromBranchId) return 'Choose the outlet you are asking.';
  if (!lines.some((l) => Number(l.quantity) > 0)) return 'Add an item and how much of it you need.';
  return '';
};
export const askBody = (fromBranchId: number, lines: AskLine[], notes: string) => ({
  from_branch_id: fromBranchId, ...(notes.trim() ? { notes: notes.trim() } : {}),
  items: lines.filter((l) => Number(l.quantity) > 0).map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) }))
});

/** What to send, one entry per item still owed: the typed amount (never above what remains), the full remainder when nothing is typed; items sent as 0 are left out. */
export const sendBody = (r: StockRequest, typed: Record<number, string>) => ({
  items: r.items.map((i) => {
    const t = typed[i.item_id];
    const q = t === undefined || t === '' ? i.remaining : Math.min(Number(t) || 0, i.remaining);
    return { item_id: i.item_id, quantity: q };
  }).filter((i) => i.quantity > 0)
});
