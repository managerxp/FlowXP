/* Cloud kitchens: the restaurant kitchen without a dining room, plus delivery riders, several brands from one kitchen and
   checking the platform payout statements. Screenshots are the real screens of the demo business in cloud-kitchen mode. */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'cloud-kitchen',
  label: 'Cloud kitchens',
  short: 'Cloud kitchens',
  blurb: 'One kitchen, every order, your own riders, and what each order really earned after the fees.',
  title: 'One kitchen, every order, every rupee accounted for.',
  lead: 'For cloud kitchens and delivery-first food businesses. Orders you take by phone or at a pickup counter go to the kitchen screen, your own riders deliver them, and you see what each order earned after fees and packaging.',
  hero: { src: p('cloud-orders'), alt: 'FlowXP order for delivery open with its brand, assigned rider, pickup and out-for-delivery buttons, items and total.' },
  heroPoints: ['Choose Cloud kitchen when you sign up: no tables, no dining room screens', 'The same kitchen display, recipes and GST as a restaurant', '7-day free trial, no card'],
  modules: [
    {
      id: 'orders', title: 'Every order on one screen',
      body: 'Delivery and takeaway orders sit in one list, oldest first, with what is cooking, what is ready and what each is worth.',
      points: ['Open orders, running bills, orders needing attention and the oldest open one, at the top', 'Filter to delivery or takeaway', 'The customer, the brand and the time on every order card', 'Add items and send them to the kitchen when ready', 'Take a new order by phone, or at a pickup counter, in a few taps', 'Charge when it is handed over, or keep it as a running tab'],
      shots: [{ src: p('cloud-orders-all'), alt: 'FlowXP orders list for a cloud kitchen with delivery and takeaway orders, each showing its customer, brand, items and what is cooking.' }]
    },
    {
      id: 'kitchen', title: 'A kitchen screen that keeps time',
      body: 'Each dish arrives at the right station with a timer. The kitchen taps a dish when it is ready, and the order moves on to the rider.',
      points: ['Tickets with how long each has waited, and which are late', 'Stations such as Tandoor or Curry & Rice, set per kitchen', 'The brand shown on every ticket, so the kitchen packs the right bag', 'Rush an order to the front', 'A Ready column for dishes waiting for a rider, and Handed over when they leave', 'A sound for new tickets, a full-screen mode, and printed tickets if you want paper', 'A report on how long dishes really take'],
      shots: [{ src: p('cloud-kitchen'), alt: 'FlowXP kitchen display with tickets to make, late tickets, delivery tickets ready for pickup and a cook-now list.' }]
    },
    {
      id: 'delivery', title: 'Delivery with your own riders',
      body: 'Give each delivery to one of your own riders and follow it from the kitchen to the door.',
      points: ['Riders are people on your team with a delivery role and their own login', 'Assign a rider to an order, or change them', 'Mark it picked up, out for delivery and delivered', 'The customer and address on the order, and how long it has been', 'See which orders have a rider and which are waiting for one'],
      shots: [{ src: p('cloud-orders'), alt: 'A delivery order in FlowXP with a rider chosen and Picked up, Out for delivery and Delivered steps.' }]
    },
    {
      id: 'brands', title: 'Several brands from one kitchen',
      body: 'Run more than one storefront from the same kitchen and the same stock, and keep the orders apart.',
      points: ['Create a brand for each storefront', 'Tag each dish with its brand', 'Set the brand on each order', 'The brand shows on the order card and on the kitchen ticket', 'One kitchen, one stock, one set of recipes behind all of them'],
      shots: [{ src: p('cloud-orders'), alt: 'FlowXP order with the brand chosen from a list of the kitchen’s brands.' }]
    },
    {
      id: 'settlements', title: 'Platform payouts that add up',
      body: 'Delivery platforms pay you weeks later, minus their charges. Paste the statement they already give you and FlowXP checks it against what you billed.',
      points: ['Paste one settled order per line: gross, commission, payment charges, delivery charges, tax, other deductions and net', 'Each line is checked two ways: do the platform’s own numbers add up, and does the amount match what was billed here', 'Lines are marked matched, value mismatch, doesn’t add up or no FlowXP order', 'A list of orders billed but never settled, with the money still owed to you', 'Works for Zomato, Swiggy, ONDC and Magicpin statements'],
      shots: [{ src: p('cloud-settlements'), alt: 'FlowXP settlement reconciliation with an imported statement, matched and flagged lines, and a list of orders never settled.' }]
    },
    {
      id: 'billing', title: 'A fast counter for phone orders and pickups',
      body: 'Tap dishes, pick delivery or takeaway, take the payment and print or send the bill.',
      points: ['Options and add-ons on any dish', 'Split payments, discounts, coupons and cash round-off', 'Find or add a customer by mobile number', 'Prints on 58 or 80 mm receipt printers', 'Keeps billing when the internet drops, and sends the sales when it returns'],
      shots: [{ src: p('cloud-billing'), alt: 'FlowXP billing with menu tiles and a bill ready to charge.' }]
    },
    {
      id: 'recipes', title: 'Recipes, food cost and wastage',
      body: 'Give a dish a recipe and every order takes its ingredients off the shelf, so food cost is a number, not a guess.',
      points: ['A recipe for every dish, with a wastage allowance on each ingredient', 'Cost and margin on every dish', 'Selling deducts ingredients, and cancelling puts them back', 'A wastage log with reasons', 'Stock counts, with the reason kept', 'Stock for each kitchen, and transfers between them'],
      shots: [{ src: p('cloud-menu'), alt: 'FlowXP menu with a dish open, showing its selling price, cost, margin and the ingredients in one portion.' }, { src: p('cloud-inventory'), alt: 'FlowXP inventory with an ingredient open showing its stock and every movement.' }]
    },
    {
      id: 'profit', title: 'Real profit, after commission and packaging',
      body: 'Revenue minus food cost, platform commission, payment fees, packaging and running costs.',
      points: ['Set each platform’s commission, the payment fee and the packaging cost per order once', 'Where each rupee goes, shown on one bar', 'Contribution and estimated net for the last 7, 30 or 60 days', 'Kitchens compared side by side', 'Revenue leakage checks: cancellations after payment, heavy discounts, refunds and wastage'],
      shots: [{ src: p('cloud-profit'), alt: 'FlowXP profitability with revenue, food cost, margin, platform commission, payment fees, packaging and estimated net.' }]
    },
    {
      id: 'forecast', title: 'Forecast what to prep and what to buy',
      body: 'A forecast of tomorrow’s orders from your own history, and what the kitchen will run short of before the next delivery.',
      points: ['Expected orders for the coming days and hour by hour', 'Ingredients that will run short before a delivery arrives', 'Suggested purchases for each supplier, drafted as purchase orders in one click', 'Always labelled as a prediction'],
      shots: [{ src: p('cloud-forecast'), alt: 'FlowXP stock forecast with ingredients that will run short and suggested purchases for each supplier.' }]
    },
    {
      id: 'kitchens', title: 'More than one kitchen',
      body: 'Run every kitchen from one login, each with its own stock, staff and invoice numbers.',
      points: ['A switcher between kitchens, or all together', 'Each kitchen’s own stock, prices, stations and recipes', 'Each kitchen’s own invoice series', 'Kitchens compared on revenue, food cost and margin', 'Roles for managers, cashiers, kitchen staff, stock managers and riders'],
      shots: [{ src: p('cloud-outlets'), alt: 'FlowXP outlets screen listing each kitchen with its invoice series and status.' }]
    },
    {
      id: 'reports', title: 'Reports and GST',
      body: 'Sales, purchases, stock and tax, worked out live, with the GST files prepared for you.',
      points: ['Sales by day, hour, channel and customer', 'Purchases, expenses, stock value and low stock', 'Every report exports to CSV', 'GSTR-1 file for the GST portal, and GSTR-3B figures', 'E-invoice and e-way bill files, with the numbers recorded back', 'Credit notes that reverse the tax exactly', 'Flow AI answers questions about your own sales and stock'],
      shots: [{ src: p('cloud-reports'), alt: 'FlowXP reports with sales, bills, average bill and GST collected, and sales by day.' }]
    }
  ],
  included: [
    { group: 'Orders and kitchen', items: ['Delivery and takeaway orders', 'Order cards with customer and brand', 'Kitchen display by station', 'Timers, rush and late flags', 'Ready and handed over', 'Printed kitchen tickets', 'Kitchen performance report'] },
    { group: 'Delivery', items: ['Your own riders with their own login', 'Assign and change a rider', 'Picked up, out for delivery, delivered', 'Customer and address on each order'] },
    { group: 'Brands', items: ['Several brands from one kitchen', 'Brand on dishes and orders', 'Brand on the kitchen ticket'] },
    { group: 'Selling', items: ['Counter and phone-order billing', 'Options and add-ons', 'Split and part payments', 'Discounts, coupons, round-off', 'Customer lookup by mobile', 'Receipt printing, 58 and 80 mm', 'Offline billing, sent on reconnect'] },
    { group: 'Menu and stock', items: ['Menu with photos', 'Menu from a photo', 'Recipes and food cost', 'Stock for each kitchen', 'Reorder levels and alerts', 'Wastage log with reasons', 'Stock counts', 'Transfers between kitchens'] },
    { group: 'Buying', items: ['Suppliers and price lists', 'Purchase orders', 'Drafts from the forecast', 'Part receiving and back-orders', 'Debit notes', 'Supplier balances and payments'] },
    { group: 'Money and tax', items: ['Platform payout reconciliation', 'Profitability after commission and packaging', 'Revenue leakage checks', 'Expenses', 'Sales, purchase and stock reports', 'GST invoices and credit notes', 'GSTR-1 file, GSTR-3B figures', 'E-invoice and e-way bill files'] },
    { group: 'Team and control', items: ['Several kitchens under one login', 'Roles and per-person permissions', 'Activity log', 'Two-step login', 'Install on a phone or tablet', 'Flow AI, a daily briefing from your own figures'] }
  ],
  notYet: [
    'Live order feeds from Zomato, Swiggy, ONDC and Magicpin. Those need each platform’s partner approval. Until then you enter an order yourself, and the rest, the kitchen ticket, your rider and checking the platform’s payout statement, works the same.',
    'Taking payments inside FlowXP. Cash, UPI and card payments are recorded on the bill; the money moves outside FlowXP.',
    'Live rider tracking on a map. Riders are marked picked up, out for delivery and delivered.'
  ],
  faq: [
    ['Does it connect to Zomato and Swiggy?', 'Not yet. Direct order feeds need each platform’s approval and are coming. What works today is everything around the order: the kitchen ticket, your own riders, and checking the platform’s payout statement against what you billed.'],
    ['Can I run several brands from one kitchen?', 'Yes. Create a brand for each storefront, tag the dishes, and set the brand on each order. It shows on the kitchen ticket and the order card, while stock and recipes stay shared.'],
    ['How do I know what an order really earned?', 'Set the platform commission, payment fee and packaging cost once. Profitability then shows food cost, fees and packaging against revenue, so you see contribution and estimated net for each period.'],
    ['Do I need a dining room?', 'No. A cloud kitchen gets the kitchen, orders, delivery and stock screens, and none of the tables or reservations screens.'],
    ['Does it handle GST?', 'Yes. Bills carry GST, credit notes reverse it exactly, and the GSTR-1 file, GSTR-3B figures and e-invoice or e-way bill files are prepared for you to upload. Nothing is sent to the government for you.']
  ]
};
