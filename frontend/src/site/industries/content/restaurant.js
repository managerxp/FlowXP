/* Restaurants and cafés: one page, because it is one product (a café is a restaurant with a counter). Every point names
   something with a screen in the app; the screenshots are the real screens of the seeded demo business. */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'restaurant',
  label: 'Restaurants & cafés',
  short: 'Restaurants',
  blurb: 'Tables, QR ordering, the kitchen and the bill, working as one. For restaurants, cafés and food counters.',
  title: 'Tables, kitchen and bill, working as one.',
  lead: 'For restaurants, cafés, bakeries and food counters. A guest orders at the table or the counter, the kitchen sees it at once, and the bill always matches what was served.',
  hero: { src: p('restaurant-kitchen'), alt: 'FlowXP kitchen display with tickets by table, the dishes still to make, their timers and a rush order flagged.' },
  heroPoints: ['Choose Restaurant or Café when you sign up and these tools switch on', 'Works on a counter PC, a tablet and a phone', '7-day free trial, no card'],
  modules: [
    {
      id: 'billing', title: 'A fast counter for every kind of sale',
      body: 'Tap dishes or scan a barcode, take cash, UPI or card, and print or send the bill. Dine-in, takeaway and counter sales all go through the same screen.',
      points: ['Options and add-ons on any dish, like spice level or extra cheese', 'Split a bill between payment methods, or leave part of it unpaid', 'Discounts, coupons, notes and cash round-off on the bill', 'Hold a bill and come back to it', 'Find or add a customer by mobile number', 'Prints on 58 or 80 mm receipt printers, and opens a cash drawer through the print agent', 'Keeps billing when the internet drops, and sends the sales when it returns'],
      shots: [{ src: p('restaurant-billing'), alt: 'FlowXP counter billing with menu tiles on the left and a bill with items, GST and payment methods on the right.' }]
    },
    {
      id: 'floor', title: 'Tables, tabs and QR ordering',
      body: 'See every table at a glance, open a tab, and keep adding to it as the meal goes on. Guests can scan the QR on the table and order from their own phone.',
      points: ['Floor view with free, occupied and needs-attention tables, and the running bill on each', 'Move a table, merge two tabs, split a bill or move items between tabs', 'A regular waiter for each table, and a waiter on every order', 'Print a QR card for every table', 'The guest menu has photos, a veg-only switch and the loyalty card', 'The bill reaches the guest as a link on their phone'],
      shots: [{ src: p('restaurant-tables'), alt: 'FlowXP table map with free and occupied tables, running bills and what is cooking or ready at each.' }, { src: p('restaurant-qr'), alt: 'The guest’s phone menu after scanning a table’s QR code, with dish categories, a visit card and Add buttons.', phone: true }]
    },
    {
      id: 'orders', title: 'Dine-in, takeaway and delivery in one list',
      body: 'Every open order sits in one list, oldest first, with what is cooking, what is ready and what each is worth so far. Nothing is charged until you bill it.',
      points: ['Open orders, running bills, orders needing attention and the oldest open one, at the top', 'Add items to an order and send them to the kitchen when ready', 'Takeaway and delivery orders with the customer on them', 'Assign one of your own riders to a delivery and track pickup and handover', 'Cancel an order, and it is recorded in the activity log'],
      shots: [{ src: p('restaurant-orders'), alt: 'FlowXP orders screen listing open dine-in and takeaway orders, with the chosen order open on the right showing its items and total.' }]
    },
    {
      id: 'kitchen', title: 'A kitchen screen that keeps time',
      body: 'Each dish arrives at the right station with a timer. The kitchen taps a dish when it is ready, and the floor sees it at once.',
      points: ['Tickets by table, with how long each has waited and which are late', 'Stations such as Tandoor, Curry & Rice or Bar, set per outlet', 'Rush an order to the front', 'Tap a dish when it is ready, or the whole ticket at once', 'A Ready to serve column for the waiters, and Handed over when it goes out', 'A sound when a new ticket arrives, a full-screen mode, and printed tickets if you want paper', 'A kitchen performance report: how long dishes really take'],
      shots: [{ src: p('restaurant-kitchen'), alt: 'FlowXP kitchen display with tickets to make, late tickets flagged, ready-to-serve tickets and a cook-now list of dishes.' }]
    },
    {
      id: 'menu', title: 'Your menu, options and combos',
      body: 'Set the menu up once. Each dish shows its price, what it costs you to make and the margin, so you price with the real numbers.',
      points: ['Categories, veg, non-veg and egg marks, and photos', 'Option groups such as spice level or extras, with price changes if you want them', 'Combos that take their stock and cost from the dishes inside', 'Different prices and availability for each outlet', 'Read a whole menu from a photo, then check it before it is saved', 'Archive a dish without losing its history'],
      shots: [{ src: p('restaurant-menu'), alt: 'FlowXP menu with each dish’s price and margin, and one dish open showing its cost and the ingredients in one portion.' }, { src: p('restaurant-modifiers'), alt: 'FlowXP options screen with a Spice level group, its options and the dishes it applies to.' }]
    },
    {
      id: 'stock', title: 'Recipes that use up stock as you sell',
      body: 'Give a dish a recipe and every sale takes its ingredients off the shelf. Food cost and margin stop being guesses.',
      points: ['A recipe for every dish, with a wastage allowance on each ingredient', 'Selling a dish deducts its ingredients, and cancelling puts them back', 'Stock for each outlet, with a reorder level on every item', 'Count and correct stock, with the reason kept', 'A wastage log with reasons: spoiled, expired, damaged, prep waste or made too much', 'A history for every item: what used it, when, and which bill', 'Send stock between outlets, or ask another outlet for it'],
      shots: [{ src: p('restaurant-inventory'), alt: 'FlowXP inventory with stock value, items running low and an ingredient open showing its stock and every movement.' }]
    },
    {
      id: 'buying', title: 'Suppliers, purchase orders and what you owe',
      body: 'Order from suppliers, receive what actually arrives, and see what you owe each one.',
      points: ['Suppliers with their own price lists', 'Purchase orders, drafted for you from the forecast when you want', 'Receive in parts, and keep the rest as a back-order', 'Record a purchase for goods that are already here', 'Debit notes for returns and price corrections', 'What you owe each supplier, and payments against each bill', 'Purchase orders sent to the supplier by email'],
      shots: [{ src: p('restaurant-purchases'), alt: 'FlowXP purchases with orders to receive and a draft purchase order open, with its items and total.' }]
    },
    {
      id: 'reservations', title: 'Reservations and the walk-in waitlist',
      body: 'Take bookings by phone, and keep a waitlist for walk-ins with a wait you can quote.',
      points: ['Bookings by time, party size and table, with clashes stopped for you', 'Seat, change, cancel or mark a no-show', 'A waitlist with a quoted wait, and a Table ready message', 'The floor shows the next booking on a table', 'Booking confirmations by WhatsApp or SMS: coming soon'],
      shots: [{ src: p('restaurant-reservations'), alt: 'FlowXP reservations with tonight’s bookings by time and a waitlist of walk-in parties.' }]
    },
    {
      id: 'regulars', title: 'Bring regulars back, and hear from them',
      body: 'A visit card, points, coupons and a rating after every bill, so you know who your regulars are and how they felt.',
      points: ['A visit card: every Nth visit earns a free item, shown on the QR menu and at the till', 'Points and tiers, with a ledger for each customer', 'Coupons and offer codes', 'Every customer’s bills, visits and what they owe', 'A star rating and comment after the bill; happy ratings can go to your Google page, unhappy ones stay private', 'Flow AI can draft a reply to a review for you to edit', 'Bill links and offers by WhatsApp or SMS: coming soon, and customers will be able to opt out'],
      shots: [{ src: p('restaurant-loyalty'), alt: 'FlowXP loyalty setup with a visit card that gives a free dish on every 7th visit.' }, { src: p('restaurant-reviews'), alt: 'FlowXP reviews with star ratings, comments and a box to reply.' }]
    },
    {
      id: 'profit', title: 'Know what each rupee really earns',
      body: 'Revenue minus food cost, fees, packaging and running costs, worked out from your own bills and the assumptions you set.',
      points: ['Where each rupee of revenue goes: food, payment fees, platform commission and packaging', 'Contribution and estimated net, for the last 7, 30 or 60 days', 'Every outlet side by side, best and weakest marked', 'Revenue leakage: bills cancelled after payment, heavy discounts, refunds and wastage that look unusual', 'Each finding says what to check, and you can mark it reviewed', 'Expenses such as rent and salaries, so profit is not flattered'],
      shots: [{ src: p('restaurant-profit'), alt: 'FlowXP profitability with revenue, food cost, gross margin, contribution and where each rupee goes.' }, { src: p('restaurant-leakage'), alt: 'FlowXP revenue leakage with cancellations, discounts, refunds and wastage found, and a suggested next step.' }]
    },
    {
      id: 'forecast', title: 'Know what to prep and what to buy',
      body: 'A forecast of tomorrow’s orders from your own history, and what the kitchen will run short of before the next delivery.',
      points: ['Expected orders for each of the next days, and hour by hour', 'Expected portions of each dish, with how sure the forecast is', 'Ingredients that will run short before a delivery can arrive', 'Suggested purchases for each supplier, drafted as purchase orders in one click', 'Always labelled as a prediction, with how far off the last two weeks were'],
      shots: [{ src: p('restaurant-forecast'), alt: 'FlowXP forecast with expected orders for the next seven days, an hour-by-hour chart and expected portions of each dish.' }]
    },
    {
      id: 'reports', title: 'Reports, GST and your accountant',
      body: 'Sales, purchases, stock and tax, worked out live. Files for the GST portal are prepared for you.',
      points: ['Sales by day, hour, channel, waiter and customer', 'Who owes you, and what you owe', 'Purchases, expenses, stock value and low stock', 'Every report exports to CSV', 'GSTR-1 file for the GST portal, and GSTR-3B figures', 'E-invoice and e-way bill files, with the numbers recorded back', 'Credit notes that reverse the tax exactly'],
      shots: [{ src: p('restaurant-reports'), alt: 'FlowXP reports with sales, bills, average bill and GST collected, and sales by day.' }, { src: p('restaurant-gst'), alt: 'FlowXP GSTR-3B figures for the month, with outward supplies, tax and the amount to pay.' }]
    },
    {
      id: 'outlets', title: 'Many outlets, one login',
      body: 'Run every outlet from one account. Each keeps its own stock, tables, staff and invoice numbers, and you see them together or one at a time.',
      points: ['A switcher between outlets, or all of them together', 'Each outlet’s own stock, prices, tables, kitchen stations and recipes', 'Each outlet’s own invoice series', 'Outlets compared on revenue, food cost and margin', 'Roles for managers, cashiers, waiters, kitchen staff, stock managers and delivery riders', 'Permissions you can change for one person, and who works at which outlet', 'An activity log of who did what, and when'],
      shots: [{ src: p('restaurant-outlets'), alt: 'FlowXP outlets compared side by side on revenue, orders, food cost, contribution and estimated net.' }, { src: p('restaurant-staff'), alt: 'FlowXP staff list with each person’s role, outlet and access.' }]
    },
    {
      id: 'ai', title: 'Ask your business a question',
      body: 'Flow AI reads your own figures and answers in plain English: what to order, what is selling, what looks wrong.',
      points: ['Questions like “what should I order tomorrow, and from whom?”', 'A daily briefing of what changed', 'It only reads your figures. It cannot change anything', 'Forecasts and profit figures are marked as estimates', 'Customer names and phone numbers are never sent to the AI service'],
      shots: [{ src: p('restaurant-ai'), alt: 'FlowXP Flow AI answering what to order tomorrow, with suppliers, quantities and the figures it looked at.' }]
    }
  ],
  included: [
    { group: 'Selling', items: ['Counter, dine-in and takeaway billing', 'Options, add-ons and combos', 'Split and part payments', 'Discounts, coupons, round-off', 'Held bills', 'Customer lookup by mobile', 'Receipt printing, 58 and 80 mm', 'Cash drawer', 'UPI QR on the bill', 'Bill links on the guest’s phone', 'Offline billing, sent on reconnect'] },
    { group: 'Floor and kitchen', items: ['Table map and open tabs', 'Merge, split, move and transfer', 'QR ordering at the table', 'Waiter on every order', 'Kitchen display by station', 'Timers, rush, late flags', 'Ready to serve and handed over', 'Printed kitchen tickets', 'Kitchen performance report', 'Reservations and waitlist'] },
    { group: 'Menu and stock', items: ['Menu with veg and non-veg marks', 'Menu from a photo', 'Recipes and food cost', 'Per-outlet prices', 'Stock for each outlet', 'Reorder levels and alerts', 'Wastage log with reasons', 'Stock counts', 'Transfers and stock requests between outlets'] },
    { group: 'Buying', items: ['Suppliers and price lists', 'Purchase orders', 'Drafts from the forecast', 'Part receiving and back-orders', 'Debit notes', 'Supplier balances and payments'] },
    { group: 'Guests', items: ['Visit card', 'Points and tiers', 'Coupons', 'Customer history', 'Ratings after the bill', 'Review replies drafted by Flow AI', 'WhatsApp and SMS messages (coming soon)', 'Opt-out respected'] },
    { group: 'Money and tax', items: ['Profitability by outlet', 'Revenue leakage checks', 'Expenses', 'Sales, purchase and stock reports', 'CSV export of every report', 'GST invoices and credit notes', 'GSTR-1 file, GSTR-3B figures', 'E-invoice and e-way bill files'] },
    { group: 'Team and control', items: ['Several outlets under one login', 'Roles and per-person permissions', 'Activity log', 'Two-step login', 'Sign-in history and new-device alerts', 'Install on a phone or tablet'] }
  ],
  notYet: [
    'Live order feeds from Zomato, Swiggy, ONDC and Magicpin. Those need each platform’s partner approval. What happens after an order arrives, the accept-or-reject alert, the kitchen ticket and checking the platform’s payout statement, already works.',
    'Guests booking a table online by themselves. Bookings are entered by your team.',
    'Taking payments inside FlowXP. Cash, UPI, card and bank payments are recorded on the bill; the money moves outside FlowXP.',
    'An app in the Play Store or App Store. Install FlowXP from the browser on any phone or tablet today.'
  ],
  faq: [
    ['Is this for a café or bakery too?', 'Yes. A café is a restaurant with a counter, and the same screens cover it: counter billing, a menu, recipes and stock, and tables and QR ordering if you want them. Choose Café when you sign up.'],
    ['Do I need special hardware?', 'No. Any 58 or 80 mm receipt printer works through the browser, and a barcode scanner that types into a box works with no setup. A tablet or an old PC is enough for the kitchen screen.'],
    ['What if the internet goes down?', 'Billing keeps working on the device and the sales are sent when it reconnects. Tables, orders and the kitchen screen need a connection.'],
    ['Does it handle GST?', 'Yes. Bills carry GST, credit notes reverse it exactly, and the GSTR-1 file, GSTR-3B figures and e-invoice or e-way bill files are prepared for you to upload. Nothing is sent to the government for you.'],
    ['Can I run more than one outlet?', 'Yes, under one login. Each outlet has its own stock, tables, staff and invoice numbers, and you can look at them together or one at a time.']
  ]
};
