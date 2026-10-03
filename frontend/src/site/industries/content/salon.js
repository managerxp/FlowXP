/* Salons and spas: facts from SALON.md and the screens; screenshots are the real screens of the seeded demo salon. */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'salon',
  label: 'Salons',
  short: 'Salons',
  blurb: 'Appointments, billing, memberships and commission, with services and products on one bill.',
  title: 'Book the chair. Bill the visit. Remember the client.',
  lead: 'For salons, barbershops and spas. Appointments by stylist, services and products on one GST bill, memberships and packages, commission worked out for you, and the stock behind the chair.',
  hero: { src: p('salon-appointments'), alt: 'FlowXP salon appointment book for the day with a column for each stylist and a line showing the time now.' },
  heroPoints: ['Choose Salon when you sign up and these tools switch on', 'Works on a front-desk PC, a tablet and a phone', '7-day free trial, no card'],
  modules: [
    {
      id: 'appointments', title: 'An appointment book nobody can double-book',
      body: 'See the day as a column for each stylist, with every booking at its time. Book, move, check in and bill from the same screen.',
      points: ['Day view by person, a week view and a list', 'Book a client for one or more services, each with its own stylist', 'Walk-ins in two taps', 'Nobody can be booked twice at the same time, and a move is checked like a new booking', 'Booked, confirmed, checked in, in service, completed, cancelled and no-show', 'Working hours for the salon and for each person, and days they are on leave', 'A cancellation and no-show policy you write once', 'A stylist’s login shows only their own appointments, with no prices'],
      shots: [{ src: p('salon-appointments'), alt: 'FlowXP salon appointment book for the day with a column for each stylist and a line showing the time now.' }, { src: p('salon-week'), alt: 'FlowXP salon week view with each day’s bookings, the client, the service and the stylist.' }]
    },
    {
      id: 'billing', title: 'One bill for services and products',
      body: 'Ring up the services the client had and the products they bought on one GST invoice, with each line credited to the stylist who did it.',
      points: ['Search services and products, or tap them', 'A stylist on every line, for commission', 'The client’s membership discount and package balance applied for you', 'Offers applied automatically, or by code', 'Gift cards and loyalty points as payment', 'Split payment between cash, UPI, card and bank', 'Pay later, with the balance on the client', 'Shortcuts: / to search, F2 for the client, F9 to take payment', 'A bill taken without the internet is sent when it returns'],
      shots: [{ src: p('salon-pos'), alt: 'FlowXP salon billing with two services on the bill, the client and their membership discount applied, and a total ready to charge.' }]
    },
    {
      id: 'clients', title: 'Every client’s history, one tap away',
      body: 'Visits, spend, what they bought, what they prefer and what they owe, so the person at the desk already knows them.',
      points: ['Visits, last visit, total spent and points for every client', 'A timeline of visits and bills, and notes and preferences', 'Memberships and packages shown on the client', 'Labels such as VIP, high spender, frequent visitor, member, new and returning', 'Lists of clients who have not been back in 30, 60 or 90 days', 'Find a client by name or mobile'],
      shots: [{ src: p('salon-clients'), alt: 'FlowXP salon clients with visits, last visit, amount spent, points and labels such as VIP and Member.' }]
    },
    {
      id: 'services', title: 'Services, with what they cost you to give',
      body: 'Price every service, set how long it takes, and say what it uses up. The margin on each service is worked out for you.',
      points: ['Categories such as Hair, Skin, Nails and Spa', 'Price, GST and duration for each service', 'The materials a service uses, like colour or facial cream, taken off stock when it is billed', 'Margin on each service after those materials', 'Retail products and consumables kept separate', 'Archive a service without losing its history'],
      shots: [{ src: p('salon-services'), alt: 'FlowXP salon services with category, price, GST, time, materials and margin for each.' }]
    },
    {
      id: 'memberships', title: 'Memberships, packages, gift cards and offers',
      body: 'Sell a membership, a prepaid package or a gift card at the till, and FlowXP keeps the balance and applies it on the next visit.',
      points: ['Membership plans with a price, a term and a discount or free services', 'Packages such as five facials, with each visit counted off', 'Gift cards with a balance', 'Offers: a percentage or amount off, automatic or by code, for first visits, birthdays or chosen services', 'Who is a member, until when, and what they have used', 'Renewing while still a member starts the new term the day after the old one ends'],
      shots: [{ src: p('salon-memberships'), alt: 'FlowXP membership plans with price, term, discount and number of active members.' }, { src: p('salon-packages'), alt: 'FlowXP packages such as Facial Care x5 with price, validity and the client’s saving.' }, { src: p('salon-offers'), alt: 'FlowXP offers with what each does, its code, how often it has been used and whether it is on.' }]
    },
    {
      id: 'team', title: 'Team, attendance and commission',
      body: 'Commission is worked out on every bill as it is made, so at month end it is a list to approve and pay, not a calculation.',
      points: ['Each person’s role, commission rate for services and for products, and whether they can be booked', 'A different rate for one service, if you want it', 'Attendance for each day', 'Commission waiting for approval, approved, and paid', 'Approve and pay in one step, with a record of each payout', 'A commission that follows a bill if it is cancelled or credited, and a history that is never rewritten'],
      shots: [{ src: p('salon-team'), alt: 'FlowXP salon team with each person’s role, commission rate and whether they can be booked.' }, { src: p('salon-commission'), alt: 'FlowXP commission with services done, sales, pending and approved amounts for each stylist and an Approve button.' }]
    },
    {
      id: 'stock', title: 'Stock and alerts for what is behind the chair',
      body: 'Know what is running low, what is about to expire and what is being used faster than it should.',
      points: ['Low and out-of-stock alerts for retail products and consumables', 'Batches with an expiry date, and what is expiring soon', 'Items using more than usual, compared with their normal rate', 'Negative stock flagged so the count gets checked', 'Services take their materials off stock as they are billed', 'Add stock with batch and expiry, count, adjust or log wastage'],
      shots: [{ src: p('salon-stock'), alt: 'FlowXP stock and alerts with low and out-of-stock items, expiring soon, negative stock and unusual use.' }, { src: p('salon-batches'), alt: 'FlowXP batches and expiry with each item’s batch, quantity left, expiry date and when it was received.' }]
    },
    {
      id: 'online', title: 'Online booking on your own page',
      body: 'Clients book themselves on a page with your salon’s name, and the booking lands in the appointment book.',
      points: ['A page at your own address, with your hours, services and a notice you write', 'Clients pick services, a stylist or any stylist, and a time that is really free', 'No double-booking, and a limit on upcoming bookings for each mobile number', 'Opening hours, how much notice you need, how far ahead, and a gap between clients, all set by you', 'You can switch it off whenever you like'],
      shots: [{ src: p('salon-booking'), alt: 'The salon’s online booking page on a phone, with services to choose, their duration and price.', phone: true }, { src: p('salon-settings'), alt: 'FlowXP salon settings for opening hours, slot length and booking rules.' }]
    },
    {
      id: 'reports', title: 'Reports, and clients who come back',
      body: 'How the salon is doing: sales, clients, team, stock and money, for any dates you choose.',
      points: ['Daily and monthly sales, and sales by service, product, package and membership', 'New and returning clients, retention, lifetime value and top clients', 'Staff performance: services, sales and days present', 'Stock valuation, stock movement, materials used against the recipe, and wastage', 'Every report exports to CSV', 'Loyalty points you set the rules for', 'Reminders and offers to a chosen group of clients by WhatsApp or SMS, once messaging is connected'],
      shots: [{ src: p('salon-reports'), alt: 'FlowXP salon staff performance report with services, service sales, product sales, plans sold and bills for each stylist.' }, { src: p('salon-dashboard'), alt: 'FlowXP salon dashboard with sales today, appointments, team in, revenue chart and the next appointments.' }]
    }
  ],
  included: [
    { group: 'Appointments', items: ['Day, week and list views', 'Several services and stylists in one booking', 'Walk-ins', 'No double-booking', 'Check in, in service, completed, no-show', 'Working hours and leave', 'Cancellation and no-show policy', 'Online booking page'] },
    { group: 'Billing', items: ['Services and products on one GST bill', 'Stylist on every line', 'Membership and package use at the till', 'Gift cards and loyalty points', 'Offers by code or automatic', 'Split and pay-later payments', 'Keyboard shortcuts', 'Offline bills'] },
    { group: 'Clients', items: ['Visit history and timeline', 'Notes and preferences', 'Labels and segments', 'Clients not seen in 30, 60, 90 days', 'Memberships and packages on the client', 'Loyalty points'] },
    { group: 'Menu of services', items: ['Categories', 'Duration and GST', 'Materials used per service', 'Margin per service', 'Retail products and consumables'] },
    { group: 'Memberships and offers', items: ['Membership plans', 'Packages', 'Gift cards', 'Offers and codes', 'First-visit and birthday offers', 'Renewals'] },
    { group: 'Team', items: ['Roles and bookable staff', 'Commission for services and products', 'Per-service rates', 'Attendance', 'Approve and pay commission', 'Payout history', 'Receptionist, stylist and accountant roles'] },
    { group: 'Stock', items: ['Retail stock and consumables', 'Batches and expiry', 'Low-stock and unusual-use alerts', 'Materials taken off per service', 'Counts, adjustments and wastage'] },
    { group: 'Reports and tax', items: ['Sales, client, team and stock reports', 'CSV export', 'GST invoices and credit notes', 'GSTR-1 file, GSTR-3B figures', 'Several outlets under one login', 'Activity log', 'Two-step login'] }
  ],
  notYet: [
    'Clients cancelling or moving an online booking themselves. They call the salon to change one, and there is no OTP step on the booking page yet.',
    'A PDF receipt made by FlowXP. Bills and receipts print through the browser, and you can save them as a PDF from the print window.',
    'A membership’s free-service allowance counted by the month. It is counted for the whole term.',
    'Working with no connection for everything. Billing keeps working offline, but client search, appointments and reports need a connection.'
  ],
  faq: [
    ['Can a stylist have their own login?', 'Yes. A stylist linked to a team member sees only their own appointments, and never sees prices, takings or commission.'],
    ['How is commission calculated?', 'On every bill, from the rate you set for each person, with a different rate for one service if you want it. At the end of the period you approve the amounts and pay them, and each payout is recorded.'],
    ['Can clients book online?', 'Yes. Switch on online booking, choose an address, and clients book on a page with your salon’s name. Every booking lands in the appointment book, and nobody can be booked twice.'],
    ['Do products and services go on one bill?', 'Yes. One GST invoice can have services, retail products, a membership, a package or a gift card, each credited to the right person.'],
    ['Does it handle GST?', 'Yes. Bills carry GST, credit notes reverse it exactly, and the GSTR-1 file and GSTR-3B figures are prepared for you to upload. Nothing is sent to the government for you.']
  ]
};
