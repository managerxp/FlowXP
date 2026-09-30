/*
 * Zomato adapter — MOCK.
 *
 * Zomato's real Partner API requires a registered restaurant account and an
 * approved integration; neither exists here. This adapter defines the exact
 * seam a real one would fill — parseWebhookOrder, pushMenu, pushOrderStatus,
 * verifySignature — with deterministic, clearly-fake responses. Swapping in
 * the real HTTP calls and signature check later means rewriting this one
 * file; nothing that imports it (registry.js, integrations.controller.js)
 * needs to change.
 *
 * The webhook payload shape below is a reasonable approximation based on how
 * food-delivery order webhooks are publicly known to be structured — it is
 * NOT verified against Zomato's actual partner documentation, which is not
 * publicly accessible without a partner account.
 */
export const PLATFORM = 'ZOMATO';

/** A realistic-looking incoming order, for demos and tests — not real traffic. */
export const generateSamplePayload = () => ({
  order: {
    id: `ZOM${Math.floor(100000 + Math.random() * 900000)}`,
    display_id: `#${Math.floor(1000 + Math.random() * 9000)}`,
    customer: { name: 'Rahul Mehta', phone: '+919876543210' },
    items: [
      { name: 'Paneer Butter Masala', quantity: 1, price: 240 },
      { name: 'Butter Naan', quantity: 3, price: 45 }
    ],
    instructions: 'Please pack cutlery separately.'
  }
});

/** Zomato's shape → the normalized shape orders.controller.js expects. */
export const parseWebhookOrder = (payload) => {
  const order = payload?.order;
  if (!order?.id || !Array.isArray(order.items) || !order.items.length) {
    throw new Error('Malformed Zomato order payload');
  }
  return {
    external_order_id: String(order.id),
    external_order_number: order.display_id || String(order.id),
    customer_name: order.customer?.name || 'Zomato customer',
    customer_phone: order.customer?.phone || null,
    items: order.items.map((i) => ({
      description: i.name, quantity: Number(i.quantity) || 1, unit_price: Number(i.price) || 0
    })),
    notes: order.instructions || null
  };
};

/** Push the catalogue to Zomato. Mock: logs and reports success for every item. */
export const pushMenu = async (products) => ({
  platform: PLATFORM, synced: products.length, failed: 0, synced_at: new Date().toISOString()
});

/** Tell Zomato an order moved to READY / CANCELLED / etc. Mock: acknowledged. */
export const pushOrderStatus = async (order, status) => ({
  platform: PLATFORM, external_order_id: order.external_order_id, status, acknowledged: true
});

/* ponytail: no real signature check exists to run — Zomato's webhook signing
   scheme is only documented to partners. Replace with an HMAC check against
   the request's signature header once partner credentials exist. */
export const verifySignature = () => true;
