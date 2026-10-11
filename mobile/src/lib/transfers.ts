import type { WProduct } from './wholesale.ts';

export type TStatus = 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
export type Transfer = {
  transfer_id: number; transfer_number: string; status: TStatus; from_branch_id: number; from_warehouse: string; to_branch_id: number; to_warehouse: string;
  notes: string | null; vehicle_no: string | null; created_at: string; dispatched_at: string | null; received_at: string | null; lines?: number; units?: number;
};
export type TItem = { item_id: number; product_id: number; product: string; unit: string | null; qty_base: number; received_base: number; damaged_base: number; short_base?: number; batches: { batch_no: string; expiry_date: string | null; qty_base: number }[] };
export type TransferDetail = Transfer & { items: TItem[] };
export type Warehouse = { branch_id: number; name: string; city?: string | null; is_primary?: boolean };

export const STATUS_LABEL: Record<TStatus, string> = { DRAFT: 'Not sent yet', IN_TRANSIT: 'On the way', RECEIVED: 'Received', CANCELLED: 'Cancelled' };

/** Which buttons a transfer offers: send it, receive it, or drop it. */
export const transferActions = (t: Pick<Transfer, 'status'>): { id: 'send' | 'receive' | 'cancel'; label: string }[] =>
  t.status === 'DRAFT' ? [{ id: 'send', label: 'Send it now' }, { id: 'cancel', label: 'Drop it' }]
    : t.status === 'IN_TRANSIT' ? [{ id: 'receive', label: 'Mark as received' }, { id: 'cancel', label: 'Cancel: goods go back' }] : [];

export const transferText = (t: Transfer): string => `${t.from_warehouse} to ${t.to_warehouse}${t.lines != null ? ` · ${t.lines} item${t.lines === 1 ? '' : 's'}` : ''}`;

/* ── a new transfer ─────────────────────────────────────────────────────── */
export type TLine = { product: WProduct; unit_name: string | null; quantity: string };

export const addTLine = (lines: TLine[], product: WProduct): TLine[] =>
  lines.some((l) => l.product.product_id === product.product_id) ? lines : [...lines, { product, unit_name: null, quantity: '1' }];
export const setTQty = (lines: TLine[], id: number, quantity: string): TLine[] => lines.map((l) => (l.product.product_id === id ? { ...l, quantity } : l));
export const setTUnit = (lines: TLine[], id: number, unit: string | null): TLine[] => lines.map((l) => (l.product.product_id === id ? { ...l, unit_name: unit } : l));
export const dropTLine = (lines: TLine[], id: number): TLine[] => lines.filter((l) => l.product.product_id !== id);

export const transferProblem = (from: number | null, to: number | null, lines: TLine[]): string => {
  if (from == null) return 'Choose the warehouse the goods leave from';
  if (to == null) return 'Choose the warehouse they go to';
  if (from === to) return 'Choose two different warehouses';
  const used = lines.filter((l) => Number(l.quantity) > 0);
  if (!used.length) return 'Add the items and how many';
  if (lines.some((l) => l.quantity.trim() !== '' && !(Number(l.quantity) > 0))) return 'Each quantity must be more than zero';
  return '';
};

export const transferBody = (from: number, to: number, lines: TLine[], extra: { vehicle?: string; notes?: string; sendNow?: boolean } = {}) => ({
  from_branch_id: from, to_branch_id: to,
  items: lines.filter((l) => Number(l.quantity) > 0).map((l) => ({ product_id: l.product.product_id, quantity: Number(l.quantity), ...(l.unit_name ? { unit_name: l.unit_name } : {}) })),
  ...(extra.vehicle?.trim() ? { vehicle_no: extra.vehicle.trim() } : {}), ...(extra.notes?.trim() ? { notes: extra.notes.trim() } : {}),
  ...(extra.sendNow ? { dispatch: true } : {})
});

/* ── receiving ──────────────────────────────────────────────────────────── */
export type RLine = { item: TItem; good: string; damaged: string };

/** Starts as "everything arrived in good condition": the person only changes what differs. */
export const startReceive = (items: TItem[]): RLine[] => items.map((item) => ({ item, good: String(item.qty_base), damaged: '0' }));
export const setGood = (lines: RLine[], id: number, good: string): RLine[] => lines.map((l) => (l.item.item_id === id ? { ...l, good } : l));
export const setDamaged = (lines: RLine[], id: number, damaged: string): RLine[] => lines.map((l) => (l.item.item_id === id ? { ...l, damaged } : l));

export const receiveProblem = (lines: RLine[]): string => {
  for (const l of lines) {
    const g = Number(l.good || 0); const d = Number(l.damaged || 0);
    if (!(g >= 0) || !(d >= 0)) return `${l.item.product}: enter a number`;
    if (g + d > l.item.qty_base + 1e-9) return `${l.item.product}: more than the ${l.item.qty_base} that was sent`;
  }
  return '';
};
/** How many of an item did not turn up (sent, less good, less damaged). */
export const shortBy = (l: RLine): number => Math.max(0, Math.round((l.item.qty_base - Number(l.good || 0) - Number(l.damaged || 0)) * 1000) / 1000);
export const receiveBody = (lines: RLine[]) => ({ items: lines.map((l) => ({ item_id: l.item.item_id, received_base: Number(l.good || 0), damaged_base: Number(l.damaged || 0) })) });
export const receiveSummary = (lines: RLine[]): string => {
  const short = lines.filter((l) => shortBy(l) > 0).length; const dmg = lines.filter((l) => Number(l.damaged) > 0).length;
  return short || dmg ? `${short ? `${short} item${short === 1 ? ' is' : 's are'} short` : ''}${short && dmg ? ', ' : ''}${dmg ? `${dmg} item${dmg === 1 ? ' has' : 's have'} damaged goods` : ''}. Short goods are not added to this warehouse.` : 'Everything arrived in good condition.';
};
