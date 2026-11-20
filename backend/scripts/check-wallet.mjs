/* Checks Google Wallet is set up right, without changing anything: node scripts/check-wallet.mjs
   1. the issuer id and service account key are read, 2. Google accepts the key, 3. the account can see your issuer. Prints no secrets. */
import 'dotenv/config';
import { account, accessToken } from '../src/modules/walletGoogle.js';

const a = account();
if (!a) { console.log('X Not set up: GOOGLE_WALLET_ISSUER_ID and GOOGLE_WALLET_SERVICE_ACCOUNT (or _JSON) are missing or unreadable in backend/.env'); process.exit(1); }
console.log(`OK Issuer id ${a.issuerId}, service account ${a.email}`);
let t;
try { t = await accessToken(a); console.log('OK Google accepted the service account key'); }
catch (e) { console.log(`X ${e.message}. Is the Google Wallet API enabled in that Cloud project, and is the key file the right one?`); process.exit(1); }
const res = await fetch('https://walletobjects.googleapis.com/walletobjects/v1/issuer', { headers: { Authorization: `Bearer ${t}` } });
const body = await res.json().catch(() => ({}));
if (!res.ok) { console.log(`X Google refused the issuer list (${res.status}): ${body.error?.message || ''}`); process.exit(1); }
const mine = (body.resources || []).find((i) => String(i.issuerId) === a.issuerId);
console.log(mine ? `OK The service account can use issuer ${a.issuerId} (${mine.name || 'unnamed'})` : `X The service account cannot see issuer ${a.issuerId}. In the Pay & Wallet Console, Users, add ${a.email} as a Developer.`);
process.exit(mine ? 0 : 1);
