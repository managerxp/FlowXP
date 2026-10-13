/* Auto spare parts shops: cars, bikes and scooters; a counter, a warehouse with racks, garages on credit. Facts from AUTO_PARTS.md and the screens; screenshots are the real screens of the seeded demo shop. */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'auto-parts',
  label: 'Auto spare parts',
  short: 'Auto parts',
  blurb: 'Part numbers, vehicle fitment and rack and bin locations, on the same stock and bills.',
  title: 'Find the part. Find the shelf. Bill it.',
  lead: 'For car, bike and scooter spare parts shops and their warehouses. Search by OEM or any part number, see which vehicles a part is recorded to fit, know which bin it is in, receive deliveries with damaged and rejected counted apart, and sell to garages on trade prices and credit.',
  hero: { src: p('parts-catalogue'), alt: 'FlowXP parts catalogue with each part, its OEM and manufacturer number, type, price and stock.' },
  heroPoints: ['Choose Auto spare parts when you sign up and these tools switch on', 'Works on a counter PC, a tablet and a phone', '7-day free trial, no card'],
  modules: [
    {
      id: 'catalogue', title: 'Every part with every number it is known by',
      body: 'A part has its SKU and barcode, the OEM number, the manufacturer number and any alternates or old numbers. Type or scan any of them, with or without dashes and spaces, and the part comes up.',
      points: ['OEM, manufacturer, alternate, supplier and replaced-by numbers on one part', 'OEM, aftermarket, refurbished and used kept apart', 'Car, bike, scooter, truck and bus parts', 'Reorder level, maximum stock and preferred supplier', 'Parts that look like the same part twice are listed for you to check; nothing is merged for you', 'The same product, price, GST and stock as the rest of FlowXP, so billing and reports need nothing extra'],
      shots: [{ src: p('parts-catalogue'), alt: 'FlowXP parts catalogue with each part, its OEM and manufacturer number, type, price and stock.' }, { src: p('parts-detail'), alt: 'FlowXP part with its vehicles: each with fitment shown as verified or not verified.' }]
    },
    {
      id: 'fitment', title: 'Fitment that is never assumed',
      body: 'You build your own list of makes, models and variants, and record which parts fit which vehicle. A part with no record is never presented as fitting.',
      points: ['Makes, models and variants with years, engine and fuel, typed in or imported from a file', 'Each fitment is verified, not verified, or does not fit', 'New fitment is not verified until a person verifies it', 'Find parts for a vehicle: only parts with a record, each labelled', 'Parts recorded as not fitting are left out and counted', 'Alternates are suggested only from verified fitment', 'FlowXP does not ship a vehicle database: fitment is what your shop records or imports'],
      shots: [{ src: p('parts-vehicles'), alt: 'FlowXP vehicle search for a Maruti Suzuki Swift with each part labelled as verified or not verified.' }]
    },
    {
      id: 'racks', title: 'Racks and bins you can trust',
      body: 'Lay out the warehouse as warehouse, zone, aisle, rack, shelf and bin, using your own names. Every bin has a code, a QR and a barcode label, and the quantity on the shelves can never be more than the stock the books show.',
      points: ['A tree of places of up to six levels, with your own names for them', 'Add a run of racks or bins in one go: R01 to R12, bins A to D', 'Print labels with the code in large type, a QR that opens the place when scanned, and a barcode', 'A limit for each bin, with a warning when it is exceeded', 'Switch off a place only when it is empty', 'Where one part sits, with its pick bin', 'A sale, a write-off or a count shortage takes from the shelves by itself, so the shelf and the stock agree'],
      shots: [{ src: p('parts-racks'), alt: 'FlowXP racks and bins: the warehouse, zones, racks and bins with units, parts and how full each bin is.' }, { src: p('parts-putaway'), alt: 'FlowXP put away list of parts received but not yet on a shelf.' }]
    },
    {
      id: 'receiving', title: 'Receiving that counts what really arrived',
      body: 'Book a delivery against the supplier invoice. What came is accepted, damaged or rejected, and only the accepted part becomes stock you can sell.',
      points: ['Accepted, damaged and rejected counted apart; rejected goes back to the supplier', 'Put each part in a bin as you receive it, or leave it for the put-away list', 'The same supplier invoice cannot be booked twice, and a retried request posts once', 'Purchase orders, payables and GST work as for any purchase', 'Cancel a receipt while its stock is still there', 'Supplier claims for damaged, rejected and warranty parts, followed up until credited or replaced'],
      shots: [{ src: p('parts-receive'), alt: 'FlowXP goods receipt showing parts arrived, accepted, damaged and rejected, and the bin each went to.' }]
    },
    {
      id: 'trade', title: 'Garages, trade prices and credit',
      body: 'Give a garage or a fleet a price list and a credit limit. The bill uses their price, and the limit is checked when part of the bill is left to pay.',
      points: ['Customer class: retail, workshop, garage, fleet or wholesale', 'A price list as a percentage off, with set prices for single parts', 'A credit limit with a policy: ignore it, warn, or refuse the bill', 'What they owe and what is left of the limit', 'Hold a part for a customer: held parts cannot be sold to anyone else and are used up when that customer is billed', 'Returns record why the part came back and what became of it: back on the shelf, damaged, to the supplier or scrapped'],
      shots: [{ src: p('parts-trade'), alt: 'FlowXP garage account with class, price list, credit limit and what the customer owes.' }]
    },
    {
      id: 'reports', title: 'Reports that explain themselves',
      body: 'See what sells fast, what has sat for months, how old the stock is, what to buy and how each supplier performs. Every suggestion shows the rule behind it, and none of them changes anything.',
      points: ['Fast, slow and dead stock with the rules stated', 'Stock age by days since it last arrived', 'What to buy: sales speed against lead time and safety days, less what is on hand and on order, capped by the maximum stock', 'Parts often bought together', 'Supplier damaged and rejected share, order fill and days to deliver', 'Stock value at cost and at selling price, and how full the racks are', 'Every list downloads as a spreadsheet'],
      shots: [{ src: p('parts-reorder'), alt: 'FlowXP what to buy list with each part, its supplier, the suggested quantity and the reason.' }, { src: p('parts-movers'), alt: 'FlowXP fast, slow and dead stock with units sold and what the stock is worth at cost.' }]
    }
  ],
  included: [
    { group: 'Catalogue', items: ['OEM and any part numbers', 'Search with or without dashes', 'OEM, aftermarket, refurbished, used', 'Reorder level and maximum stock', 'Duplicate part check'] },
    { group: 'Vehicles', items: ['Makes, models and variants of your own', 'Import from a file', 'Verified, not verified and does not fit', 'Find parts for a vehicle', 'Alternates from verified fitment only'] },
    { group: 'Warehouse', items: ['Warehouse to bin, your own names', 'QR and barcode labels', 'Put away and bin to bin moves', 'Pick bin and bin limits', 'Shelf quantity always agrees with stock'] },
    { group: 'Receiving', items: ['Accepted, damaged, rejected', 'Put away on receipt', 'No duplicate supplier invoice', 'Cancel a receipt', 'Supplier claims'] },
    { group: 'Selling', items: ['The FlowXP till with GST and split payment', 'Trade price lists', 'Credit limits for garages', 'Holds for customers', 'Returns with a reason and what became of the part'] },
    { group: 'Control', items: ['Storekeeper and parts counter roles', 'A manager approves stock count differences', 'Activity log of stock and price changes', 'Several outlets under one login', 'Two-step login'] }
  ],
  notYet: [
    'A built-in vehicle or fitment database. You enter or import your own, and nothing is assumed to fit.',
    'Choosing a vehicle on the billing screen. Find parts for a vehicle is a separate screen; the till searches by name, SKU, barcode and any part number.',
    'Counting stock bin by bin. A count is for a part at an outlet; the shelf is corrected by the count.',
    'Moving stock between outlets with the bin chosen on both sides. The existing outlet transfer moves the stock; the receiving outlet puts it away.',
    'Stock ageing by batch layer. Ageing is by the last receipt.',
    'Serial numbers and warranty tracking for each unit.',
    'VIN lookup, job cards and labour. This is a parts shop, not a workshop system.',
    'Working offline for racks, receiving and counts. Billing keeps working offline; the rest needs a connection.'
  ],
  faq: [
    ['Does FlowXP know which parts fit which car?', 'No. It has no vehicle database. You record or import fitment, and every record is verified, not verified, or does not fit. A part with no record is shown as having no fitment on record.'],
    ['Can I scan an OEM number at the counter?', 'Yes. Any part number you have recorded, with or without dashes and spaces, finds the part in the catalogue and in the till search.'],
    ['How does the bin quantity stay right?', 'The stock total is kept by the same stock ledger every bill and receipt uses. Bins hold part of it, never more than the total, and anything left over shows as waiting for a bin. When stock leaves, it is taken from the shelves first.'],
    ['What counts as stock I can sell?', 'Only what was accepted on receipt. Damaged and rejected goods are recorded but are not sellable stock.'],
    ['Can a garage buy on credit?', 'Yes. Leave part of the bill to pay and it is credit. Set a limit and decide whether to warn or refuse the bill when it is passed.'],
    ['Does it handle GST?', 'Yes. Parts carry their own HSN and GST rate, credit notes reverse it exactly, and the GSTR-1 file and GSTR-3B figures are prepared for you to upload. Nothing is sent to the government for you.']
  ]
};
