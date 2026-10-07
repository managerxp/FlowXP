/* Cafés: the restaurant product with a counter-first way of working. Every point names something with a screen in the app. The
   screenshots are the real screens of the demo café (npm run seed:cafe in backend). */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'cafe',
  label: 'Cafés & bakeries',
  short: 'Cafés',
  blurb: 'A fast counter, drinks with size, milk and sugar, a barista screen, and regulars who come back.',
  title: 'A fast counter, drinks made your way, regulars who come back.',
  lead: 'For cafés, coffee shops, bakeries and juice bars. Take the order at the counter in seconds, send it to the barista screen, and call the number out when it is ready. Tables and QR ordering are there too, if you want them.',
  hero: { src: p('cafe-billing'), alt: 'FlowXP counter billing for a café: a bill with an any-2-bakes offer applied, GST, payment methods and a UPI QR button.' },
  heroPoints: ['Choose Café when you sign up: Size, Milk, Sugar and Add-ons are ready to use', 'Works on a counter tablet or PC, and on a phone', '7-day free trial, no card'],
  modules: [
    {
      id: 'counter', title: 'A counter built for the morning rush',
      body: 'Tap the drink, add it to the bill, take cash, UPI or card. Counter, takeaway and table orders all go through the same screen, and each order gets a number to call out.',
      points: ['Big menu tiles, with search and a barcode scanner for packaged items', 'Split a bill between payment methods, or leave part of it unpaid', 'Hold a bill while the customer fetches their wallet', 'Customer lookup by mobile number for the visit card', 'Receipt printing, 58 and 80 mm, and a UPI QR on the bill', 'Keeps billing when the internet drops, and sends the sales when it is back'],
      shots: [{ src: p('cafe-billing'), alt: 'FlowXP counter billing for a café: a bill with an any-2-bakes offer applied, GST, payment methods and a UPI QR button.' }]
    },
    {
      id: 'drinks', title: 'Drinks made the way each guest likes',
      body: 'Size, milk and sugar are chosen on the bill, with the price changing for oat milk or a large cup. They are there from your first day and you can change any of them.',
      points: ['Size (Small, Regular, Large), Milk (full cream, toned, oat, almond, soy) and Sugar, one choice each', 'Add-ons such as an extra shot, flavour syrup or whipped cream, up to the number you allow', 'Each option can add to the price, or use up a stock item like oat milk', 'Tick which drinks offer which groups, so a cold coffee never asks about sugar twice', 'Combos like “coffee and a croissant” that take their stock from what is inside'],
      shots: [{ src: p('cafe-modifiers'), alt: 'FlowXP options screen with the Milk group open: full cream, toned, oat, almond and soy, with the extra price for each.' }]
    },
    {
      id: 'bar', title: 'A barista screen that keeps time',
      body: 'Every drink arrives at the right station with a timer, so the bar and the kitchen each see only their own items. Tap a drink when it is made and the counter sees it.',
      points: ['Stations such as Coffee bar, Cold bar and Bakery, set for each outlet', 'Tickets with how long each has waited, and which are late', 'A cook-now list that adds up the same drink across orders', 'Rush an order to the front', 'Optional: leave the screen out and call orders from the printed ticket'],
      shots: [{ src: p('cafe-kitchen'), alt: 'FlowXP barista screen with Coffee Bar, Cold Bar and Bakery stations, a rush ticket, takeaway tickets and a cook-now list.' }]
    },
    {
      id: 'menu', title: 'A menu you can set up in minutes',
      body: 'Add the menu by hand, or photograph the printed one and check what FlowXP read. Each item shows its price, its cost and its margin.',
      points: ['Categories for coffee, tea, cold drinks, bakes and snacks, with photos', 'Veg, non-veg and egg marks, which guests can filter by on the QR menu', 'A menu photo is read for you: you check every item before it is added', 'Items that are out for the day can be switched off at one outlet', 'A different price at each outlet if you want one'],
      shots: [{ src: p('cafe-menu'), alt: 'FlowXP café menu by category, with a cappuccino open showing its price, cost, margin and the beans, milk and cup it uses.' }]
    },
    {
      id: 'stock', title: 'Recipes that use up milk, beans and cups',
      body: 'Give a drink a recipe and every sale takes its ingredients off the shelf, including the cup and the lid. Food cost stops being a guess.',
      points: ['A recipe for every drink, with a wastage allowance on each ingredient', 'Packaging such as cups, lids and sleeves counted as stock too', 'Reorder levels and an alert when milk or beans run low', 'Stock for each outlet, with counts and a wastage log', 'Suppliers, purchase orders and what you owe each one'],
      shots: [{ src: p('cafe-inventory'), alt: 'FlowXP inventory with stock value, items running low and an ingredient open showing its stock and every movement.' }]
    },
    {
      id: 'regulars', title: 'Bring regulars back',
      body: 'A visit card for the tenth coffee, offers for the quiet hours, and a rating after every bill so you hear from the people who come in.',
      points: ['A visit card: every Nth visit earns a free item, shown on the QR menu and at the till', 'Offers the till applies by itself: buy one get one, a percentage off, any 2 pastries for one price', 'Offers that run only on certain days or hours, like a weekday happy hour', 'Points and tiers, and coupon codes', 'A star rating and comment after the bill; happy ratings can go to your Google page, unhappy ones stay private', 'Flow AI can draft a reply to a review for you to check'],
      shots: [{ src: p('cafe-loyalty'), alt: 'FlowXP loyalty setup with a visit card that gives a free filter coffee on every 7th visit.' }, { src: p('cafe-offers'), alt: 'FlowXP offers screen with a weekday happy hour on cold drinks and a bundle of any 2 bakes for one price.' }]
    },
    {
      id: 'tables', title: 'Tables and QR ordering, when you want them',
      body: 'If you serve at tables, guests can scan the QR on the table and order from their own phone. If you do not, leave them off: the counter works on its own.',
      points: ['Floor view with free and occupied tables, and the running bill on each', 'Guests order from their phone, with a Veg / Non-veg filter', 'Move a table, merge two tabs, or split a bill', 'Reservations and a walk-in waitlist for a busy evening'],
      shots: [{ src: p('cafe-qr'), phone: true, alt: 'The guest’s phone menu after scanning a table QR code, with the visit card and a Veg / Non-veg filter.' }]
    },
    {
      id: 'reports', title: 'Know what sells and what it earns',
      body: 'Sales by hour show when the rush is. Profit reports show what each drink earns after its ingredients, and GST files are prepared for you.',
      points: ['Sales by day, hour, item and category', 'The busiest hours, so you can plan staff and the happy hour', 'Profit after ingredient cost, for each outlet', 'Expenses, purchases and stock value', 'Every report exports to CSV', 'GSTR-1 file for the GST portal, GSTR-3B figures, and credit notes that reverse the tax exactly'],
      shots: [{ src: p('cafe-reports'), alt: 'FlowXP reports with sales, bills, average bill and GST collected, and sales by day.' }]
    },
    {
      id: 'outlets', title: 'One café or a chain of them',
      body: 'Run every outlet from one login. Each keeps its own stock, prices, staff and invoice numbers, and you see them together or one at a time.',
      points: ['A switcher between outlets, or all of them together', 'Outlets compared on sales, cost and margin', 'Roles for managers, cashiers, baristas, stock managers and delivery riders', 'Permissions you can change for one person, and an activity log of who did what'],
      shots: [{ src: p('cafe-outlets'), alt: 'FlowXP outlets compared side by side on revenue, orders, food cost, contribution and estimated net.' }]
    },
    {
      id: 'ai', title: 'Ask your café a question',
      body: 'Flow AI reads your own figures and answers in plain English: what to order, what is selling, what looks wrong.',
      points: ['Questions like “how did last week compare?” or “what should I order for Friday?”', 'A daily briefing of what changed', 'It only reads your figures. It cannot change anything', 'Forecasts are marked as estimates', 'Customer names and phone numbers are never sent to the AI service'],
      shots: [{ src: p('cafe-ai'), alt: 'FlowXP Flow AI answering what to order tomorrow, with the figures it looked at.' }]
    }
  ],
  included: [
    { group: 'Selling', items: ['Counter, takeaway and table billing', 'Order numbers to call out', 'Size, milk, sugar and add-ons', 'Combos', 'Split and part payments', 'Discounts, coupons, offers, round-off', 'Held bills', 'Customer lookup by mobile', 'Receipt printing, 58 and 80 mm', 'UPI QR on the bill', 'Offline billing, sent on reconnect'] },
    { group: 'Counter and bar', items: ['Barista and kitchen screen by station', 'Timers, rush and late flags', 'Cook-now list', 'Table map and open tabs', 'QR ordering with a veg filter', 'Reservations and waitlist'] },
    { group: 'Menu and stock', items: ['Menu from a photo', 'Veg, non-veg and egg marks', 'Recipes and food cost', 'Cups, lids and packaging as stock', 'Per-outlet prices and availability', 'Reorder levels and alerts', 'Wastage log', 'Stock counts', 'Transfers between outlets'] },
    { group: 'Regulars', items: ['Visit card', 'Offers on days and hours', 'Points and tiers', 'Coupons', 'Customer history', 'Ratings after the bill', 'Review replies drafted by Flow AI', 'WhatsApp and SMS messages (coming soon)'] },
    { group: 'Buying and money', items: ['Suppliers and price lists', 'Purchase orders and receiving', 'Expenses', 'Profit by outlet', 'Sales, purchase and stock reports', 'CSV export of every report', 'GST invoices and credit notes', 'GSTR-1 file and GSTR-3B figures'] },
    { group: 'Team and control', items: ['Several outlets under one login', 'Roles and per-person permissions', 'Activity log', 'Two-step login', 'Install on a phone or tablet'] }
  ],
  notYet: [
    'Live order feeds from Zomato and Swiggy. Those need each platform’s partner approval. Orders from them can be entered by your team, with the kitchen ticket and the payout check working as usual.',
    'WhatsApp and SMS sending of bills and offers. It is coming soon.',
    'Taking payments inside FlowXP. Cash, UPI, card and bank payments are recorded on the bill; the money moves outside FlowXP. A card machine is not connected to FlowXP.',
    'An app in the Play Store or App Store. Install FlowXP from the browser on any phone or tablet today.'
  ],
  faq: [
    ['Do I need tables or a kitchen screen?', 'No. A café can run on the counter alone. Tables, QR ordering and the barista screen are there when you want them, and you can ignore them until then.'],
    ['Can guests choose oat milk or an extra shot?', 'Yes. Size, Milk, Sugar and Add-ons are set up for you when you choose Café. Each choice can change the price, and you decide which drinks offer which choices.'],
    ['Does it work for a bakery too?', 'Yes. Bakes and snacks are items on the same menu, with recipes and stock like any other, and a barcode scanner works for packaged goods. Tracking expiry dates by batch is built for shops and pharmacies, not for bakes made daily.'],
    ['Do I need special hardware?', 'No. Any 58 or 80 mm receipt printer works through the browser, and a barcode scanner that types into a box works with no setup. A tablet or an old PC is enough for the barista screen.'],
    ['What if the internet goes down?', 'Billing keeps working on the device and the sales are sent when it reconnects. Tables, orders and the barista screen need a connection.'],
    ['Does it handle GST?', 'Yes. Bills carry GST, credit notes reverse it exactly, and the GSTR-1 file and GSTR-3B figures are prepared for you to upload. Nothing is sent to the government for you.']
  ]
};
