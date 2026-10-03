/* Distribution: the wholesale engine plus principals, territories and beats, a field sales team, schemes and vans. Facts are
   from DISTRIBUTOR.md and the screens; screenshots are the real screens of the seeded demo distributor. */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'distributor',
  label: 'Distribution',
  short: 'Distribution',
  blurb: 'A field team selling from the van, syncing the moment they are back online.',
  title: 'A field team that keeps selling when there is no signal.',
  lead: 'For distributors who carry stock for several brands and sell to retailers, route by route. Built on the same engine as wholesale, with principals, territories and beats, trade schemes, targets, commission and vans.',
  hero: { src: p('dist-dashboard'), alt: 'FlowXP distributor dashboard with sales today, collections, what retailers owe, what you owe principals, stock value and alerts.' },
  heroPoints: ['Turn on Distributor in your wholesale settings, and the Distributor menu appears', 'Everything in Wholesale is already underneath', '7-day free trial, no card'],
  modules: [
    {
      id: 'field', title: 'In the field: the day’s beat on a phone',
      body: 'A salesperson opens today’s beat on their phone: retailers in route order, what each owes and what to offer. They take the order, collect the payment and log the visit.',
      points: ['Today’s retailers in route order, with visited and order-taken marks', 'Each retailer’s credit, unpaid invoices, recent orders and offers on one screen', 'Take an order, collect a payment, or log a visit without an order', 'Minimum order quantities and schemes applied as the order is built', 'Month target and how much is needed each day', 'Works with no signal: visits, orders and payments are kept on the phone and sent in order when it reconnects'],
      shots: [{ src: p('dist-field'), alt: 'FlowXP field sales on a phone with today’s beat, retailers in route order and the month target.', phone: true }, { src: p('dist-field-retailer'), alt: 'FlowXP field sales retailer screen with what they owe, Take order and Collect payment buttons and unpaid invoices.', phone: true }]
    },
    {
      id: 'principals', title: 'More than one principal, each with its own terms',
      body: 'Distribute for several manufacturers at once. Each has its own agreement, margin, brands and what you owe them.',
      points: ['Principals with their agreement dates, margin and payment terms', 'Brands and products belong to a principal, with the principal’s price and pack size', 'Agreements that are in force, ending soon or ended, in one list', 'What you owe each principal, less returns and the scheme cost you can claim back', 'Primary sales (what you buy from principals) and secondary sales (what you sell to retailers) kept apart'],
      shots: [{ src: p('dist-principals'), alt: 'FlowXP principals and brands with each manufacturer’s agreement, margin, brands, products and what you owe.' }]
    },
    {
      id: 'territories', title: 'Territories and beats',
      body: 'Lay out where your retailers are and the route each salesperson walks on each day.',
      points: ['A tree of region, territory and area, with the retailers in each', 'Assign retailers to an area in bulk', 'Beats: a salesperson’s route for a weekday, with retailers in order', 'A retailer sits on one beat for each weekday, so routes never overlap', 'Prices that differ by territory'],
      shots: [{ src: p('dist-territories'), alt: 'FlowXP territories showing regions, territories and areas with the number of retailers in each.' }, { src: p('dist-beats'), alt: 'FlowXP beats listing each route by day, salesperson and number of retailers.' }]
    },
    {
      id: 'team', title: 'Sales team, targets and commission',
      body: 'Set what each person should sell, see how far along they are, and work out what they have earned.',
      points: ['Salespeople in a hierarchy: managers, field representatives, executives and collection executives', 'Targets by value or quantity, for the business, a person, a territory, a brand, a category, a product or a retailer', 'Weekly, monthly, quarterly or yearly targets, with progress and what is needed each day', 'Commission rules by value, per unit or margin, with a minimum-achievement gate', 'A commission statement for any period', 'A field representative sees only their own retailers, beats and targets'],
      shots: [{ src: p('dist-team'), alt: 'FlowXP sales team with each person’s role, territory, retailers, beats and sales against target.' }, { src: p('dist-targets'), alt: 'FlowXP targets for the whole business, each salesperson and territory, with progress and what is needed per day.' }, { src: p('dist-commission'), alt: 'FlowXP commission earned by each salesperson, with net sales, collections and margin.' }]
    },
    {
      id: 'schemes', title: 'Trade schemes that apply themselves',
      body: 'Run offers for retailers without recalculating them by hand. The right scheme is applied as the order is built.',
      points: ['Buy X get Y free, quantity discounts and value discounts', 'Funded by you or by the principal, so claims are clear', 'Who gets it: all retailers, chosen retailers, territories or customer types', 'Dates, and a warning when a scheme ends this week', 'Several schemes that fit: give the best one, or let them stack', 'How each scheme has performed', 'Free goods shown on the order as free lines'],
      shots: [{ src: p('dist-schemes'), alt: 'FlowXP schemes listing each trade scheme, its type, who funds it and when it runs.' }]
    },
    {
      id: 'vans', title: 'Selling from the van',
      body: 'Load a van from the warehouse, sell from it, and count what is left at the end of the day.',
      points: ['A register of vans with their driver, salesperson and route', 'Load stock onto a van from a warehouse, by batch', 'Sell from the van to a retailer, with batches picked soonest-expiry first', 'Count and close at the end of the day, with the difference shown', 'Return what is left to the warehouse', 'Van stock value and what sold today'],
      shots: [{ src: p('dist-vehicles'), alt: 'FlowXP vehicle stock with the products on a van by batch and expiry, quantity and value.' }]
    },
    {
      id: 'reports', title: 'Distributor reports and principal settlement',
      body: 'Primary and secondary sales, margin, targets, collections and what you owe each principal, all from one set of figures.',
      points: ['Primary and secondary sales, and sales by territory, beat, brand and principal', 'Profit and margin by product, brand, principal, retailer, salesperson, territory or category', 'Target against achievement, and performance by salesperson, territory and beat', 'Collections by salesperson and by territory', 'Fast-moving and dead stock, and vehicle stock', 'Scheme performance', 'Principal settlement: what you owe a principal, less returns and the scheme cost you can claim'],
      shots: [{ src: p('dist-settlement'), alt: 'FlowXP principal settlement showing goods received, returns, scheme claims and payments for each principal.' }]
    },
    {
      id: 'base', title: 'And everything wholesale has underneath',
      body: 'Orders, warehouses, credit, purchasing, returns, money owed and GST are the same as in Wholesale, so a distributor loses nothing by growing into it.',
      points: ['Sales orders with approval, part deliveries and back-orders', 'Warehouses, batches and expiry', 'Customer credit limits and overdue holds', 'Purchase orders and goods receipts', 'Receivables and payables with ageing', 'GST invoices, credit notes and the GST files'],
      shots: [{ src: p('wholesale-orders'), alt: 'FlowXP sales orders listing each order with its customer, salesperson, status and total.' }]
    }
  ],
  included: [
    { group: 'Field sales', items: ['Today’s beat on a phone', 'Retailer credit and unpaid invoices', 'Take orders and collect payments', 'Log a visit with or without an order', 'Offline orders, sent in order on reconnect', 'Visit location, only if the business turns it on'] },
    { group: 'Principals and brands', items: ['Principals with agreements and margin', 'Brands and pack sizes', 'Principal prices', 'What you owe each principal', 'Principal settlement report'] },
    { group: 'Territories', items: ['Region, territory and area tree', 'Retailers placed in areas', 'Beats by weekday', 'One beat per retailer per day', 'Territory pricing'] },
    { group: 'Sales team', items: ['Sales hierarchy and roles', 'Targets by person, territory, brand, category, product or retailer', 'Target progress and daily need', 'Commission rules and statements', 'Salespeople see only their own work'] },
    { group: 'Schemes', items: ['Buy X get Y free', 'Quantity and value discounts', 'Funded by you or the principal', 'By retailer, territory or type', 'Free lines on orders', 'Scheme performance'] },
    { group: 'Vans', items: ['Van register', 'Load by batch', 'Sell from the van', 'Day-end count and close', 'Return to warehouse'] },
    { group: 'Reports', items: ['Primary and secondary sales', 'Sales by territory, beat, brand, principal', 'Margin by product, brand, retailer, salesperson', 'Target against achievement', 'Collections by salesperson and territory', 'Fast-moving and dead stock', 'CSV export'] },
    { group: 'Wholesale underneath', items: ['Sales orders and fulfilment', 'Warehouses, batches and expiry', 'Credit control', 'Purchasing and goods receipts', 'Receivables and payables', 'Returns', 'GST files', 'Bulk import of products, retailers, price lists and stock'] }
  ],
  notYet: [
    'Splitting one order across two warehouses automatically. Reservation is per warehouse; move stock with a transfer.',
    'E-invoices and e-way bills created automatically at dispatch. The files are prepared from the GST screens on the invoice.',
    'Live tracking of a van on a map. A visit can record its location, but only if the business turns that on.',
    'A portal for retailers to place orders themselves. Orders are taken by your salespeople or your office.'
  ],
  faq: [
    ['What happens when a salesperson has no signal?', 'Visits, orders and payments are kept on their phone and sent in order when the connection returns, or every 20 seconds while something is waiting. Sending the same thing twice never creates a second order.'],
    ['Can I distribute for several brands?', 'Yes. Each principal has its own agreement, brands, products, prices and what you owe them, and reports can be cut by principal or brand.'],
    ['How do trade schemes work?', 'You set a scheme once: what it gives, who gets it, when it runs and who funds it. It is applied as the order is built, and free goods appear as free lines on the order.'],
    ['Do I need Wholesale as well?', 'Distribution is part of Wholesale. You choose Wholesale when you sign up, then turn on Distributor in the wholesale settings. Everything in Wholesale stays available.'],
    ['Does it handle GST?', 'Yes. Invoices carry GST, returns reverse it exactly, and the GSTR-1 file, GSTR-3B figures and e-invoice or e-way bill files are prepared for you to upload. Nothing is sent to the government for you.']
  ]
};
