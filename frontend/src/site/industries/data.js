/*
 * What each industry page says, kept in one place so the hub, the detail
 * pages and the coming-soon page all read from the same facts.
 *
 * READY: a built vertical with its own screens in the app (verified against
 * AppShell.jsx's nav — every point below names something that actually has
 * a route and a permission, not a roadmap item).
 * CORE: everything else the core billing/stock/GST engine already serves
 * well, with no dedicated vertical needed.
 * SOON: named gaps — a feature the trade needs that is not built yet, or
 * for pharmacy, built on the backend but with no screens yet.
 */

export const READY = [
  {
    slug: 'restaurant',
    label: 'Restaurants',
    blurb: 'Tables, QR ordering, the kitchen and the bill, working as one.',
    eyebrow: 'Restaurants',
    title: 'The floor, the kitchen and the bill, connected.',
    lead: 'Orders move from the table or the QR menu to the right kitchen station, and the bill always matches what was actually served.',
    heroSrc: '/product/kitchen-main.webp',
    heroAlt: 'FlowXP kitchen display with six open orders by table, their dishes and minutes since sent.',
    rows: [
      {
        eyebrow: 'The floor',
        title: 'Every table, waiter and order in one view.',
        body: 'Waiters take orders at the table or guests order themselves by scanning the table QR. Either way, the order is on the floor and in the kitchen at once.',
        points: ['Tables, waiters and guest ordering by table QR', 'Kitchen display or printed tickets, by station, with timers', 'Reservations and a walk-in waitlist', 'Multiple outlets under one owner login'],
        src: '/product/tables-main.webp', alt: 'FlowXP table map with open tables, their status and guest counts.'
      },
      {
        eyebrow: 'Kitchen to bill',
        title: 'What is served is what gets billed.',
        body: 'Recipes use up their ingredients the moment a dish sells, so food cost and wastage are real numbers, not guesses.',
        points: ['Recipes, so selling a dish deducts its ingredients', 'Food cost and margin, per dish', 'Combos, add-ons and spice levels', 'Split and merged bills'],
        src: '/product/profit-main.webp', alt: 'FlowXP profitability report with revenue, costs, margin and daily revenue.'
      }
    ]
  },
  {
    slug: 'cafe',
    label: 'Cafés',
    blurb: 'Fast counter billing, with QR ordering for the tables you do have.',
    eyebrow: 'Cafés',
    title: 'Quick at the counter, easy at the table.',
    lead: 'Most orders are quick and at the counter. The few tables you have can order themselves by QR, and the same kitchen ticket covers both.',
    heroSrc: '/product/pos-main.webp',
    heroAlt: 'FlowXP billing screen with items, quantities, GST and a Charge button.',
    rows: [
      {
        eyebrow: 'Counter and table',
        title: 'Bill fast. Let seated guests order themselves.',
        body: 'A regular walks in and is billed in seconds. A guest at a table scans the QR, orders, and it prints at the counter or kitchen station.',
        points: ['Barcode or name search, GST on every line', 'Table QR ordering for seated guests', 'Kitchen printer or display, by station', 'Works offline; bills sync when the internet is back'],
        src: '/product/tables-main.webp', alt: 'FlowXP table map with open tables, their status and guest counts.'
      },
      {
        eyebrow: 'Bring them back',
        title: 'Combos, offers and regulars who come back.',
        body: 'Set combos and add-ons once, then bill them as single items. Every regular is remembered by their mobile number.',
        points: ['Combos and add-ons priced as one item', 'Loyalty points and WhatsApp offers', 'Customer history: what they order, how often', '58 and 80 mm thermal receipts'],
        src: '/product/invoices-main.webp', alt: 'FlowXP invoices list with bill numbers, dates, customers, totals and paid and issued status.'
      }
    ]
  },
  {
    slug: 'cloud-kitchen',
    label: 'Cloud kitchens',
    blurb: 'Kitchen tickets, food cost and recipes, for a delivery-only menu.',
    eyebrow: 'Cloud kitchens',
    title: 'No dining room. The kitchen and the margin still need running.',
    lead: 'Delivery and takeaway orders still need a kitchen that knows what to cook first and a true food cost per dish, since there is no dining room to pad the margin.',
    heroSrc: '/product/kitchen-main.webp',
    heroAlt: 'FlowXP kitchen display with six open orders, their dishes and minutes since sent.',
    rows: [
      {
        eyebrow: 'One kitchen, several brands',
        title: 'Run more than one delivery brand from the same kitchen.',
        body: 'Each kitchen or virtual brand keeps its own menu and stock, billed through the same system, with orders by station and a timer on each.',
        points: ['Kitchen display or printed tickets, by station, with timers', 'Recipes and true food cost per dish', 'Wastage logged with a reason', 'Several kitchens or brands under one owner login'],
        src: '/product/forecast-main.webp', alt: 'FlowXP forecast with seven days of expected orders, an hour-by-hour chart and expected portions per dish.'
      },
      {
        eyebrow: 'Orders in',
        title: 'Bill every order, from whichever channel it came in on.',
        body: 'Phone and walk-in takeaway orders bill the same way as everything else, with the bill sent as a WhatsApp or SMS link.',
        points: ['WhatsApp or SMS bill links', 'Zomato and Swiggy orders straight into the kitchen: coming soon', 'Profit by dish, not just by order', 'Works offline; bills sync when the internet is back'],
        src: '/product/profit-main.webp', alt: 'FlowXP profitability report with revenue, food cost, margin and daily revenue.'
      }
    ]
  },
  {
    slug: 'wholesale',
    label: 'Wholesale',
    blurb: 'Buy in bulk, sell on credit, and always know what is owed.',
    eyebrow: 'Wholesale',
    title: 'Buy in bulk, sell on credit, know what is owed.',
    lead: 'Purchase from suppliers, fulfil orders in parts when stock runs short, and keep every customer’s credit and every supplier’s bill in view.',
    heroSrc: '/product/wholesale-orders-main.webp',
    heroAlt: 'FlowXP sales orders screen listing orders with their customer, salesperson, status and total.',
    rows: [
      {
        eyebrow: 'Buying and stock',
        title: 'Purchase orders, part deliveries and stock across godowns.',
        body: 'Order from a supplier, receive what actually arrives, and let the rest stay a back-order. Stock is tracked by branch or godown, not as one pile.',
        points: ['Sales orders, part deliveries and back-orders', 'Purchasing with supplier price lists and debit notes', 'Inventory split across branches and godowns', 'Returns with stock and GST corrected automatically'],
        src: '/product/wholesale-inventory-main.webp', alt: 'FlowXP wholesale inventory screen with stock on hand, low-stock and expiring items, and the product list.'
      },
      {
        eyebrow: 'Money owed, both ways',
        title: 'Who owes you, and who you owe.',
        body: 'Customer credit and supplier payables sit in one place, with an outstanding report instead of a stack of memory.',
        points: ['Receivables and payables in one ledger', 'Customer credit limits and outstanding reports', 'E-invoice and e-way bill files for large consignments', 'GSTR-1 and GSTR-3B prepared from the same bills'],
        src: '/product/wholesale-money-main.webp', alt: 'FlowXP receivables and payables screen with customer ageing buckets and who owes what.'
      }
    ]
  },
  {
    slug: 'distributor',
    label: 'Distribution',
    blurb: 'A field team selling from the van, syncing the moment they are back online.',
    eyebrow: 'Distribution',
    title: 'A field team that keeps selling when there is no signal.',
    lead: 'Built on the same wholesale engine, with a layer for distributors who carry stock in a van and sell principal-by-principal, beat by beat.',
    heroSrc: '/product/distributor-dashboard-main.webp',
    heroAlt: 'FlowXP’s distributor dashboard with sales today, collections, receivables, stock value and a needs-attention list.',
    rows: [
      {
        eyebrow: 'In the field',
        title: 'Orders taken on the phone, even without the internet.',
        body: 'A salesperson visits a beat, takes the order on their phone, and it syncs the moment they are back online, checked against minimum order quantities as they go.',
        points: ['Field sales app with offline order capture', 'Territories and beats assigned per salesperson', 'Sales team targets, tracked against actuals', 'Vehicle stock, for van-sales routes'],
        src: '/product/distributor-territories-main.webp', alt: 'FlowXP territories and beats screen showing regions, territories and areas with retailer counts.'
      },
      {
        eyebrow: 'Principals and schemes',
        title: 'More than one brand, each with its own terms.',
        body: 'Distribute for several principals at once, each with their own price lists, and run trade schemes without recalculating them by hand.',
        points: ['Several principals and brands, kept separate', 'Trade schemes applied automatically at billing', 'Part deliveries and back-orders, same as wholesale', 'Receivables, payables and the same GST filing'],
        src: '/product/distributor-schemes-main.webp', alt: 'FlowXP schemes screen listing trade schemes, their type, funder and how long they run.'
      }
    ]
  },
  {
    slug: 'salon',
    label: 'Salons',
    blurb: 'Appointments, billing and client history, services and products together.',
    eyebrow: 'Salons and spas',
    title: 'Book the chair. Bill the visit. Remember the client.',
    lead: 'Appointments, services and the products used during a visit all go on one GST bill, and every client’s history is one lookup away.',
    heroSrc: '/product/salon-billing-main.webp',
    heroAlt: 'FlowXP salon billing screen with two services on the bill and a total ready to charge.',
    rows: [
      {
        eyebrow: 'Booking and billing',
        title: 'Appointments and staff scheduling, built in.',
        body: 'Book a client against a stylist and a time slot, and when the visit ends, bill the services and any products together, on one invoice.',
        points: ['Appointments and staff scheduling', 'Services and retail products on the same GST bill', 'Client history and visit counts', 'Loyalty points and WhatsApp offers'],
        src: '/product/salon-services-main.webp', alt: 'FlowXP salon services list with each service’s price, GST and duration.'
      },
      {
        eyebrow: 'Behind the chair',
        title: 'Commission, memberships and the stock behind the chair.',
        body: 'Track what each stylist earns in commission, sell memberships and package deals, and get a low-stock alert before you run out of what you use most.',
        points: ['Memberships and package offers', 'Staff commission, tracked per bill', 'Product stock and low-stock alerts', 'Staff logins with the right permissions'],
        src: '/product/staff-main.webp', alt: 'FlowXP team screen listing staff, their roles and the outlets they work at.'
      }
    ]
  },
  {
    slug: 'pharmacy',
    label: 'Pharmacies',
    blurb: 'Batch and expiry tracked stock, received straight from the supplier, sold FEFO by default.',
    eyebrow: 'Pharmacies',
    title: 'Every batch tracked, the soonest-expiring one sold first.',
    lead: 'Receive stock straight from the supplier with batch and expiry numbers, and the till picks the soonest-expiring batch automatically, so nothing expires on the shelf because of which one was grabbed first.',
    heroSrc: '/product/pharmacy-billing-main.webp',
    heroAlt: 'FlowXP pharmacy billing screen with a product on the bill and its batch picked automatically.',
    rows: [
      {
        eyebrow: 'The shelf',
        title: 'Medicines, devices and everything else, in one list.',
        body: 'Each product carries what a pharmacy needs to know about it: strength, dosage form, schedule, and whether it is batch, expiry or serial tracked.',
        points: ['Medicines, devices, consumables and more, one catalogue', 'Batch, expiry and serial tracking, set per product', 'Prescription-required flagged on the product itself', 'Low-stock and reorder levels'],
        src: '/product/pharmacy-products-main.webp', alt: 'FlowXP pharmacy product list with type, price, stock and batch/expiry tracking badges.'
      },
      {
        eyebrow: 'Receiving to selling',
        title: 'Receive direct from a supplier. Sell the oldest batch first.',
        body: 'No purchase order step: receive what arrived, with its batch number and expiry date, and it is on the shelf. At the till, first-expiry-first-out is the default, not something a cashier has to remember.',
        points: ['Direct goods receipt, batch and expiry captured on arrival', 'First-expiry-first-out picked automatically at the till', 'A batch can be quarantined, recalled or blocked from sale', 'An expired batch can never be sold, FEFO or manual pick'],
        src: '/product/pharmacy-batches-main.webp', alt: 'FlowXP pharmacy batch list with quantity, expiry date and status for each batch.'
      }
    ]
  }
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
