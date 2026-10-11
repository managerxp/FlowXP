/* Retail shops and supermarkets: a barcode till, expiry-dated batches sold soonest-first, receiving by scan, stock counts, offers and returns. Every
   point names something with a screen in the app. The screenshots are the real screens of the demo supermarket (npm run seed:supermarket in backend). */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'retail',
  label: 'Retail & supermarkets',
  short: 'Retail',
  blurb: 'A barcode till, stock that counts itself down, dated dairy and bread sold soonest-first, and offers the till applies for you.',
  title: 'Scan, bill, and always know what is on the shelf.',
  lead: 'For supermarkets, kirana and general stores, and shops of any kind that sell packed goods. Bill at the counter with a scanner, receive deliveries by scanning them in, count a shelf with your phone, and see what is running low or about to expire before a customer finds it.',
  hero: { src: p('retail-billing'), alt: 'FlowXP supermarket billing with eight items on the bill, an offer taking money off the milk and the bread, GST, payment methods and a Charge button.' },
  heroPoints: ['Choose Retail or Supermarket when you sign up and these tools switch on', 'Works on a counter PC, a tablet and a phone', '7-day free trial, no card'],
  modules: [
    {
      id: 'billing', title: 'A counter that keeps the queue moving',
      body: 'Scan a barcode or tap an item, and it is on the bill. Offers come off by themselves, and the till keeps working when the internet drops.',
      points: ['Scan with a barcode scanner, the phone camera or the keyboard, or search by name or SKU', 'Loose items sold by the kilo, with weight typed in', 'A custom item for something that is not in the list yet', 'Offers applied by the till and shown line by line, so the customer sees what they saved', 'Cash, UPI, card, bank or pay later, or a bill split across them', 'Hold a bill while the customer fetches one more thing', 'Keeps billing with no signal, using the products saved on the device', 'GST on every line at the product’s own rate'],
      shots: [{ src: p('retail-billing'), alt: 'FlowXP supermarket billing with eight items on the bill, an offer taking money off the milk and the bread, GST, payment methods and a Charge button.' }]
    },
    {
      id: 'products', title: 'Every product, with its barcode and its margin',
      body: 'Brand, category, MRP, selling price and cost on one list, so you can see what each item earns, not just what it sells.',
      points: ['A product gets an SKU by itself, and as many barcodes as the packs it comes in', 'MRP, selling price, cost, HSN code and GST rate for each product', 'Brand and category, with search by name, brand, SKU or barcode', 'The margin on every product, and a flag on the ones that earn too little', 'Turn on expiry tracking for dairy, bread and packed food', 'Add a product from the till the first time its barcode is scanned', 'Archive a product without losing its history'],
      shots: [{ src: p('retail-products'), alt: 'FlowXP supermarket products with brand, category, price, stock left and the margin on each product.' }]
    },
    {
      id: 'stock', title: 'The stock center: the whole shelf in one place',
      body: 'What you have, what is low, what is about to expire and what has moved, without opening five reports.',
      points: ['Units on hand and the stock value at cost and at MRP', 'Out of stock and low stock against each product’s reorder level', 'How many products expire within 30 days, and how many already have', 'Every movement: sales, deliveries, counts, adjustments and wastage', 'Search by name, SKU or barcode and filter by category', 'Adjust one item, or record wastage, in a couple of taps'],
      shots: [{ src: p('retail-stock'), alt: 'FlowXP stock center with products, units on hand, stock value, out of stock, low stock and expiring-soon figures above a list of what is on the shelf.' }]
    },
    {
      id: 'expiry', title: 'Dairy and bread sold before they expire',
      body: 'Stock that expires arrives with its dates. The till sells the batch that expires first, so the newest packet is not sold while an older one sits at the back.',
      points: ['Batches with their expiry date and quantity, soonest first', 'The till takes the soonest-expiring batch automatically on every sale', 'Filters for expired, the next 7 days and the next 30 days', 'Quantities go back into the right batch when a bill is cancelled or an item returned', 'Write off an expired batch in one tap, recorded as expired wastage so the count stays true', 'The dashboard says how many items are expiring and how many have expired'],
      shots: [{ src: p('retail-expiry'), alt: 'FlowXP expiry list for a supermarket showing milk and bread batches expiring in a day, with their quantity and value at cost.' }]
    },
    {
      id: 'receiving', title: 'Receive a delivery by scanning it in',
      body: 'Scan what arrived, set the quantity and cost, and press Receive. The stock goes on the shelf, the cost updates and the expiry batches are filed.',
      points: ['Scan with the camera, a scanner or the search box, at a desk or at the back door on a phone', 'Quantity, cost, GST rate, expiry date and batch number on each line', 'The supplier and the supplier’s bill number kept with the purchase', 'Read a supplier’s bill to fill the lines in for you', 'Record the payment to the supplier as you receive', 'Import products or stock levels from a spreadsheet when you start'],
      shots: [{ src: p('retail-receive'), alt: 'FlowXP receive stock with a supplier chosen and two items scanned in, each with quantity, cost, GST and an expiry date.' }]
    },
    {
      id: 'counts', title: 'Count a shelf by scanning it',
      body: 'Scan the items on a shelf and FlowXP shows what differs from the system as you go. Nothing changes until you apply the count.',
      points: ['Count the whole store, or one category at a time', 'Each scan counts one more, or type the number you found', 'See what is short and what is extra before you apply', 'Applying turns each difference into a stock movement, so the history says what the count found', 'A sale rung up while you count does not look like a shortage', 'A list of every count, with when it was done and what it changed'],
      shots: [{ src: p('retail-counts'), alt: 'FlowXP stock counts with a dairy shelf count applied, showing three products adjusted and the units and value they were out by.' }]
    },
    {
      id: 'offers', title: 'Offers the till applies by itself',
      body: 'Set an offer once and every till honours it, between the dates you choose. The bill shows what each offer took off.',
      points: ['A percentage off one product or a whole category', 'Buy some, get some free', 'Three for one price, or a bundle price for one product', 'Any two from a set of products for one price', 'Between two dates, and optionally only for a customer on the bill', 'Switch an offer off or on without deleting it'],
      shots: [{ src: p('retail-offers'), alt: 'FlowXP offers for a supermarket: any 2 biscuits for 70 rupees, buy 1 get 1 free on bread, and 3 milk packets for 150 rupees.' }]
    },
    {
      id: 'returns', title: 'Returns and exchanges at the counter',
      body: 'Find the bill the customer brought back, choose what comes back, and either pay it out or keep the credit for something else.',
      points: ['Find the bill by number, customer name or phone', 'Choose the items and quantities that come back', 'A credit note of its own, with GST reversed exactly', 'Stock goes back on the shelf, and into the right batch', 'Pay the money back, or keep it as credit for an exchange', 'An exchange continues in billing, where the credit pays for the new items'],
      shots: [{ src: p('retail-returns'), alt: 'FlowXP returns and exchanges listing recent supermarket bills, each with a Return items button.' }]
    },
    {
      id: 'reports', title: 'Reports and GST',
      body: 'Sales, purchases, stock and tax, worked out from your own bills, with the GST files prepared for you.',
      points: ['Sales by day and hour, bills, average bill and GST collected', 'Compare any period with the one before it', 'Top customers and who owes you', 'Purchases by supplier, expenses and stock value', 'Every report exports to CSV', 'GSTR-1 file for the GST portal, GSTR-3B figures and HSN codes on the files', 'Credit notes that reverse the tax exactly'],
      shots: [{ src: p('retail-reports'), alt: 'FlowXP supermarket reports with sales, bills, average bill, GST collected and a day-by-day sales chart.' }, { src: p('retail-gst'), alt: 'FlowXP GST filing for a supermarket with the month’s figures and a GSTR-1 file ready to download.' }]
    }
  ],
  included: [
    { group: 'Billing', items: ['Barcode scanner, camera or keyboard', 'Search by name, SKU or barcode', 'Loose items by weight', 'Custom items', 'Offers applied by the till', 'Cash, UPI, card, bank, pay later', 'Split payment', 'Bills on hold', 'Billing with no signal', 'GST on every line'] },
    { group: 'Products', items: ['Automatic SKUs', 'Any number of barcodes per product', 'Brand and category', 'MRP, selling price and cost', 'HSN and GST rate', 'Margin on every product', 'Expiry tracking', 'Add a product from the till', 'Import from a spreadsheet'] },
    { group: 'Stock', items: ['Stock center', 'Units on hand', 'Low-stock and out-of-stock alerts', 'Reorder levels', 'Stock value at cost and at MRP', 'Every movement recorded', 'Adjustments and wastage', 'Transfers between stores'] },
    { group: 'Expiry', items: ['Batches with expiry dates', 'Soonest-expiry sold first', 'Expired and expiring-soon lists', 'Batches restored on a return or cancel', 'Write off expired batches'] },
    { group: 'Receiving and counts', items: ['Receive by scanning', 'Read a supplier’s bill', 'Supplier and bill number kept', 'Payment to the supplier', 'Stock counts by scanning', 'Count by category', 'Variance before applying'] },
    { group: 'Offers and returns', items: ['Percent off', 'Buy some, get some free', 'Bundle price', 'Any-N-for-one-price', 'Dates and customer-only offers', 'Returns and exchanges', 'Credit notes with exact GST reversal'] },
    { group: 'Money and tax', items: ['Customer credit and what is owed', 'Suppliers and what you owe', 'Expenses', 'Sales and purchase reports', 'CSV export', 'GSTR-1 file', 'GSTR-3B figures'] },
    { group: 'Team and stores', items: ['Several stores under one login', 'Each store has its own stock and invoice numbers', 'Roles and per-person permissions', 'Activity log', 'Two-step login', 'Install on a phone or tablet'] }
  ],
  notYet: [
    'Connecting a weighing scale. Loose items are sold by the kilo with the weight typed in; a scale does not feed the till yet.',
    'Printing shelf labels or price tags with barcodes.',
    'Counting stock and setting up offers in the phone app. The phone bills, scans and shows stock and use-by dates; counts and offers are on the website for now.'
  ],
  faq: [
    ['Does it work with a barcode scanner?', 'Yes. A USB or Bluetooth scanner that types like a keyboard fills the search box, so it works the moment you plug it in. You can also scan with the phone camera, and a product can carry as many barcodes as its packs have.'],
    ['Can I sell loose items like vegetables by the kilo?', 'Yes. Set the product’s unit to kilogram and type the weight at the till. A scale is not connected to the till yet.'],
    ['How does it handle items that expire?', 'Turn on expiry tracking for the product and give the expiry date when you receive it. The till sells the batch that expires first, and the stock center lists what has expired and what expires in the next 7 or 30 days.'],
    ['What if the internet goes down at the counter?', 'The till keeps billing with the products saved on the device, and the bills are sent when the signal is back.'],
    ['Can I count stock without closing the shop?', 'Yes. A count only records what you found. Nothing changes until you apply it, and a sale made while you count does not show up as a shortage.'],
    ['Does it handle GST?', 'Yes. Bills carry GST at each product’s rate with its HSN code, credit notes reverse it exactly, and the GSTR-1 file and GSTR-3B figures are prepared for you to upload. Nothing is sent to the government for you.']
  ]
};
