/* Mechanic garages (bike, scooter, car): the job card is the heart. Facts from the app's own screens and BRAIN notes; screenshots are the real screens of the seeded demo garage (npm run seed:mechanic). */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'mechanic',
  label: 'Mechanic / Garage',
  short: 'Garage',
  blurb: 'A vehicle comes in, you fix it, you bill it, it goes out. One job card carries it all, in plain words.',
  title: 'Every vehicle in your garage, on one card.',
  lead: 'For bike, scooter and car garages. Open a job card when the vehicle arrives, note what is wrong, add the labour and the parts, tell the customer on WhatsApp, and make the bill when the work is done. No stock sheets, no accounting words, and the screen is the same on a counter PC and on a phone.',
  hero: { src: p('mechanic-home'), alt: 'FlowXP garage home: vehicles received today, work in progress, ready for delivery, today\'s collection, expenses and cash in hand, and the vehicles in the garage now.' },
  heroPoints: ['Choose Mechanic garage when you sign up, then say bikes, cars or both', 'Pick the company and model from a list of Indian bikes and cars, or just type it', 'Works on a counter PC, a tablet and an Android phone', 'Money in and money out in plain words'],
  modules: [
    {
      id: 'home', title: 'Open the app, see the day',
      body: 'The first screen is not a report. It is the garage right now: how many vehicles came in today, how many are being worked on, how many are ready for the customer, what was collected, what was spent and how much cash is in hand.',
      points: ['Big numbers and the list of vehicles in the garage, ready ones first', 'New job card, Add customer, Buy spare parts, Money In and Money Out, each one tap away', 'What customers still owe, with a tap to see who', 'The menu is short: job cards, customers, parts, money, bills, reports and staff'],
      shots: [{ src: p('mechanic-home'), alt: 'FlowXP garage home with the day in big numbers and the vehicles in the garage.' }]
    },
    {
      id: 'vehicle', title: 'Pick the vehicle, do not type it',
      body: 'Start a job card by choosing the customer and typing the registration number. Tap Company and the list opens, filtered to what your garage repairs: bikes and scooters, cars, or both. Type two letters and it narrows down. Pick the company and its models are listed, old and discontinued ones too, because a 2008 car still comes in.',
      points: ['A built-in list of Indian bikes, scooters and cars, current and discontinued', 'A bike garage sees only bikes, a car garage only cars', 'Not on the list? Type it. The garage remembers it for next time', 'The same customer can have several vehicles, and every earlier job of a vehicle is one tap away'],
      shots: [{ src: p('mechanic-new'), alt: 'FlowXP new job card: typing ma in Company shows Maruti Suzuki, Mahindra, Maserati and Aston Martin to tap.' }]
    },
    {
      id: 'jobcard', title: 'The job card, from arrival to delivery',
      body: 'One card follows the vehicle: Waiting, Checking, Being worked on, Waiting for parts, Ready, Billed, then handed over. The mechanic taps the next step. The card keeps the complaint, the fuel in the tank, the things left in the vehicle, the mechanic, the date promised and the date the next service is due.',
      points: ['Note the fuel in the tank and what the customer left in the vehicle when it arrives', 'Add labour from your own list with one tap, or type a charge and remember it', 'Add a spare part by name, code or part number; the part is held for this customer', 'Record that the customer said yes to the estimate, and how', 'Hand over the vehicle once it is billed'],
      shots: [{ src: p('mechanic-jobcard'), alt: 'FlowXP job card with the status steps, fuel and belongings, estimate approved, labour lines and the estimate total.' }]
    },
    {
      id: 'whatsapp', title: 'Tell the customer, from the card',
      body: 'Three buttons on the job card message the customer on WhatsApp: we have your vehicle, here is the estimate, it is ready. They can also go out by themselves as the card moves. A few days before the next service is due, the customer is reminded.',
      points: ['Uses your own messaging channel on a plan with messaging', 'If the channel is off, WhatsApp opens with the words already written', 'The bill can be sent the same way'],
      shots: []
    },
    {
      id: 'money', title: 'Money in, money out',
      body: 'Two buttons and two lists. Money In is what customers paid and any other money received. Money Out is what the garage spent: tea and food, spare parts bought, tools, rent, electricity, salary. Pick the reason from a list, type the amount, choose cash, UPI, card or bank. Done.',
      points: ['Today, the last 7 days or this month', 'What is left over, and how much of it is cash', 'Customer payments from bills show up by themselves; nothing is entered twice', 'Entries flow to your reports and to FlowBook'],
      shots: [{ src: p('mechanic-money'), alt: 'FlowXP Money In and Out: customer payments and other money in on one side, spending on the other, with what is left over.' }]
    },
    {
      id: 'bill', title: 'Bill, GST, and what you earned',
      body: 'When the work is done, make the bill from the card: labour and parts on one GST invoice, the customer pays cash, UPI, card or later. Reports shows what the garage earned and the labour and parts split, and every table downloads as a CSV file that opens in Excel.',
      points: ['One invoice from the job card, with GST and the correct labour code', 'Part payment and pay-later with a list of who owes', 'What we earned, labour against parts', 'Staff and mechanics with roster and attendance'],
      shots: []
    }
  ],
  included: [
    { group: 'Start', items: ['Choose bikes, cars or both', 'A list of Indian bikes and cars', 'Customers with several vehicles'] },
    { group: 'Job card', items: ['Waiting, Checking, Working, Waiting for parts, Ready, Billed', 'Complaint, fuel, things left in the vehicle', 'Estimate with the customer\'s yes on record', 'Promised date and next service date', 'Mechanic on each job'] },
    { group: 'Labour and parts', items: ['Your own list of services and prices', 'Spare parts by name, code or part number', 'Parts held for the customer', 'Fitment you record for a vehicle'] },
    { group: 'Customer', items: ['WhatsApp: received, estimate, ready', 'Next service reminder', 'Bill on WhatsApp', 'Every earlier job of a vehicle'] },
    { group: 'Money', items: ['Money In and Money Out', 'Cash, UPI, card, bank', 'Customer dues', 'GST invoices'] },
    { group: 'Business', items: ['Revenue reports, downloadable as CSV', 'Mechanics and staff', 'Owner, manager and counter roles', 'Each garage sees only its own data', 'Two-step login'] }
  ],
  notYet: [
    'Photos of the vehicle when it arrives. Write the damage in the notes for now.',
    'Closing the day with a cash count. The home shows cash in hand for today.',
    'Buying parts on credit and tracking what you owe each supplier from the garage screens.',
    'A true Excel (.xlsx) download. Tables download as CSV, which Excel opens.'
  ],
  faq: [
    ['Is this a different product from the spare parts shop?', 'It is its own choice at signup, with its own short menu. A spare parts shop and a garage can both use the same job card, but a garage sees only what a garage needs.'],
    ['Do I have to type the car or bike every time?', 'No. Tap Company, pick it from the list, and tap the model. If a vehicle is not on the list, type it once and it is remembered.'],
    ['Can one customer have a bike and a car?', 'Yes. A customer can have any number of vehicles, and each vehicle keeps its own history of jobs.'],
    ['Will customers get WhatsApp messages by themselves?', 'On a plan with messaging, yes: when the vehicle is received, when it is ready, and before the next service is due. You can also press a button on the card to send one yourself.'],
    ['How do I see what I earned?', 'Open Reports for revenue and the usual tables, or the What we earned tab on the job cards for labour against parts. Every table downloads as CSV.'],
    ['Does it handle GST?', 'Yes. Labour and parts go on one GST invoice. The GST register and return figures are prepared for your accountant. Nothing is sent to the government for you.'],
    ['Does it work on a phone?', 'Yes. The mechanic can open the job card, change its step and add labour from an Android phone.']
  ]
};
