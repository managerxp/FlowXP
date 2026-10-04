/* Pharmacies: batch and expiry tracked stock, goods receipts, and a till that sells the soonest-expiring batch first. Facts are
   from the pharmacy module and screens; screenshots are the real screens of the seeded demo pharmacy. */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'pharmacy',
  label: 'Pharmacies',
  short: 'Pharmacies',
  blurb: 'Batch and expiry tracked stock, received from the supplier and sold soonest-expiry first.',
  title: 'Every batch tracked, the soonest-expiring one sold first.',
  lead: 'For pharmacies and medical stores. Receive stock with its batch and expiry date, and the till picks the soonest-expiring batch for you, so nothing expires on the shelf because of which one was grabbed first.',
  hero: { src: p('pharmacy-pos'), alt: 'FlowXP pharmacy billing with three medicines on the bill, each with the earliest-expiry batch picked automatically.' },
  heroPoints: ['Choose Pharmacy when you sign up and these tools switch on', 'Works on a counter PC, a tablet and a phone', '7-day free trial, no card'],
  modules: [
    {
      id: 'billing', title: 'A till that knows batches',
      body: 'Search or scan a medicine, and the batch that expires first is chosen for you. A cashier can pick a different batch, but never one that cannot be sold.',
      points: ['First-expiry-first-out is the default, not something a cashier has to remember', 'Pick a particular batch when you need to', 'An expired batch can never be sold, whether picked by the till or by hand', 'A batch that is quarantined, recalled or blocked is never picked', 'Find a customer by name or phone, or bill as a walk-in', 'Discounts, split payment and pay later', 'GST on every line at the product’s own rate'],
      shots: [{ src: p('pharmacy-pos'), alt: 'FlowXP pharmacy billing with three medicines on the bill, each with the earliest-expiry batch picked automatically.' }]
    },
    {
      id: 'products', title: 'Medicines, devices and everything else in one list',
      body: 'Each product carries what a pharmacy needs to know about it: what it is, who makes it, its strength and form, its schedule, and whether it is batch, expiry or serial tracked.',
      points: ['Medicines, devices, consumables, surgical items, wellness, personal care, baby care, orthopedic and diagnostic products', 'Manufacturer, strength, dosage form, salt composition and drug schedule', 'Prescription-required marked on the product, shown as Rx', 'Batch, expiry and serial tracking, set for each product', 'MRP and selling price, HSN code and GST rate', 'Warranty period for devices', 'Search by name, SKU, barcode or manufacturer, and filter by type'],
      shots: [{ src: p('pharmacy-products'), alt: 'FlowXP pharmacy products with type, manufacturer and strength, price, stock and batch, expiry and Rx badges.' }]
    },
    {
      id: 'receiving', title: 'Receive straight from the supplier',
      body: 'No purchase order step. Record what arrived with its batch number and expiry date, and it is on the shelf.',
      points: ['A goods receipt for each delivery, with the supplier and date', 'Batch number, manufacturing date and expiry date for each line', 'Damaged quantity recorded and kept off the sellable shelf', 'Serial numbers for tracked devices', 'The cost and GST rate of each line', 'A list of every receipt, with its supplier and value'],
      shots: [{ src: p('pharmacy-grn'), alt: 'FlowXP goods receipts with the receipt number, supplier, branch, date and value of each delivery.' }]
    },
    {
      id: 'expiry', title: 'Expiry and recalls under control',
      body: 'See what is on the shelf, what is about to expire and what has been pulled from sale, before a customer is handed the wrong strip.',
      points: ['Stock by product: on hand, reserved, available and reorder level', 'Batches with their quantity and expiry date, soonest first', 'Filters for active, expiring soon, expired, quarantined, recalled and blocked batches', 'Quarantine, recall or block a batch with a reason, and put it back when it is cleared', 'Expired stock stays in the count until you act on it, but can never be sold', 'Low-stock and reorder alerts'],
      shots: [{ src: p('pharmacy-inventory'), alt: 'FlowXP pharmacy inventory with stock on hand, reserved, available and reorder level for each product.' }, { src: p('pharmacy-batches'), alt: 'FlowXP batches and expiry with each batch’s quantity, expiry date, status and a Change status menu.' }]
    },
    {
      id: 'dashboard', title: 'The shelf at a glance',
      body: 'Open FlowXP and see what needs attention today: expired batches, batches expiring soon and what is running low.',
      points: ['Expired batches still in stock, expiring soon, and low or out of stock', 'What is running low, and how far below its reorder level', 'The last goods receipts, with supplier and value', 'A warning that expired batches still count in stock value until you act on them'],
      shots: [{ src: p('pharmacy-dashboard'), alt: 'FlowXP pharmacy dashboard with expired batches, expiring soon, low stock, items running low and recent goods receipts.' }]
    },
    {
      id: 'customers', title: 'Customers, credit and suppliers',
      body: 'Know your regular customers, who owes you, and what you owe your distributors.',
      points: ['A customer list with their bills and what they spent', 'Sell on credit and see the balance', 'Suppliers with what you owe each one', 'Payments to suppliers recorded against what you owe', 'Every bill, with its payment status, in one list'],
      shots: [{ src: p('pharmacy-customers'), alt: 'FlowXP customers with a customer open showing what they spent, their bills and what they owe.' }]
    },
    {
      id: 'reports', title: 'Reports and GST',
      body: 'Sales, purchases, stock and tax, worked out from your own bills, with the GST files prepared.',
      points: ['Sales by day and hour, bills, average bill and GST collected', 'Top customers and who owes you', 'Purchases by supplier, expenses and stock value', 'Every report exports to CSV', 'GSTR-1 file for the GST portal, and GSTR-3B figures', 'Credit notes that reverse the tax exactly', 'HSN codes carried onto the GST files'],
      shots: [{ src: p('pharmacy-reports'), alt: 'FlowXP pharmacy reports with sales, bills, average bill, GST collected and sales by day.' }, { src: p('pharmacy-gst'), alt: 'FlowXP GST filing for a pharmacy with the month’s invoices and a GSTR-1 file ready to download.' }]
    }
  ],
  included: [
    { group: 'Billing', items: ['Search or scan', 'First-expiry-first-out by default', 'Choose a batch by hand', 'Expired batches never sold', 'Quarantined, recalled and blocked batches never sold', 'Customer by name or phone', 'Discounts, split payment, pay later', 'GST at each product’s rate'] },
    { group: 'Products', items: ['Medicines, devices, consumables and more', 'Manufacturer, strength, dosage form', 'Salt composition and drug schedule', 'Prescription-required marked', 'Batch, expiry and serial tracking', 'MRP and selling price', 'Warranty for devices', 'HSN and GST'] },
    { group: 'Receiving', items: ['Goods receipt from the supplier', 'Batch, manufacturing and expiry date', 'Damaged quantity kept apart', 'Serial numbers', 'Supplier and date on every receipt'] },
    { group: 'Stock and expiry', items: ['On hand, reserved, available', 'Reorder levels and alerts', 'Batches by expiry', 'Expiring soon and expired lists', 'Quarantine, recall and block', 'Dashboard of what needs attention'] },
    { group: 'Money', items: ['Customer credit', 'Supplier balances and payments', 'Expenses', 'Sales and purchase reports', 'CSV export'] },
    { group: 'Tax', items: ['GST invoices', 'Credit notes with exact tax reversal', 'GSTR-1 file', 'GSTR-3B figures', 'HSN codes on the files'] },
    { group: 'Team and control', items: ['Several stores under one login', 'Roles and per-person permissions', 'Activity log', 'Two-step login', 'Install on a phone or tablet'] }
  ],
  notYet: [
    'The prescription on the bill. A medicine can be marked prescription-required and shows an Rx badge, but the doctor and patient are not recorded on the bill yet.',
    'A register for Schedule H1 or narcotic drug sales.',
    'A purchase order document. Pharmacy receives straight from the supplier on a goods receipt, by design.'
  ],
  faq: [
    ['How does the till choose a batch?', 'By default it takes the batch that expires first. You can pick a different one by hand. A batch that has expired, or has been quarantined, recalled or blocked, can never be sold either way.'],
    ['What about medicines that need a prescription?', 'You can mark a product as prescription-required, and it shows an Rx badge on the product list. The bill does not record the prescription itself yet.'],
    ['Can it track serial numbers on devices?', 'Yes. Mark a product as serial tracked and record the serial numbers when you receive it. You can also set a warranty period for devices.'],
    ['What happens to expired stock?', 'It can never be sold, and it is flagged on the dashboard and in the batch list. It still counts in stock value until you quarantine or block it, which FlowXP reminds you about.'],
    ['Does it handle GST?', 'Yes. Bills carry GST at each product’s rate with its HSN code, credit notes reverse it exactly, and the GSTR-1 file and GSTR-3B figures are prepared for you to upload. Nothing is sent to the government for you.']
  ]
};
