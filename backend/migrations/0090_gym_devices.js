/*
 * The gym module, part 4: gate and reader devices.
 *
 *   gym_devices        a registered reader or controller at one outlet, with its own signing secret (kept encrypted; the secret is shown once, when it is made or rotated)
 *   gym_gate_commands  the "open" a decision led to, and whether the device said it was done: a decision and a door opening are separate things, and this is the record of the second
 *
 * A device is only ever a client of FlowXP: it sends a signed request ("someone presented this credential") and acts on the answer. It never holds the member list.
 * Forward only. To undo by hand: drop these two tables.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE gym_devices (
      device_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      kind VARCHAR(12) NOT NULL CHECK (kind IN ('QR_READER','RFID_READER','TURNSTILE','CONTROLLER')),
      -- which adapter understands this device's payloads. GENERIC_HTTP is the only one built: a signed JSON request, described in GYM_DEVICES.md.
      adapter VARCHAR(20) NOT NULL DEFAULT 'GENERIC_HTTP',
      key_id VARCHAR(24) NOT NULL,
      secret_enc TEXT NOT NULL,
      -- after a rotation the old secret keeps working for a short while so a fleet can be updated without a gap
      prev_secret_enc TEXT,
      prev_valid_until TIMESTAMPTZ,
      secret_rotated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
      -- NONE: the device must ask every time. REPORT_ONLY: the device may let someone in on its own when it cannot reach us and report it later; FlowXP checks it afterwards.
      offline_policy VARCHAR(12) NOT NULL DEFAULT 'NONE' CHECK (offline_policy IN ('NONE','REPORT_ONLY')),
      last_seen_at TIMESTAMPTZ,
      health JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gym_device_key ON gym_devices (key_id)`);
  await client.query(`CREATE INDEX idx_gym_devices_branch ON gym_devices (business_id, branch_id)`);

  await client.query(`
    CREATE TABLE gym_gate_commands (
      command_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      device_id INTEGER NOT NULL REFERENCES gym_devices(device_id) ON DELETE CASCADE,
      access_event_id BIGINT REFERENCES gym_access_events(event_id) ON DELETE SET NULL,
      status VARCHAR(14) NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','OPENED','NOT_PASSED','FAILED','TIMED_OUT')),
      issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      acked_at TIMESTAMPTZ
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gym_command_event ON gym_gate_commands (access_event_id) WHERE access_event_id IS NOT NULL`);
  await client.query(`CREATE INDEX idx_gym_commands_open ON gym_gate_commands (device_id, issued_at) WHERE status = 'ISSUED'`);
};
