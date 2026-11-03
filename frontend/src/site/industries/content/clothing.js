/* Clothing and fashion shops: a product with sizes and colours, every size and colour its own SKU, barcode and stock. Facts from CLOTHING_PLAN.md and the screens; screenshots are the real screens of the seeded demo shop (npm run seed:clothing). */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'clothing',
  label: 'Clothing / Fashion',
  short: 'Clothing',
  blurb: 'One shirt, five sizes, four colours: twenty things to count. FlowXP counts each one, and bills it by scan.',
  title: 'Every size and every colour, counted.',
  lead: 'For garment shops, boutiques, showrooms and footwear stores. Add a style once, pick its colours and sizes, and every combination gets its own SKU, its own barcode and its own stock. Scan the tag at the till and exactly that size and colour is billed, with the right GST, and leaves the shelf in the books.',
  hero: { src: p('clothing-grid'), alt: 'FlowXP style with stock by size and colour: each colour in a row, each size in a column, low stock in amber and sold out in red.' },
  heroPoints: ['Choose Clothing when you sign up and these tools switch on', 'Colours and sizes are picked from a list, not typed', 'Bring your items from Tally, Vyapar or Excel, one row per size and colour', 'Works on a counter PC, a tablet and an Android phone'],
  modules: [
    {
      id: 'styles', title: 'A style, its colours, its sizes',
      body: 'A style is what your customer calls the product: the cotton round-neck T-shirt, the slim jeans. You enter it once with its brand, fabric, fit, HSN, GST rate, MRP and selling price. The sizes and colours hang under it.',
      points: ['Pick a size set (letter sizes, waist in inches, kids by age, shoe sizes UK, free size) or add your own', 'Pick colours from the usual ones with their swatches, or type a new one', 'Brand, season, fabric, pattern and fit on every style', 'Men, women, boys, girls, kids or unisex', 'Add a new colour or size to a style later: only the missing combinations are made', 'Archive a style you have stopped selling; its bills and history stay'],
      shots: [{ src: p('clothing-new'), alt: 'FlowXP new style: sizes and colours picked from lists, with the number of variants that will be made.' }, { src: p('clothing-styles'), alt: 'FlowXP styles list with colours, price, number of variants, how many are sold out and stock.' }]
    },
    {
      id: 'variants', title: 'Each size and colour is a real item',
      body: 'A variant is not a note on a style. It is an item of its own: its own SKU, its own barcode, its own stock, its own price if it differs. That is why the till, returns, offers and the stock count all work per size and colour without any special mode.',
      points: ['SKU made for you from the style, colour and size, like ST00004-BLU-32', 'An in-store barcode (EAN-13) made for you, never reused by another variant or another shop', 'Price, reorder level and stock changed per variant', 'GST at the style’s rate on every variant'],
      shots: [{ src: p('clothing-skus'), alt: 'FlowXP SKUs and barcodes for a style: each size and colour with its SKU, barcode, price, reorder level and stock.' }]
    },
    {
      id: 'grid', title: 'See the whole style in one grid',
      body: 'Open a style and see stock as a table: colours down the side, sizes across the top. The gaps are obvious. The size that is gone, the size that is nearly gone, the colour that has plenty.',
      points: ['Low stock shown in amber, sold out in red, per size and colour', 'Totals for each colour and for the style', 'Search the list by name, style code, SKU or barcode: scan a tag and the style comes up', 'Filter by men, women, boys, girls, active or archived', 'How many variants of a style are sold out, on the list itself'],
      shots: [{ src: p('clothing-grid'), alt: 'FlowXP style with stock by size and colour: each colour in a row, each size in a column, low stock in amber and sold out in red.' }]
    },
    {
      id: 'till', title: 'Scan the tag, bill the size',
      body: 'Scan the barcode on the tag. That size and colour is added to the bill with its price and its GST, and only that variant leaves stock. Returns and credit notes put it back into the same size and colour.',
      points: ['Barcode billing on the FlowXP till, with split payment and GST invoices', 'Credit notes for returns, with the option to put the piece back on the shelf or write it off as damaged', 'Offers and discounts work on the item as on any shop item', 'Stock moves between outlets per variant using the stock transfer you already have'],
      shots: []
    },
    {
      id: 'setup', title: 'Easy to start, safe to keep',
      body: 'You do not type your stock in again. Put your catalogue in a file, one row for each size and colour, and import it. Rows with the same style name become one style. Everything is checked first and nothing is saved if a row is wrong.',
      points: ['Import from CSV or Excel; a sample file to download', 'A trial run that shows what will be made before it is saved', 'One click adds the usual clothing categories with their subcategories: men’s wear, women’s wear, kids’ wear, ethnic wear, innerwear, footwear and accessories', 'Opening stock counted in as you create a style', 'Download a backup of all your records at any time'],
      shots: []
    }
  ],
  included: [
    { group: 'Styles', items: ['Brand, season, fabric, pattern, fit', 'Men, women, boys, girls, kids, unisex', 'HSN and GST rate', 'MRP and selling price', 'Archive a style'] },
    { group: 'Sizes and colours', items: ['Letter, waist, kids, shoe and free sizes', 'Your own size sets', 'Colours with swatches', 'Add a colour or size later', 'Only missing variants are made'] },
    { group: 'Variants', items: ['SKU made for you', 'In-store barcode made for you', 'Price and reorder level per variant', 'Stock per variant and outlet'] },
    { group: 'Selling', items: ['The FlowXP till: scan, bill, split payment', 'GST invoices', 'Returns and credit notes by size and colour', 'Offers and discounts', 'WhatsApp bill to the customer'] },
    { group: 'Stock', items: ['Stock grid by size and colour', 'Low stock and sold out flagged', 'Stock center and counts', 'Transfers between outlets', 'Opening stock on creation'] },
    { group: 'Start and keep', items: ['Import from CSV or Excel', 'Trial run before saving', 'Sample file', 'Download a backup', 'A Help me find button on every screen'] },
    { group: 'Control', items: ['Owner, manager and cashier roles', 'Only people with permission change the catalogue', 'Each shop sees only its own data', 'Activity log of stock and price changes', 'Two-step login'] }
  ],
  notYet: [
    'Printing price tags and barcode labels for each size and colour. The barcodes are made and scan at the till; the label printing is not built yet.',
    'Picking the size and colour on the billing screen from a grid. The till finds a variant by scan, name, SKU or barcode today.',
    'Exchanging one size or colour for another in one step. A return and a new bill do it today.',
    'Entering a purchase as a size and colour grid, a supplier ledger by style, and size or colour preferences for each customer.',
    'Reports for best-selling sizes and colours, stock ageing and dead stock by style.',
    'Importing old bills and ledgers from Tally or other tools. Items and stock come across; past bills stay in the old tool.'
  ],
  faq: [
    ['Do I enter every size and colour one by one?', 'No. Add the style, pick the colours and sizes, and every combination is made at once with its SKU and barcode. A style with 4 colours and 5 sizes makes 20 variants in one go.'],
    ['Can I bring my items from Tally or Vyapar?', 'Yes. Put them in a file with one row for each size and colour and import it. A trial run shows what will be made before anything is saved, and a wrong row stops the whole import so you never end up half done. Old bills and ledgers do not come across.'],
    ['How does a return work?', 'Raise a credit note against the bill. Choose whether the piece goes back to stock (it returns to that exact size and colour) or is written off as damaged. GST is reversed exactly.'],
    ['Can I add a new size or colour after I have started selling?', 'Yes. Open the style and choose Add colours or sizes. Only combinations the style does not have yet are made. What you have sold is untouched.'],
    ['Does it work with several shops?', 'Yes. Stock is held per outlet. Move stock between outlets with the stock transfer. Each variant is counted at the outlet it is in.'],
    ['Does it handle GST?', 'Yes. Every style has its HSN and GST rate, credit notes reverse it exactly, and the GSTR-1 file and GSTR-3B figures are prepared for you to upload. Nothing is sent to the government for you.'],
    ['What if I lose my data or set up wrongly?', 'Download a backup file. If you ever need it, restore adds back only what is missing and never changes what you have.']
  ]
};
