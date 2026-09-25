/*
 * Flow AI, the manager's assistant.
 *
 * Conversations and messages are stored so an owner can see what was asked and
 * answered (an audit trail for a feature that reads business data), and so a
 * follow-up question has its history. ai_usage is the meter behind the plan's
 * monthly ai_queries allowance. businesses.ai_enabled lets an owner switch the
 * whole feature off: nothing is then sent to the AI provider.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN ai_enabled BOOLEAN NOT NULL DEFAULT TRUE`);

  await client.query(`
    CREATE TABLE ai_conversations (
      conversation_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      title VARCHAR(120) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_ai_conversations_user ON ai_conversations (business_id, user_id, updated_at DESC)`);

  await client.query(`
    CREATE TABLE ai_messages (
      message_id BIGSERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES ai_conversations(conversation_id) ON DELETE CASCADE,
      role VARCHAR(10) NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT NOT NULL,
      tools JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_ai_messages_conversation ON ai_messages (conversation_id, message_id)`);

  await client.query(`
    CREATE TABLE ai_usage (
      usage_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      conversation_id INTEGER REFERENCES ai_conversations(conversation_id) ON DELETE SET NULL,
      model VARCHAR(60),
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_ai_usage_business_month ON ai_usage (business_id, created_at)`);
};
