/*
 * Gym enquiries: people who asked about joining, the follow-up calls made to them, and what became of them (joined, or lost with a reason).
 * Forward only. To undo by hand: DROP TABLE gym_enquiry_notes; DROP TABLE gym_enquiries.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE gym_enquiries (
      enquiry_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      name VARCHAR(160) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      source VARCHAR(12) NOT NULL DEFAULT 'WALK_IN' CHECK (source IN ('WALK_IN','PHONE','WHATSAPP','INSTAGRAM','REFERRAL','WEBSITE','OTHER')),
      interest VARCHAR(200),
      status VARCHAR(8) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','JOINED','LOST')),
      next_follow_up DATE,
      lost_reason VARCHAR(200),
      member_id INTEGER REFERENCES gym_members(member_id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ
    )`);
  await client.query(`CREATE INDEX idx_gym_enquiries_open ON gym_enquiries (business_id, status, next_follow_up)`);
  await client.query(`
    CREATE TABLE gym_enquiry_notes (
      note_id SERIAL PRIMARY KEY,
      enquiry_id INTEGER NOT NULL REFERENCES gym_enquiries(enquiry_id) ON DELETE CASCADE,
      note VARCHAR(500) NOT NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await client.query(`CREATE INDEX idx_gym_enquiry_notes ON gym_enquiry_notes (enquiry_id, note_id DESC)`);
};
