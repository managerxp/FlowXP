/* node scripts/reencrypt-secrets.mjs [--dry]
   Moves every stored secret (2FA secrets, payment / email / messaging keys) from the JWT_SECRET key to ENCRYPTION_KEY. Safe to run twice; values
   already on the new key are left alone. Run it once after setting ENCRYPTION_KEY, and only then rotate JWT_SECRET if you ever need to. */
import pool from '../src/config/database.js';
import config from '../src/config/env.js';
import { decrypt, encrypt, needsReencrypt } from '../src/modules/crypto.js';
import { getPlatformSetting, setPlatformSetting } from '../src/modules/platformSettings.js';

const dry = process.argv.includes('--dry');
if (!config.encryptionKey) { console.error('Set ENCRYPTION_KEY (32 or more characters) first.'); process.exit(1); }
let moved = 0;
for (const column of ['totp_secret_enc', 'totp_pending_enc']) {
  const { rows } = await pool.query(`SELECT user_id, ${column} AS v FROM users WHERE ${column} IS NOT NULL`);
  for (const r of rows) {
    if (!needsReencrypt(r.v)) continue;
    moved++;
    if (!dry) await pool.query(`UPDATE users SET ${column} = $2 WHERE user_id = $1`, [r.user_id, encrypt(decrypt(r.v, 'flowxp-2fa'), 'flowxp-2fa')]);
  }
}
for (const { setting_key: key } of (await pool.query(`SELECT setting_key FROM platform_settings`)).rows) {
  const raw = (await pool.query(`SELECT value FROM platform_settings WHERE setting_key = $1`, [key])).rows[0].value;
  if (!JSON.stringify(raw).includes('"v1:')) continue;
  moved++;
  if (!dry) await setPlatformSetting(key, (await getPlatformSetting(key)).value, null);   // reads with the old key, writes with the new
}
console.log(`${dry ? 'Would move' : 'Moved'} ${moved} stored secret${moved === 1 ? '' : 's'} to ENCRYPTION_KEY.`);
await pool.end();
