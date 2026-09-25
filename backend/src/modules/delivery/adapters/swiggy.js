/*
 * Swiggy adapter — MOCK. Same contract and the same caveat as zomato.js: no
 * partner account exists, so this is a stand-in for the real Partner API,
 * built at the exact seam a real integration would occupy.
 */
export const PLATFORM = 'SWIGGY';

export const generateSamplePayload = () => ({
  order_id: `SW${Math.floor(100000 + Math.random() * 900000)}`,
  order_number: `SW-${Math.floor(1000 + Math.random() * 9000)}`,
  customer_details: { name: 'Ananya Rao', mobile: '+919812345678' },
  cart: {
    items: [
      { item_name: 'Chicken Biryani', quantity: 2, item_price: 220 },
      { item_name: 'Raita', quantity: 1, item_price: 40 }
    ]
  },
  special_instructions: 'Ring the bell twice.'
});

export const parseWebhookOrder = (payload) => {
  const items = payload?.cart?.items;
  if (!payload?.order_id || !Array.isArray(items) || !items.length) {
    throw new Error('Malformed Swiggy order payload');
  }
  return {
    external_order_id: String(payload.order_id),
    external_order_number: payload.order_number || String(payload.order_id),
    customer_name: payload.customer_details?.name || 'Swiggy customer',
    customer_phone: payload.customer_details?.mobile || null,
    items: items.map((i) => ({
      description: i.item_name, quantity: Number(i.quantity) || 1, unit_price: Number(i.item_price) || 0
    })),
    notes: payload.special_instructions || null
  };
};

export const pushMenu = async (products) => ({
  platform: PLATFORM, synced: products.length, failed: 0, synced_at: new Date().toISOString()
});

export const pushOrderStatus = async (order, status) => ({
  platform: PLATFORM, external_order_id: order.external_order_id, status, acknowledged: true
});

export const verifySignature = () => true;
