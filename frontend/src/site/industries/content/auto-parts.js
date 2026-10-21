/* Auto spare parts shops: cars, bikes and scooters; a counter, a warehouse with racks, garages on credit. Facts from AUTO_PARTS.md and the screens; screenshots are the real screens of the seeded demo shop. */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'auto-parts',
  label: 'Automobile / Hardware',
  short: 'Auto parts',
  blurb: 'Find any part, know which shelf it is on, run your workshop, and bill it all in one place.',
  title: 'Find the part. Fix the vehicle. Bill it.',
  lead: 'For car, bike and scooter spare parts shops, hardware counters and workshops. Type any part number and the part comes up. See where it sits on the shelf. Open a job card when a bike or car comes in for servicing, add the parts and labour, and make the bill. Sell to garages on credit.',
  hero: { src: p('parts-catalogue'), alt: 'FlowXP parts catalogue with each part, its OEM and manufacturer number, type, price and stock.' },
  heroPoints: ['Choose Auto spare parts when you sign up and these tools switch on', 'Bring your items from Tally, Vyapar or Excel', 'Works on a counter PC, a tablet and a phone', '7-day free trial, no card'],
  modules: [
    {
      id: 'catalogue', title: 'Every part with every number it is known by',
      body: 'A part has its SKU and barcode, the OEM number, the manufacturer number and any alternates or old numbers. Type or scan any of them, with or without dashes and spaces, and the part comes up.',
      points: ['OEM, manufacturer, alternate, supplier and replaced-by numbers on one part', 'OEM, aftermarket, refurbished and used kept apart', 'Car, bike, scooter, truck and bus parts', 'Reorder level, maximum stock and preferred supplier', 'Parts that look like the same part twice are listed for you to check; nothing is merged for you', 'The same product, price, GST and stock as the rest of FlowXP, so billing and reports need nothing extra'],
      shots: [{ src: p('parts-catalogue'), alt: 'FlowXP parts catalogue with each part, its OEM and manufacturer number, type, price and stock.' }, { src: p('parts-detail'), alt: 'FlowXP part with its vehicles: each with fitment shown as verified or not verified.' }]
    },
    {
      id: 'workshop', title: 'Servicing: job cards for bikes and cars',
      body: 'When a vehicle comes in for service, open a job card with its number and what the owner complained about. Add the spare parts used and the labour, and the card becomes the bill when the work is done.',
      points: ['One card per vehicle visit, with the registration number, the owner and the odometer reading', 'Parts are held for the job, so one on a job cannot be sold to someone else, and they leave stock when the job is billed', 'Labour from your own list of services (oil change, alignment) in one tap, with GST like any other charge', 'Status from open to in progress, waiting for parts, ready and billed; a cancelled job gives the parts back', 'See which vehicles are waiting, which are ready for pick-up and which services are due again', 'Tell the customer on WhatsApp when you receive the vehicle, with the estimate, when it is ready and with the bill', 'See what the workshop earned, labour and parts, by day and by mechanic; every job bill is also in your sales', 'Staff attendance, shifts and monthly payroll for your mechanics and counter staff, in the same place', 'Mechanic mode: switch it on in Settings only if you service vehicles; a parts-only shop does not see these screens'],
      shots: []
    },
    {
      id: 'fitment', title: 'Fitment that is never assumed',
      body: 'You build your own list of makes, models and variants, and record which parts fit which vehicle. A part with no record is never presented as fitting.',
      points: ['Makes, models and variants with years, engine and fuel, typed in or imported from a file', 'Each fitment is verified, not verified, or does not fit', 'New fitment is not verified until a person verifies it', 'Find parts for a vehicle: only parts with a record, each labelled', 'Parts recorded as not fitting are left out and counted', 'Alternates are suggested only from verified fitment', 'One click adds the usual Indian bikes, scooters and cars by company (names only). FlowXP never ships fitment: that is what your shop records or imports'],
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
    },
    {
      id: 'setup', title: 'Easy to start, safe to keep',
      body: 'You do not type your stock in again. Export your item list from Tally, Vyapar, Busy, Marg, Zoho or Excel and import the file. The usual column names are recognised, and every row is checked before anything is saved.',
      points: ['Import products and opening stock from CSV or Excel, and update prices later the same way', 'Import your customers and garages from a file too', 'A step-by-step first-day guide on the website, nine small steps', 'Download a backup of all your records whenever you like', 'Restore a backup: it adds only what is missing and never changes or removes what you already have', 'Preview the restore first; nothing changes until you confirm'],
      shots: []
    },
  ],
  included: [
    { group: 'Catalogue', items: ['OEM and any part numbers', 'Search with or without dashes', 'OEM, aftermarket, refurbished, used', 'Reorder level and maximum stock', 'Duplicate part check'] },
    { group: 'Vehicles', items: ['Makes, models and variants of your own', 'Import from a file', 'Verified, not verified and does not fit', 'Find parts for a vehicle', 'Alternates from verified fitment only'] },
    { group: 'Warehouse', items: ['Warehouse to bin, your own names', 'QR and barcode labels', 'Put away and bin to bin moves', 'Pick bin and bin limits', 'Shelf quantity always agrees with stock'] },
    { group: 'Receiving', items: ['Accepted, damaged, rejected', 'Put away on receipt', 'No duplicate supplier invoice', 'Cancel a receipt', 'Supplier claims'] },
    { group: 'Selling', items: ['The FlowXP till with GST and split payment', 'Trade price lists', 'Credit limits for garages', 'Holds for customers', 'Returns with a reason and what became of the part'] },
    { group: 'Workshop', items: ['Job cards for each vehicle', 'Spare parts and labour on one bill', 'Services due again', 'Mechanic attendance and shifts', 'Monthly payroll'] },
    { group: 'Start and keep', items: ['Import from Tally, Vyapar, Busy, Marg, Zoho, Excel', 'Checked before saved', 'Download a backup', 'Restore only what is missing'] },
    { group: 'Control', items: ['Storekeeper and parts counter roles', 'A manager approves stock count differences', 'Activity log of stock and price changes', 'Several outlets under one login', 'Two-step login'] }
  ],
  notYet: [
    'A built-in fitment database. The usual Indian makes and models can be added with one click, but which part fits which vehicle is what you record or import, and nothing is assumed to fit.',
    'Choosing a vehicle on the billing screen. Find parts for a vehicle is a separate screen; the till searches by name, SKU, barcode and any part number.',
    'Counting stock bin by bin. A count is for a part at an outlet; the shelf is corrected by the count.',
    'Moving stock between outlets with the bin chosen on both sides. The existing outlet transfer moves the stock; the receiving outlet puts it away.',
    'Stock ageing by batch layer. Ageing is by the last receipt.',
    'Serial numbers and warranty tracking for each unit.',
    'VIN lookup, or a service history by chassis number. A job card holds the registration number you type.',
    'Importing old bills and ledgers from Tally or other tools. Items and stock come across; past bills stay in the old tool.',
    'Working offline for racks, receiving and counts. Billing keeps working offline; the rest needs a connection.'
  ],
  faq: [
    ['Can I bring my items from Tally or Vyapar?', 'Yes. Export your item list to Excel or CSV and import it. Names, codes, prices, GST, HSN and stock are recognised. Old bills and ledgers do not come across. The setup guide has the steps.'],
    ['Can I run my servicing on FlowXP?', 'Yes. Open a job card for each vehicle, add parts and labour, and turn it into a bill. Parts are held for the job and leave stock when it is billed. Mechanic attendance and payroll are included.'],
    ['What if I lose my data or set up wrongly?', 'Download a backup file. If you ever need it, restore adds back only what is missing and never changes what you have.'],
    ['Does FlowXP know which parts fit which car?', 'It can list the usual Indian bikes, scooters and cars by company with one click, but it does not know fitment. You record or import which part fits which vehicle, and every record is verified, not verified, or does not fit. A part with no record is shown as having no fitment on record.'],
    ['Can I scan an OEM number at the counter?', 'Yes. Any part number you have recorded, with or without dashes and spaces, finds the part in the catalogue and in the till search.'],
    ['How does the bin quantity stay right?', 'The stock total is kept by the same stock ledger every bill and receipt uses. Bins hold part of it, never more than the total, and anything left over shows as waiting for a bin. When stock leaves, it is taken from the shelves first.'],
    ['What counts as stock I can sell?', 'Only what was accepted on receipt. Damaged and rejected goods are recorded but are not sellable stock.'],
    ['Can a garage buy on credit?', 'Yes. Leave part of the bill to pay and it is credit. Set a limit and decide whether to warn or refuse the bill when it is passed.'],
    ['Does it handle GST?', 'Yes. Parts carry their own HSN and GST rate, credit notes reverse it exactly, and the GSTR-1 file and GSTR-3B figures are prepared for you to upload. Nothing is sent to the government for you.']
  ]
};
