/* Wholesale: orders to dispatch, credit, buying and stock across warehouses. Screenshots are the real screens of the seeded
   demo wholesaler (Sunrise Distributors). */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'wholesale',
  label: 'Wholesale',
  short: 'Wholesale',
  blurb: 'Buy in bulk, sell on credit, fulfil in parts, and always know what is owed.',
  title: 'Buy in bulk, sell on credit, know what is owed.',
  lead: 'For wholesalers, dealers and stockists. Take orders, pick and dispatch them from the right warehouse, keep each customer’s credit and each supplier’s bill in view, and file GST from the same bills.',
  hero: { src: p('wholesale-orders'), alt: 'FlowXP sales orders listing each order with its customer, salesperson, status and total.' },
  heroPoints: ['Choose Wholesale when you sign up and these tools switch on', 'Works at a desk, a warehouse counter and on a phone', '7-day free trial, no card'],
  modules: [
    {
      id: 'orders', title: 'From a customer’s order to a dispatched invoice',
      body: 'Orders move through clear steps, and stock is reserved for them the moment they are confirmed, so two people can never promise the same carton.',
      points: ['Draft, submitted, confirmed, shipping, dispatched and delivered, each one visible', 'Orders that need a manager’s approval wait for it, and can be rejected with a reason', 'Stock reserved for confirmed orders, and available stock shown without it', 'Send what is in stock now and keep the rest as a back-order', 'Customer price lists, price tiers and standing discounts applied for you', 'Orders taken by an office team or by field salespeople', 'Print an order, export a list, and filter by status, customer or warehouse'],
      shots: [{ src: p('wholesale-orders'), alt: 'FlowXP sales orders listing each order with its customer, salesperson, status and total.' }, { src: p('wholesale-order-detail'), alt: 'FlowXP sales order with its progress steps, items ordered and reserved, customer and totals.' }]
    },
    {
      id: 'fulfilment', title: 'Pick, pack and deliver from the right warehouse',
      body: 'A picker gets a pick list, the warehouse packs it, and a driver delivers it, with every step recorded against the order.',
      points: ['Orders to pick, being picked, ready to dispatch, out for delivery and failed deliveries on one board', 'Pick lists that tell the picker which batch to take', 'Delivery challans and pick sheets you can print', 'Mark a delivery done, or failed with the reason', 'Part deliveries: invoice what went out and keep the rest open', 'Roles for warehouse managers, pickers and drivers, each seeing only their own work'],
      shots: [{ src: p('wholesale-fulfilment'), alt: 'FlowXP warehouse and delivery board with orders to pick, picks in progress, ready to dispatch, out for delivery and failed deliveries.' }]
    },
    {
      id: 'customers', title: 'Customers, credit and what they owe',
      body: 'Every customer has their own terms and credit limit, and you see what they owe and how late it is before you take the next order.',
      points: ['Payment terms, credit limit, salesperson and price list on each customer', 'What each customer owes, and what is overdue, in one list', 'A profile with the ledger, invoices, orders, ageing and special prices', 'Credit rules: warn, or block an order until a manager overrides', 'Hold orders from customers with overdue invoices, with a grace period you set', 'Import and export customers as a CSV file'],
      shots: [{ src: p('wholesale-customers'), alt: 'FlowXP customers with type, salesperson, payment terms, credit limit, amount owed and amount overdue.' }, { src: p('wholesale-customer-profile'), alt: 'FlowXP customer profile with amount owed, credit limit, available credit and details.' }]
    },
    {
      id: 'products', title: 'Products, units and prices',
      body: 'Sell a product by the piece, the carton or the bag, with the price changing as the quantity does.',
      points: ['Units of measure with conversions, like a carton of 12 or a bag of 25 kg', 'Price tiers by quantity, price lists by customer type, and promotions', 'A minimum order quantity on each product', 'HSN code and GST rate on every product', 'Batch, expiry and serial tracking, set per product', 'Labels with barcodes you can print', 'Change many prices at once, and import or export products and stock as CSV'],
      shots: [{ src: p('wholesale-products'), alt: 'FlowXP products and pricing with units, MRP, wholesale price, GST, minimum order and available stock.' }]
    },
    {
      id: 'inventory', title: 'Stock by warehouse, batch and expiry',
      body: 'See what is in each warehouse, what is promised to orders and what is about to expire, so nothing sits until it is worthless.',
      points: ['On hand, reserved, available, in transit, expired and damaged for every product', 'Batches with their expiry date, and what is expiring in 30, 60 and 90 days', 'Transfers between warehouses', 'Damaged goods held separately from sellable stock', 'A stock ledger: every movement, with what caused it', 'Warehouses and bins, with the reorder level for each product', 'Alerts for low stock and expiring batches'],
      shots: [{ src: p('wholesale-inventory'), alt: 'FlowXP wholesale inventory with low-stock and expiring counts and stock on hand, reserved and available for each product.' }, { src: p('wholesale-batches'), alt: 'FlowXP batches and expiry with each batch’s warehouse, expiry date, quantity on hand and value.' }]
    },
    {
      id: 'purchasing', title: 'Buying from suppliers',
      body: 'Order from suppliers, receive what actually arrives, and keep track of what is on its way.',
      points: ['Purchase orders with their status: ordered, part received, received', 'What is due in, and how late it is', 'Goods receipts with the supplier’s invoice number, batch and expiry', 'Receive in parts and leave the rest open', 'Suppliers with payment terms, GSTIN and what you owe', 'Returns to a supplier with a debit note'],
      shots: [{ src: p('wholesale-purchasing'), alt: 'FlowXP purchase orders with supplier, warehouse, status, total, balance and due date.' }, { src: p('wholesale-grn'), alt: 'FlowXP goods receipts with the purchase order, supplier invoice, warehouse and value of each.' }]
    },
    {
      id: 'money', title: 'Who owes you, and who you owe',
      body: 'Receivables and payables sit in one place, with ageing, so collection is a list, not a memory.',
      points: ['Customers’ outstanding by age: current, 1 to 30, 31 to 60, 61 to 90 and over 90 days', 'Record a payment against invoices, or as an advance', 'Receipts, including cheques that bounce', 'Supplier bills by due date, and pay them from the same screen', 'Overdue amounts flagged in red, with a Collect action', 'Reminders for overdue invoices and supplier payments falling due'],
      shots: [{ src: p('wholesale-money'), alt: 'FlowXP receivables with customers’ outstanding, overdue and current amounts and an ageing bar.' }, { src: p('wholesale-payables'), alt: 'FlowXP payables with what you owe suppliers, overdue amounts, ageing and unpaid supplier bills.' }]
    },
    {
      id: 'returns', title: 'Returns, with stock and GST put right',
      body: 'Goods coming back from customers and going back to suppliers, with the credit note or debit note and the tax corrected for you.',
      points: ['Customer returns and returns to a supplier', 'A reason on every return: damaged, wrong product, excess quantity, expired, rejected or quality issue', 'Stock goes back in, or to damaged goods, as you choose', 'Credit notes and debit notes with the tax reversed exactly', 'The customer’s balance and the supplier’s balance follow'],
      shots: [{ src: p('wholesale-returns'), alt: 'FlowXP returns listing customer returns and returns to suppliers with reason and value.' }]
    },
    {
      id: 'reports', title: 'Reports and GST',
      body: 'Sales, purchases, stock and money, worked out live from your records, with the GST files prepared.',
      points: ['Sales by customer, product, category, salesperson and warehouse, with margin', 'Open orders, purchases by supplier and product, and the goods receipt register', 'Stock valuation, low stock, expiry, slow-moving and dead stock', 'Receivables and payables ageing, customer balances and collections', 'Profit by customer, and returns', 'Every report exports to CSV and prints', 'GSTR-1 file for the GST portal, GSTR-3B figures, and e-invoice and e-way bill files'],
      shots: [{ src: p('wholesale-reports'), alt: 'FlowXP wholesale reports with sales and margin by product.' }, { src: p('wholesale-gst'), alt: 'FlowXP GST filing with business invoices, small consumer supplies and a GSTR-1 file to download.' }]
    },
    {
      id: 'rules', title: 'Rules, roles and alerts',
      body: 'Decide how strict credit is, who can approve what, and what FlowXP should tell you about.',
      points: ['What happens when an order is over the credit limit, and who can override', 'Orders held for customers with overdue invoices', 'Roles for sales managers and executives, warehouse managers and pickers, purchase managers, accountants, collection executives and drivers', 'Salespeople who see only their own customers and orders', 'Alerts for overdue invoices, supplier payments due, low stock and expiring batches', 'Order confirmed and dispatched messages to customers, once messaging is connected'],
      shots: [{ src: p('wholesale-settings'), alt: 'FlowXP wholesale settings with credit control rules, overdue grace period and approvals.' }]
    }
  ],
  included: [
    { group: 'Selling', items: ['Sales orders with approval', 'Stock reserved on confirmation', 'Part deliveries and back-orders', 'Price lists, tiers and standing discounts', 'Minimum order quantities', 'Orders by office team or field salespeople', 'Print and export'] },
    { group: 'Warehouse', items: ['Pick lists with batch to take', 'Packing and dispatch', 'Delivery challans and pick sheets', 'Failed delivery with reason', 'Several warehouses and bins', 'Transfers between warehouses'] },
    { group: 'Stock', items: ['On hand, reserved, available', 'Batches and expiry windows', 'Serial tracking', 'Damaged goods held apart', 'Stock ledger', 'Low-stock and expiry alerts', 'Barcode labels'] },
    { group: 'Customers and credit', items: ['Terms and credit limits', 'Block or warn over the limit', 'Hold on overdue invoices', 'Customer ledger and ageing', 'Special prices', 'CSV import and export'] },
    { group: 'Buying', items: ['Purchase orders', 'Goods receipts with batch and expiry', 'Receive in parts', 'Supplier terms and balances', 'Returns with debit notes'] },
    { group: 'Money', items: ['Receivables and payables ageing', 'Receipts and advances', 'Bounced cheques', 'Supplier payments', 'Credit notes with exact tax reversal', 'Collection and payment reminders'] },
    { group: 'Reports and tax', items: ['Sales and margin reports', 'Stock and expiry reports', 'Profit by customer', 'CSV export and print', 'GST invoices', 'GSTR-1 file, GSTR-3B figures', 'E-invoice and e-way bill files'] },
    { group: 'Team and control', items: ['Roles for every job in a wholesale business', 'Salespeople see only their own customers', 'Several warehouses and branches under one login', 'Activity log', 'Two-step login', 'Install on a phone'] }
  ],
  notYet: [
    'Splitting one order across two warehouses automatically. Reservation is per warehouse; move stock with a transfer.',
    'E-invoices and e-way bills created automatically at dispatch. The files are prepared from the GST screens on the invoice.',
    'A portal for your customers to place orders themselves. Orders are entered by your team or your salespeople.',
    'Matching a returned serial number back to the sale it came from. Serial numbers are recorded when goods are picked.'
  ],
  faq: [
    ['Can I bring in my products and customers?', 'Yes. Products, customers and suppliers can be imported from a CSV file. Each import is checked first and nothing is saved until every row is good, with the spreadsheet row named for any problem.'],
    ['Does it work with more than one warehouse?', 'Yes. Each warehouse has its own stock and bins, and orders reserve stock at the warehouse they ship from. Move stock between warehouses with a transfer.'],
    ['How does credit control work?', 'Each customer has terms and a limit. When an order would take them over, you choose what happens: warn, or block until a manager overrides. You can also hold orders from customers who have overdue invoices.'],
    ['Can my salespeople take orders on their phones?', 'Yes. Salespeople can take orders and collect payments from a phone and see only their own customers. If you run a field sales team with beats, targets and schemes, see Distribution.'],
    ['Does it handle GST?', 'Yes. Invoices carry GST, returns reverse it exactly, and the GSTR-1 file, GSTR-3B figures and e-invoice or e-way bill files are prepared for you to upload. Nothing is sent to the government for you.']
  ]
};
