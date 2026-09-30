/*
 * Ensures the platform's super admin account exists, from env, at boot —
 * the same "schema and seed data live in code, boot is the migration"
 * approach as the plans seed in database.js.
 *
 * Only the flag is enforced on every boot, never the password: an
 * ON CONFLICT that also overwrote password_hash would silently undo a
 * password the admin changed after first login, the next time the server
 * restarts.
 */
import bcrypt from 'bcryptjs';
import pool from './database.js';
import config from './env.js';
import { normaliseEmail } from '../utils/validate.js';

const BCRYPT_ROUNDS = 12;

export const ensureSuperAdmin = async () => {
  const { email: rawEmail, password } = config.superAdmin;
  const email = normaliseEmail(rawEmail);

  if (!email || !password) {
    console.warn('[super-admin] SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set in .env — no super admin account seeded');
    return;
  }

  const { rows } = await pool.query('SELECT user_id FROM users WHERE email = $1', [email]);

  if (rows.length) {
    await pool.query('UPDATE users SET is_super_admin = TRUE WHERE user_id = $1', [rows[0].user_id]);
  } else {
    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, email_verified, is_super_admin)
       VALUES ('Super Admin', $1, $2, TRUE, TRUE)`,
      [email, passwordHash]
    );
  }

  console.log(`[super-admin] ready: ${email}`);
};

export default ensureSuperAdmin;
