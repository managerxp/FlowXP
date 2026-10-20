/* Online and delivery orders on a phone: the orders that wait to be accepted (Zomato, Swiggy, ONDC, Magicpin, QR and website orders), and a delivery's rider and its steps.
   The server decides; these only shape what a screen shows and sends. Accepting sends the order to the kitchen, as "send to kitchen" does for a table. */

export type PendingOrder = {
  order_id: number; order_number: string; platform: string | null; external_order_number: string | null; notes: string | null; created_at: string;
  customer_name: string | null; customer_phone: string | null; items: { order_item_id: number; description: string; quantity: number; unit_price: number }[];
};
export type Rider = { user_id: number; name: string; role?: string };
export type DeliveryOrder = {
  order_id: number; order_number: string; order_type: string; status: string; customer_name: string | null; rider_user_id: number | null; rider_name: string | null;
  picked_up_at: string | null; out_for_delivery_at: string | null; delivered_at: string | null; summary?: { items: number; estimate: string | number } | null;
};
export type Step = 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED';

const PLATFORMS: Record<string, string> = { ZOMATO: 'Zomato', SWIGGY: 'Swiggy', ONDC: 'ONDC', MAGICPIN: 'Magicpin', QR: 'QR order', WEBSITE: 'Website' };
export const platformLabel = (p: string | null | undefined): string => (p ? PLATFORMS[p.toUpperCase()] ?? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : 'Online');

/** "3 min ago", "just now". */
export const waitedText = (iso: string, now = Date.now()): string => {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'just now' : m === 1 ? '1 min ago' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};

/** The order's total from its lines, before GST (the server prices the bill). */
export const pendingTotal = (o: Pick<PendingOrder, 'items'>): number => Math.round(o.items.reduce((s, i) => s + i.quantity * i.unit_price, 0) * 100) / 100;

/** One-line summary of what is ordered: "2 x Paneer tikka, 1 x Naan". */
export const itemsText = (o: Pick<PendingOrder, 'items'>, max = 3): string => {
  const parts = o.items.map((i) => `${i.quantity} x ${i.description}`);
  return parts.length <= max ? parts.join(', ') : `${parts.slice(0, max).join(', ')} and ${parts.length - max} more`;
};

/** The next step a delivery can take, or null: a rider must be chosen first and each step follows the one before. */
export const nextStep = (o: Pick<DeliveryOrder, 'rider_user_id' | 'picked_up_at' | 'out_for_delivery_at' | 'delivered_at'>): Step | null => {
  if (!o.rider_user_id || o.delivered_at) return null;
  if (!o.picked_up_at) return 'PICKED_UP';
  if (!o.out_for_delivery_at) return 'OUT_FOR_DELIVERY';
  return 'DELIVERED';
};
export const STEP_LABEL: Record<Step, string> = { PICKED_UP: 'Picked up', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered' };

/** Where a delivery stands, in words. */
export const deliveryStage = (o: Pick<DeliveryOrder, 'rider_user_id' | 'picked_up_at' | 'out_for_delivery_at' | 'delivered_at'>): string =>
  o.delivered_at ? 'Delivered' : o.out_for_delivery_at ? 'Out for delivery' : o.picked_up_at ? 'Picked up' : o.rider_user_id ? 'Rider assigned' : 'Needs a rider';

/** What is sent when an order is turned down: the reason is optional, trimmed and cut to what the server keeps. */
export const rejectBody = (reason: string) => (reason.trim() ? { reason: reason.trim().slice(0, 300) } : {});

/** Orders that have come in since the last look: true when the count has gone up (the phone vibrates). */
export const hasNewOrders = (before: number, now: number): boolean => now > before;
