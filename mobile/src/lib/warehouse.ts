/* The warehouse: orders waiting to be picked, a pick list (what to take, from where), packing, dispatch (the delivery challan and the bill are made together) and the delivery on the road. The server owns stock and numbering; these only shape what is sent and read what comes back. */

export type PickStatus = 'PENDING' | 'PICKING' | 'PICKED' | 'PACKING' | 'PACKED' | 'DISPATCHED' | 'CANCELLED';
export type PickList = { pick_id: number; pick_number: string; status: PickStatus; order_id: number; order_number: string; customer: string; warehouse: string; picker_name: string | null; items?: number; units?: number; created_at: string };
export type PickItem = {
  pick_item_id: number; order_item_id: number; product_id: number; product: string; sku: string | null; base_unit: string | null; unit_name: string | null; unit_factor: number;
  location: string | null; qty_base: number; picked_base: number; serials: string[]; batches: { batch_id: number; batch_no: string; expiry_date: string | null; qty_base: number }[];
};
export type PickDetail = PickList & { items: PickItem[]; packages: { package_id: number; package_no: string; weight_kg: number | null }[] };
export type DeliveryStatus = 'PENDING' | 'ASSIGNED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'PARTIAL' | 'FAILED' | 'RETURNED';
export type Delivery = {
  delivery_id: number; challan_number: string; status: DeliveryStatus; order_id: number; order_number: string; customer: string; invoice_id: number | null; invoice_number: string | null; invoice_total: number | null;
  driver_name: string | null; driver_phone: string | null; vehicle_no: string | null; delivery_address: string | null; dispatch_date: string; expected_date: string | null; delivered_at: string | null;
  packages_count: number; pod_received_by: string | null; failure_reason: string | null;
};
export type Board = { orders_to_pick: number; pick_lists: Partial<Record<PickStatus, number>>; deliveries: Partial<Record<DeliveryStatus, number>> };
export type ToPick = { order_id: number; order_number: string; customer: string; order_date: string; total: number; lines?: number; status: string };

export const PICK_LABEL: Record<PickStatus, string> = { PENDING: 'Not started', PICKING: 'Being picked', PICKED: 'Picked', PACKING: 'Being packed', PACKED: 'Packed', DISPATCHED: 'Sent out', CANCELLED: 'Cancelled' };
export const DELIVERY_LABEL: Record<DeliveryStatus, string> = { PENDING: 'No driver yet', ASSIGNED: 'Ready to go', OUT_FOR_DELIVERY: 'On the way', DELIVERED: 'Delivered', PARTIAL: 'Delivered in part', FAILED: 'Could not deliver', RETURNED: 'Came back' };

/** What the pick screen does next for a list in this state. */
export const pickNext = (s: PickStatus): 'start' | 'pick' | 'pack' | 'dispatch' | null => (s === 'PENDING' ? 'start' : s === 'PICKING' ? 'pick' : s === 'PICKED' || s === 'PACKING' ? 'pack' : s === 'PACKED' ? 'dispatch' : null);

/* ── quantities: the list is in base units, the order in the unit it was sold in (cartons) ── */
const clean = (n: number) => Math.round(n * 1000) / 1000;
/** How many of the sold unit a base quantity is (24 pieces of a 12-piece carton = 2 cartons). */
export const inUnit = (item: Pick<PickItem, 'unit_factor'>, baseQty: number): number => clean(baseQty / (item.unit_factor || 1));
export const unitText = (item: PickItem): string => item.unit_name || item.base_unit || '';
export const wantedText = (item: PickItem): string => `${inUnit(item, item.qty_base)} ${unitText(item)}`.trim();

/** What was picked, typed in the sold unit per item (blank means the whole amount); returns base quantities. */
export const pickedBase = (item: PickItem, typed: string | undefined): number => (typed === undefined || typed.trim() === '' ? item.qty_base : clean(Number(typed) * (item.unit_factor || 1)));

export const pickProblem = (items: PickItem[], typed: Record<number, string>): string => {
  let total = 0;
  for (const i of items) {
    const b = pickedBase(i, typed[i.pick_item_id]);
    if (!(b >= 0)) return `${i.product}: enter how many were picked`;
    if (b > i.qty_base + 1e-9) return `${i.product}: you cannot pick more than ${wantedText(i)}`;
    total += b;
  }
  return total > 0 ? '' : 'Nothing was picked. Cancel the pick list instead.';
};

export const pickBody = (items: PickItem[], typed: Record<number, string>) => ({ items: items.map((i) => ({ pick_item_id: i.pick_item_id, picked_base: pickedBase(i, typed[i.pick_item_id]) })) });

/** Items that were picked short of what was asked (the rest goes back to the order as a back-order). */
export const shortItems = (items: PickItem[], typed: Record<number, string>): { product: string; short: number; unit: string }[] =>
  items.flatMap((i) => { const b = pickedBase(i, typed[i.pick_item_id]); return b < i.qty_base - 1e-9 ? [{ product: i.product, short: inUnit(i, i.qty_base - b), unit: unitText(i) }] : []; });

/** A barcode read by the scanner, matched to the pick item for that product. */
export const matchScan = (items: PickItem[], productId: number | null): PickItem | null => (productId == null ? null : items.find((i) => i.product_id === productId) ?? null);

/** Everything picked goes in one package (the weight is optional); more boxes are set up on the website. */
export const packBody = (items: PickItem[], weight: string) => ({
  packages: [{ ...(Number(weight) > 0 ? { weight_kg: Number(weight) } : {}), items: items.filter((i) => i.picked_base > 0).map((i) => ({ pick_item_id: i.pick_item_id, qty_base: i.picked_base })) }]
});
export const packProblem = (weight: string): string => (weight.trim() !== '' && !(Number(weight) >= 0) ? 'The weight is not a number' : '');

/* ── dispatch ── */
export type Kind = 'TAX' | 'CASH' | 'CREDIT';
export const KIND_LABEL: Record<Kind, string> = { TAX: 'Tax invoice', CASH: 'Paid now', CREDIT: 'On credit' };
export const dispatchProblem = (kind: Kind, method: string, reference: string): string => (kind === 'CASH' && ['UPI', 'BANK_TRANSFER', 'CHEQUE'].includes(method) && !reference.trim() ? 'Enter the payment reference' : '');
export const dispatchBody = (a: { vehicle: string; driver: string; phone: string; kind: Kind; method: string; reference: string; address?: string }) => ({
  invoice_kind: a.kind,
  ...(a.vehicle.trim() ? { vehicle_no: a.vehicle.trim().toUpperCase() } : {}), ...(a.driver.trim() ? { driver_name: a.driver.trim() } : {}), ...(a.phone.trim() ? { driver_phone: a.phone.trim() } : {}),
  ...(a.address?.trim() ? { delivery_address: a.address.trim() } : {}),
  ...(a.kind === 'CASH' ? { payment: { amount: 'FULL', method: a.method, ...(a.reference.trim() ? { reference_number: a.reference.trim() } : {}) } } : {})
});

/* ── on the road ── */
export type DeliveryAction = { to: DeliveryStatus; label: string; ask: 'name' | 'reason' | null };
/** The next steps for a delivery. A part delivery (the shop refused some goods) needs a credit note and is done on the website. */
export const deliveryActions = (s: DeliveryStatus): DeliveryAction[] => {
  switch (s) {
    case 'PENDING': case 'ASSIGNED': return [{ to: 'OUT_FOR_DELIVERY', label: 'Out for delivery', ask: null }];
    case 'OUT_FOR_DELIVERY': return [{ to: 'DELIVERED', label: 'Delivered', ask: 'name' }, { to: 'FAILED', label: 'Could not deliver', ask: 'reason' }];
    case 'FAILED': return [{ to: 'OUT_FOR_DELIVERY', label: 'Try again', ask: null }, { to: 'RETURNED', label: 'Came back to the warehouse', ask: 'reason' }];
    default: return [];
  }
};
export const deliveryProblem = (a: DeliveryAction, who: string, reason: string): string => (a.ask === 'name' && !who.trim() ? 'Enter who received it' : a.ask === 'reason' && reason.trim().length < 3 ? 'Say why (a few words)' : '');
export const deliveryBody = (a: DeliveryAction, who: string, note: string, reason: string) => ({
  status: a.to, ...(a.ask === 'name' ? { pod_received_by: who.trim(), ...(note.trim() ? { pod_note: note.trim() } : {}) } : {}), ...(a.ask === 'reason' ? { failure_reason: reason.trim() } : {})
});

/** The warehouse board as short lines for the home of the warehouse screen. */
export const boardLines = (b: Board | null): { label: string; n: number; tone: 'warn' | 'ok' | 'plain' }[] => !b ? [] : [
  { label: 'Orders to pick', n: b.orders_to_pick, tone: b.orders_to_pick ? 'warn' : 'plain' },
  { label: 'Being picked', n: (b.pick_lists.PENDING ?? 0) + (b.pick_lists.PICKING ?? 0), tone: 'plain' },
  { label: 'Ready to pack', n: (b.pick_lists.PICKED ?? 0) + (b.pick_lists.PACKING ?? 0), tone: 'plain' },
  { label: 'Ready to send out', n: b.pick_lists.PACKED ?? 0, tone: (b.pick_lists.PACKED ?? 0) ? 'warn' : 'plain' },
  { label: 'On the road', n: (b.deliveries.OUT_FOR_DELIVERY ?? 0) + (b.deliveries.ASSIGNED ?? 0) + (b.deliveries.PENDING ?? 0), tone: 'plain' },
  { label: 'Could not deliver', n: b.deliveries.FAILED ?? 0, tone: (b.deliveries.FAILED ?? 0) ? 'warn' : 'ok' }
];
