/*
 * Magicpin adapter — MOCK. Same contract and the same caveat as the other
 * three: no partner account exists, so this stands in for the real API at
 * the exact seam a working one would occupy.
 */
export const PLATFORM = 'MAGICPIN';

export const generateSamplePayload = () => ({
  orderId: `MGP${Math.floor(100000 + Math.random() * 900000)}`,
  orderRef: `MP-${Math.floor(1000 + Math.random() * 9000)}`,
  customer: { fullName: 'Sana Sheikh', contactNumber: '+919555566677' },
  lineItems: [
    { title: 'Veg Thali', qty: 1, rate: 180 },
    { title: 'Sweet Lassi', qty: 2, rate: 60 }
  ],
  remarks: null
});

export const parseWebhookOrder = (payload) => {
  const items = payload?.lineItems;
  if (!payload?.orderId || !Array.isArray(items) || !items.length) {
    throw new Error('Malformed Magicpin order payload');
  }
  return {
    external_order_id: String(payload.orderId),
    external_order_number: payload.orderRef || String(payload.orderId),
    customer_name: payload.customer?.fullName || 'Magicpin customer',
    customer_phone: payload.customer?.contactNumber || null,
    items: items.map((i) => ({
      description: i.title, quantity: Number(i.qty) || 1, unit_price: Number(i.rate) || 0
    })),
    notes: payload.remarks || null
  };
};

export const pushMenu = async (products) => ({
  platform: PLATFORM, synced: products.length, failed: 0, synced_at: new Date().toISOString()
});

export const pushOrderStatus = async (order, status) => ({
  platform: PLATFORM, external_order_id: order.external_order_id, status, acknowledged: true
});

export const verifySignature = () => true;
