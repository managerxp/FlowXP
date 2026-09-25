/*
 * Idempotency keys for money-moving POSTs (see middleware/idempotency.js), and
 * a uniqueness rule so a re-delivered delivery-platform webhook can't create a
 * second order for the same external order.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE idempotency_keys (
      -- "b:<business_id>" for signed-in routes, "t:<qr token>" for the public
      -- ordering route: a key from one tenant can never replay another's.
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      method VARCHAR(8) NOT NULL,
      path TEXT NOT NULL,
      request_hash CHAR(64) NOT NULL,
      status VARCHAR(12) NOT NULL CHECK (status IN ('IN_PROGRESS','DONE')),
      response_status INTEGER,
      response_body JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (scope, key)
    )
  `);
  await client.query(`CREATE INDEX idx_idempotency_created ON idempotency_keys (created_at)`);

  await client.query(`
    CREATE UNIQUE INDEX uq_orders_external
      ON orders (business_id, platform, external_order_id)
      WHERE external_order_id IS NOT NULL
  `);
};
