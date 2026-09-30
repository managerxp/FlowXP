/*
 * The activity log learns which outlet an action happened at, so a pinned admin
 * sees their own outlet's activity and the owner can filter by outlet. Older
 * rows keep NULL (business-level). The extra index serves "what did this person
 * do" without scanning the whole log.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE audit_log ADD COLUMN branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL`);
  await client.query(`CREATE INDEX idx_audit_user_time ON audit_log (business_id, user_id, created_at DESC)`);
  await client.query(`CREATE INDEX idx_audit_branch_time ON audit_log (business_id, branch_id, created_at DESC)`);
};
