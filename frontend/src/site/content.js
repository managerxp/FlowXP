/*
 * Marketing copy as data.
 *
 * Nine of the ten public pages are the same shape — a heading, a lead, some
 * sections of feature cards. Written as ten page components they would be ten
 * files of near-identical JSX that drift apart the first time someone edits
 * one. Written as data they share one renderer (MarketingPage.jsx), and
 * changing the copy never means touching a component.
 *
 * Home is the exception and is hand-built: it has a hero, pricing and an FAQ
 * that no other page has.
 */

export const CORE_FEATURES = [
  {
    title: 'Smart billing',
    body: 'Scan or search, add to cart, take payment, done. Built for a counter with a queue at it — keyboard-first on a desktop, thumb-first on a phone.'
  },
  {
    title: 'Payments',
    body: 'Cash, UPI, card, bank transfer, credit or split across several. Every payment lands against the invoice and the customer’s balance at once.'
  },
  {
    title: 'Inventory',
    body: 'Stock moves when you bill and when you purchase, without a second entry. Low-stock alerts before you run out, not after.'
  },
  {
    title: 'GST',
    body: 'CGST, SGST and IGST worked out per line from the HSN code. Tax summaries and returns-ready reports come out of the same data you billed from.'
  },
  {
    title: 'Reports',
    body: 'Sales, purchases, expenses, outstanding, inventory and GST — filtered to any date range, exportable, and honest about what is in them.'
  },
  {
    title: 'Flow AI',
    body: 'Ask in plain English: "how much did I sell today?", "who owes me money?", "what should I reorder?" Answers come from your data, not a guess.'
  }
];

export const INDUSTRIES = [
  { name: 'Restaurants',   body: 'Table and counter orders, kitchen-side speed, split bills.' },
  { name: 'Cafés',         body: 'Quick repeat orders and a queue that keeps moving.' },
  { name: 'Retail',        body: 'Barcode billing, variants, and stock that stays honest.' },
  { name: 'Supermarkets',  body: 'High line counts, fast scanning, multiple counters.' },
  { name: 'Pharmacies',    body: 'Batch and expiry awareness alongside GST billing.' },
  { name: 'Salons',        body: 'Services and products on one bill, with regulars remembered.' },
  { name: 'Services',      body: 'Quote, invoice, and chase what is outstanding.' },
  { name: 'Electronics',   body: 'Serial numbers, warranties and higher-value invoices.' },
  { name: 'Clothing',      body: 'Size and colour variants without a spreadsheet.' },
  { name: 'Gaming cafés',  body: 'Sessions, snacks and memberships billed together.' },
  { name: 'Racing',        body: 'Slots, packages and walk-ins on one counter.' },
  { name: 'Wholesale',     body: 'Bulk pricing, credit terms and supplier payables.' }
];

/*
 * The interactive industry selector's data: which modules FlowXP surfaces
 * first for each kind of business. Not every module a business has — the
 * handful that make it obviously fit that business the moment you look.
 */
export const INDUSTRY_MODULES = [
  { name: 'Restaurant',   modules: ['Tables', 'Orders', 'Menu', 'Billing', 'Payments'] },
  { name: 'Café',         modules: ['Quick orders', 'Menu', 'Billing', 'Loyalty', 'Payments'] },
  { name: 'Retail',       modules: ['Products', 'Barcode', 'Inventory', 'Billing', 'Customers'] },
  { name: 'Supermarket',  modules: ['Barcode', 'Multi-counter', 'Inventory', 'Billing', 'Reports'] },
  { name: 'Pharmacy',     modules: ['Products', 'Batch', 'Expiry', 'GST', 'Inventory'] },
  { name: 'Salon',        modules: ['Services', 'Products', 'Billing', 'Customers', 'Payments'] },
  { name: 'Services',     modules: ['Quotes', 'Invoices', 'Customers', 'Outstanding', 'Reports'] },
  { name: 'Electronics',  modules: ['Products', 'Serial numbers', 'Warranty', 'Billing', 'Inventory'] },
  { name: 'Clothing',     modules: ['Variants', 'Barcode', 'Inventory', 'Billing', 'Customers'] },
  { name: 'Gaming café',  modules: ['Sessions', 'PCs', 'Games', 'Billing', 'Memberships'] },
  { name: 'Racing',       modules: ['Slots', 'Packages', 'Billing', 'Customers', 'Reports'] },
  { name: 'Wholesale',    modules: ['Bulk pricing', 'Credit terms', 'Purchases', 'Suppliers', 'GST'] },
  { name: 'Distributor',  modules: ['Purchases', 'Suppliers', 'Inventory', 'GST', 'Reports'] }
];

export const DIFFERENTIATORS = [
  {
    title: 'No hardware required',
    body: 'FlowXP runs in a browser on the laptop, tablet or phone you already own. A printer, scanner and cash drawer are things you can add later, not things you must buy first.'
  },
  {
    title: 'Multi-business, multi-branch',
    body: 'One login for every business you run and every location it trades from. Switch between them, or look at all of them together — the data never mixes.'
  },
  {
    title: 'Built to stay yours',
    body: 'Every business is isolated at the database level, not by a filter someone might forget. Role-based access, audit logs on the things that matter, and your data stays yours after the trial ends.'
  }
];

export const FAQ = [
  {
    q: 'Do I need a credit card to start?',
    a: 'No. The seven-day trial starts as soon as you sign up, with no card and no sales call.'
  },
  {
    q: 'What happens when the trial ends?',
    a: 'Billing pauses and everything you created stays exactly where it is. You keep read access to your invoices, products and reports, and you pick up where you left off when you upgrade. Nothing is deleted.'
  },
  {
    q: 'Do I need a printer or a billing machine?',
    a: 'No. FlowXP is digital-first — send an invoice over WhatsApp, email or a link. If you already own a printer you can still use it.'
  },
  {
    q: 'Can I use it on my phone?',
    a: 'Yes. The whole product works in a mobile browser and installs to your home screen. A dedicated mobile app is on the roadmap.'
  },
  {
    q: 'Is my data separate from other businesses?',
    a: 'Yes. Every record carries the business it belongs to, and every request is checked against what your account is actually a member of before anything is read.'
  },
  {
    q: 'Can I run more than one business?',
    a: 'Yes. Add as many as you need under one login and switch between them. Each keeps its own products, customers, invoices and reports.'
  },
  {
    q: 'What does Flow AI actually see?',
    a: 'Only the business you are signed in to. It answers from your own sales, stock and payment records — it cannot see another business, and it does not invent figures.'
  }
];

/* ── The pages driven by MarketingPage.jsx ─────────────────────────────── */

export const PAGES = {
  features: {
    title: 'Everything you need to run the counter',
    lead: 'FlowXP covers the whole loop — bill it, take the money, move the stock, file the tax, and see what it all added up to.',
    sections: [
      { heading: 'Core', items: CORE_FEATURES },
      {
        heading: 'And the rest of the day',
        items: [
          { title: 'Purchases', body: 'Record what you bought, from whom, at what cost — stock and payables update themselves.' },
          { title: 'Customers', body: 'Contact details, purchase history, outstanding balance and what they usually buy.' },
          { title: 'Suppliers', body: 'Who you owe, how much, and what you last paid them.' },
          { title: 'Expenses', body: 'Rent, salary, utilities, transport and the rest, so profit is a real number.' },
          { title: 'Roles', body: 'Owner, admin, manager, cashier, staff — each seeing only what they should.' },
          { title: 'Audit log', body: 'Who changed which invoice, and when. Available when you need it, invisible when you do not.' }
        ]
      }
    ]
  },

  industries: {
    title: 'Built for the business you actually run',
    lead: 'FlowXP adapts what it shows you to the kind of business you are. A pharmacy and a gaming café need different screens, not the same screen with unused buttons.',
    sections: [
      { heading: '', items: INDUSTRIES.map((i) => ({ title: i.name, body: i.body })) }
    ]
  },

  integrations: {
    title: 'Integrations',
    lead: 'FlowXP works on its own from day one. These are the connections you can add when you want them — none of them are required to start billing.',
    sections: [
      {
        heading: 'Available',
        items: [
          { title: 'WhatsApp, email & SMS', body: 'Send an invoice to a customer the moment you take payment.' },
          { title: 'UPI & online payments', body: 'Collect through the Indian payment provider you already use.' },
          { title: 'PDF & export', body: 'Every invoice and report downloads as a file you can send to your accountant.' }
        ]
      },
      {
        heading: 'Optional hardware',
        items: [
          { title: 'Thermal printers', body: 'For counters that want a paper receipt as well as a digital one.' },
          { title: 'Barcode scanners', body: 'Any USB scanner that types — no driver, no setup.' },
          { title: 'Cash drawers', body: 'Opens on cash payment, if you have one wired in.' }
        ]
      }
    ]
  },

  about: {
    title: 'About FlowXP',
    lead: 'FlowXP is a product of ManagerXP, built for the businesses we already spend our days with — the counters, kitchens, shops and cafés that need software to get out of the way.',
    sections: [
      {
        heading: 'What we are trying to do',
        items: [
          { title: 'Make the first bill fast', body: 'Signup to a real invoice in under five minutes, on hardware you already own. Everything else can wait until Thursday.' },
          { title: 'Be honest with numbers', body: 'A report that quietly rounds, or an assistant that invents a figure, is worse than no report at all. We would rather show you a blank than a guess.' },
          { title: 'Keep your data yours', body: 'It stays isolated, it stays exportable, and it stays there after your trial ends.' }
        ]
      }
    ]
  },

  contact: {
    title: 'Talk to us',
    lead: 'Questions about pricing, migrating from something else, or whether FlowXP fits how your business works — we would rather answer before you sign up than after.',
    sections: [
      {
        heading: '',
        items: [
          { title: 'Email', body: 'support@managerxp.com' },
          { title: 'Sales', body: 'For multi-branch and multi-business setups, ask for a walkthrough.' },
          { title: 'Support', body: 'Existing customers can raise a ticket from inside the app.' }
        ]
      }
    ]
  }
};
