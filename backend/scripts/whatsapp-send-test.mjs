// Sends salon WhatsApp templates, filled with sample values, to ONE number you choose, so each approved template can be checked on a real phone.
// Uses the WhatsApp settings of the machine it runs on (Super Admin > Settings > Messaging, else .env). Writes nothing to the database. Meta charges for each message.
//   node scripts/whatsapp-send-test.mjs <mobile>                        four: UPI payment, bill, appointment booked, offer (marketing)
//   node scripts/whatsapp-send-test.mjs <mobile> all                    every template a salon uses
//   node scripts/whatsapp-send-test.mjs <mobile> OFFER SALON_REVISIT    only these
//   add --token=<the end of a real bill link> so the Pay by UPI, View Invoice and Rate Us buttons open that bill
import { TEMPLATES, render, kindsForType } from '../src/modules/messaging/templates.js';
import { deliver, providerName } from '../src/modules/messaging/provider.js';
import pool from '../src/config/database.js';

const args = process.argv.slice(2);
const token = args.find((a) => a.startsWith('--token='))?.slice(8) || 'abc123';
const [phone, ...asked] = args.filter((a) => !a.startsWith('--'));
const salon = kindsForType('SALON');
const kinds = asked[0] === 'all' ? salon : asked.length ? asked : ['UPI_PAYMENT', 'BILL', 'SALON_APPT_BOOKED', 'OFFER'];

const SAMPLE = {
  name: 'Asha', business: 'Glow Salon & Spa', number: 'INV-2026-00125', amount: '₹1,500', total: '₹1,500', services: 'Haircut, Beard Trim', when: 'Sat 28 Nov, 6:30 pm', status: 'Paid in full',
  closing: 'We hope you love your new look.', offer: '10% off this weekend', plan: 'Gold Membership', date: '15 Dec 2026', points: '240', days: '21', earned: '20', balance: '240',
  reward: 'free hair spa', bills: 'INV-2026-00125', reply: 'Thank you for your kind words.', code: '123456', text: 'sign in', link: `https://flowxp.in/bill/${token}`, token
};

if (!/^\+?[\d\s-]{10,16}$/.test(phone || '') || kinds.some((k) => !TEMPLATES[k])) {
  console.log(`Use: node scripts/whatsapp-send-test.mjs <mobile> [all | KIND ...] [--token=...]\nSalon kinds: ${salon.join(' ')}`);
  process.exitCode = 1;
} else {
  const provider = await providerName();
  console.log(`Provider: ${provider}${provider === 'log' ? ' (nothing is really sent from this machine)' : ''}`);
  let failed = 0;
  for (const kind of kinds) {
    const label = `${kind} (${TEMPLATES[kind].name}${TEMPLATES[kind].promo ? ', marketing' : ''})`;
    try {
      const message = render(kind, SAMPLE);
      const r = await deliver({ channel: 'WHATSAPP', to: phone, kind, ...message });
      console.log(`${r.status === 'SENT' ? 'ACCEPTED' : r.status}  ${label}${r.note ? ` - ${r.note}` : ''}`);
    } catch (error) { failed += 1; console.log(`FAILED    ${label} - ${error.message}`); }
  }
  console.log('ACCEPTED means Meta took the message; check the phone to see that it arrived.');
  if (failed) process.exitCode = 1;
}
await pool.end();
