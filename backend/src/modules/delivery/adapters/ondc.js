/*
 * ONDC adapter — MOCK, and a bigger simplification than the others.
 *
 * ONDC isn't a single company's API: it's an open, government-backed
 * network built on the Beckn protocol, and a real integration goes through a
 * registered "Seller Network Participant" (an approved ONDC technology
 * provider), not a direct webhook from a merchant's own server. Real Beckn
 * order payloads are deeply nested (context/message/order with catalog
 * references, fulfilment objects, signed headers per the Beckn spec).
 *
 * This adapter normalizes a deliberately flattened approximation of that
 * shape — enough to exercise the same orders pipeline the other three
 * platforms use — not a compliant Beckn client. A real ONDC integration
 * replaces this whole file with a Seller App SDK or a registered NP's
 * client library.
 */
export const PLATFORM = 'ONDC';

export const generateSamplePayload = () => ({
  context: { transaction_id: `ondc-txn-${Date.now()}`, action: 'on_confirm' },
  message: {
    order: {
      id: `ONDC${Math.floor(100000 + Math.random() * 900000)}`,
      billing: { name: 'Karthik Iyer', phone: '+919000011122' },
      items: [
        { descriptor: { name: 'Masala Dosa' }, quantity: { count: 2 }, price: { value: '90' } },
        { descriptor: { name: 'Filter Coffee' }, quantity: { count: 2 }, price: { value: '30' } }
      ],
      note: null
    }
  }
});

export const parseWebhookOrder = (payload) => {
  const order = payload?.message?.order;
  if (!order?.id || !Array.isArray(order.items) || !order.items.length) {
    throw new Error('Malformed ONDC order payload');
  }
  return {
    external_order_id: String(order.id),
    external_order_number: payload?.context?.transaction_id || String(order.id),
    customer_name: order.billing?.name || 'ONDC customer',
    customer_phone: order.billing?.phone || null,
    items: order.items.map((i) => ({
      description: i.descriptor?.name || 'Item',
      quantity: Number(i.quantity?.count) || 1,
      unit_price: Number(i.price?.value) || 0
    })),
    notes: order.note || null
  };
};

export const pushMenu = async (products) => ({
  platform: PLATFORM, synced: products.length, failed: 0, synced_at: new Date().toISOString()
});

export const pushOrderStatus = async (order, status) => ({
  platform: PLATFORM, external_order_id: order.external_order_id, status, acknowledged: true
});

/* ponytail: Beckn's real transport is signed request headers (Ed25519), not
   a shared secret. Replace once this business registers with an ONDC Seller
   Network Participant and has real signing keys to check against. */
export const verifySignature = () => true;
