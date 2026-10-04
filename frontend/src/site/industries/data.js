/*
 * What each industry page says, kept in one place so the hub, the detail
 * pages, the navigation and the coming-soon page all read from the same facts.
 *
 * READY: a built vertical with its own screens in the app. Each lives in
 * content/<slug>.js: the modules (a heading, what it does, the points, and the
 * real screenshots), the complete list of what is included, what is not built
 * yet, and the questions owners ask. Every point names something that has a
 * route and a permission in the app, not a roadmap item.
 * CORE: everything else the core billing/stock/GST engine already serves
 * well, with no dedicated vertical needed.
 * SOON: named gaps, a feature the trade needs that is not built yet.
 */
import restaurant from './content/restaurant.js';
import cloudKitchen from './content/cloud-kitchen.js';
import wholesale from './content/wholesale.js';
import distributor from './content/distributor.js';
import salon from './content/salon.js';
import pharmacy from './content/pharmacy.js';

export const READY = [restaurant, cloudKitchen, wholesale, distributor, salon, pharmacy];

/* Old addresses that still work. The café page was merged into the restaurant page. */
export const ALIASES = { cafe: 'restaurant', cafes: 'restaurant', 'cafe-and-restaurant': 'restaurant', 'cloud-kitchens': 'cloud-kitchen', distribution: 'distributor', pharmacies: 'pharmacy', salons: 'salon' };

/* The same on every page: what sits underneath whichever trade you choose. */
export const UNDERNEATH = [
  ['GST built in', 'Invoices carry GST, credit notes reverse it exactly, and the GSTR-1 file, GSTR-3B figures and e-invoice or e-way bill files are prepared for you. Nothing is sent to the government for you.'],
  ['Several outlets, one login', 'Each outlet keeps its own stock, staff and invoice numbers, and you can look at them together or one at a time.'],
  ['The right access for each person', 'Owners, managers and staff see what their job needs. Permissions can be changed for one person, and an activity log records who did what.'],
  ['Safe sign-in', 'Two-step login, sign-in history and an alert when a new device signs in.'],
  ['On any phone or tablet', 'Install FlowXP from the browser. There is nothing to download from a store.'],
  ['Your data stays yours', 'Reports export to CSV, and the GST register is there for your accountant.']
];

/* Served well by the core billing/stock/GST engine today — no dedicated
   vertical needed, so no caveat either. */
export const CORE = [
  { title: 'Groups with several outlets', body: 'One owner login sees every outlet; each one keeps its own stock, staff and invoice numbers.', big: true },
  { title: 'Retail shops', body: 'Barcode billing, stock and GST for the counter.' },
  { title: 'Supermarkets', body: 'Fast barcode billing and stock across counters.' },
  { title: 'Bakeries and sweet shops', body: 'Counter billing, recipes and daily wastage.' },
  { title: 'Gaming cafés and play zones', body: 'Bill time packages, snacks and memberships as items.' }
];

/* A real, named gap for each — what is missing, not just "not yet". */
export const SOON = [
  { title: 'Clothing and footwear', body: 'Billing, stock and loyalty work today. Size and colour variants are next.' },
  { title: 'Electronics and mobiles', body: 'Billing, stock and customer credit work today. Serial number tracking per unit is next.' },
  { title: 'Racing and simulator zones', body: 'Time-based billing and packages, the way gaming cafés already work, is next.' }
];
