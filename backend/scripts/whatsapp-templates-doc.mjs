/* Writes docs/whatsapp-templates.md: every WhatsApp template to create in Meta Business Manager, from the code (so it never drifts), most needed first.
   Run from backend:  node scripts/whatsapp-templates-doc.mjs */
import fs from 'node:fs';
import { TEMPLATES, metaBody } from '../src/modules/messaging/templates.js';

const READY = ['BILL'];   // approved in Meta already
const ORDER = [   // what most shops need first; anything not listed follows in file order
  'BALANCE_DUE', 'OFFER', 'LOYALTY_NEXT',
  'RESERVATION', 'RESERVATION_CANCELLED', 'WAITLIST_ADDED', 'WAITLIST_READY',
  'WS_ORDER_CONFIRMED', 'WS_INVOICE', 'WS_PAYMENT_RECEIVED', 'WS_PAYMENT_DUE', 'WS_PAYMENT_OVERDUE', 'WS_ORDER_DISPATCHED', 'WS_DELIVERY_UPDATE',
  'JOB_RECEIVED', 'JOB_ESTIMATE', 'JOB_READY', 'SERVICE_DUE'
];
const SAMPLE = { name: 'Rahul', business: 'Sharma Stores', total: 'Rs. 1,250.00', amount: 'Rs. 1,250.00', number: 'INV-0042', when: '12 Nov, 6:30 pm', status: 'Paid in full', closing: 'Thank you', bills: 'INV-0041', days: '30', minutes: '15', party: '4', vehicle: 'Swift KA01AB1234', job_no: 'JC-0007', date: '20 Nov', order: 'SO-0012' };

const kinds = Object.keys(TEMPLATES);
const sorted = [...ORDER.filter((k) => kinds.includes(k)), ...kinds.filter((k) => !ORDER.includes(k) && !READY.includes(k))];
const out = ['# WhatsApp templates to create in Meta', '', 'Create each once in Meta Business Manager > WhatsApp > Message templates. Language: English. Name, variable order and wording must match exactly (the text below is generated from `modules/messaging/templates.js`). Category: Utility for service messages, Marketing for offers.', '', `Already approved: ${READY.map((k) => `\`${TEMPLATES[k].name}\``).join(', ')}.`, '', `${sorted.length} left to create, most needed first.`, ''];
sorted.forEach((k, i) => {
  const t = TEMPLATES[k];
  out.push(`## ${i + 1}. \`${t.name}\` (${t.promo ? 'Marketing' : 'Utility'}) - ${k}`, '', '```', metaBody(k), '```', '', `Variables: ${t.vars.map((v, n) => `{{${n + 1}}} ${v} (e.g. ${SAMPLE[v] ?? 'sample'})`).join('; ')}`, '');
  if (t.urlButtons) out.push(`Buttons: ${t.urlButtons.length} URL button(s) ending in a token variable (see the note above the template in templates.js).`, '');
});
fs.mkdirSync('../docs', { recursive: true });
fs.writeFileSync('../docs/whatsapp-templates.md', out.join('\n'));
console.log(`wrote docs/whatsapp-templates.md (${sorted.length} templates)`);
