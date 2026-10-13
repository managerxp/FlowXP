/*
 * Local testing only: put a known sign-in code in the database for a demo member, so the member page can be tried without a texting provider.
 *
 *   node scripts/gym-dev-login.js ironworks 9845000001
 *
 * Refuses to run in production (see no-production.js). Real codes are random, are sent to the member's phone, and are never printed or logged by the server.
 */
import './no-production.js';
import crypto from 'node:crypto';
import pool from '../src/config/database.js';
import config from '../src/config/env.js';
import { SQL_PHONE_KEY, phoneKey } from '../src/modules/gym/common.js';

const [slug, phone] = process.argv.slice(2);
if (!slug || !phone) { console.error('Usage: node scripts/gym-dev-login.js <gym-address> <member-phone>'); process.exit(1); }
const key = phoneKey(phone);
const gym = (await pool.query(`SELECT business_id FROM gym_settings WHERE lower(public_slug) = lower($1)`, [slug])).rows[0];
const member = gym && (await pool.query(
  `SELECT gm.member_id FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id WHERE gm.business_id = $1 AND ${SQL_PHONE_KEY('c.phone')} = $2 ORDER BY gm.member_id LIMIT 1`, [gym.business_id, key])).rows[0];
if (!member) { console.error('No such gym or member.'); process.exit(1); }
const code = '123456';
const hash = crypto.createHmac('sha256', config.jwtSecret).update(`gym-otp:${gym.business_id}:${key}:${code}`).digest('hex');
await pool.query(`UPDATE gym_member_otps SET consumed_at = now() WHERE business_id = $1 AND phone_key = $2 AND consumed_at IS NULL`, [gym.business_id, key]);
await pool.query(`INSERT INTO gym_member_otps (business_id, member_id, phone_key, code_hash, expires_at) VALUES ($1,$2,$3,$4, now() + interval '10 minutes')`, [gym.business_id, member.member_id, key, hash]);
console.log(`Sign in at /gym/${slug} with ${phone} and the code ${code} (valid for 10 minutes).`);
await pool.end();
