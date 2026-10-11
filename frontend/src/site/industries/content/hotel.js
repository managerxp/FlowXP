/* Hotels with a restaurant: the front office, housekeeping, folio and night audit, banquet and events, staff and payroll, and the reports a hotel is run from. Every point names
   something with a screen in the app; the screenshots are the real screens of the demo hotel (npm run seed:hotel in backend). The reports follow the standard hotel report set;
   they are not IDS Next's own reports, and this page does not say they are. */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'hotel',
  label: 'Hotels & resorts',
  short: 'Hotels',
  blurb: 'Rooms, bookings, check-in and check-out, the guest bill with GST, housekeeping, a banquet hall and your restaurant, in one place.',
  title: 'Rooms, restaurant and banquet on one bill, closed out every night.',
  lead: 'For hotels, resorts, lodges and guest houses with a restaurant. Take the booking, check the guest in, charge the room each night, take payment and make the GST invoice at check-out. Close the day with night audit and read the figures an owner reads each morning: occupancy, average rate, revenue per room, and what the restaurant and banquet took.',
  hero: { src: p('hotel-frontdesk'), alt: 'FlowXP front desk for a hotel: guests arriving today, leaving today and staying, with occupancy, rooms to clean and rooms out of order.' },
  heroPoints: ['Choose Hotel and restaurant when you sign up and these tools switch on', 'Works on a front-desk PC, a tablet and a phone', '7-day free trial, no card'],
  modules: [
    {
      id: 'frontdesk', title: 'A front desk that shows what needs doing',
      body: 'Open FlowXP in the morning and see who arrives, who leaves, who is in the hotel and who still owes money, with the hotel’s own date at the top.',
      points: ['Arrivals due today, and any booking that was due earlier and never came', 'Guests leaving today, and anyone who has stayed past their date', 'Everyone staying, with what they owe', 'Occupancy, rooms to clean and rooms out of order at a glance', 'A booking or a walk-in guest in a couple of taps', 'Roles for the front desk, housekeeping and the night auditor, each seeing only their own work'],
      shots: [{ src: p('hotel-frontdesk'), alt: 'FlowXP front desk for a hotel: guests arriving today, leaving today and staying, with occupancy, rooms to clean and rooms out of order.' }]
    },
    {
      id: 'calendar', title: 'The calendar: every room, every night',
      body: 'Rooms down the side and days across, with each stay as a bar. See what is free at a glance, and click an empty day to book it.',
      points: ['Green for guests in the hotel, blue for bookings, grey for rooms taken out of sale', 'Bookings that have no room number yet sit under their room type until check-in', 'The same room cannot be sold twice, even when two people book the last one at the same moment', 'Take a room out of sale for repairs or owner use, for the dates you choose', 'Several rooms on one booking, each with its own rate'],
      shots: [{ src: p('hotel-calendar'), alt: 'FlowXP hotel calendar with rooms down the side and a fortnight across, stays shown as bars and bookings with no room number yet underneath.' }]
    },
    {
      id: 'folio', title: 'One guest bill, with GST on every line',
      body: 'Each night’s room charge, the laundry, the extra bed and the airport pickup go on one bill. At check-out it becomes a single GST invoice, with the advance and the payment recorded as they were paid.',
      points: ['Room tariff taxed by the rate for the night, in the slab you set (check the rates with your accountant)', 'Post a charge for laundry, spa, transport or anything else, with its own GST rate', 'Void a charge with a reason: it stays on the history', 'Take an advance before arrival, payments during the stay, and refund the extra', 'Move a guest to another room, extend the stay or shorten it, without losing the rate agreed', 'A rate agreed when the booking was made stays, even if the rate card changes later', 'Union territories such as the Andaman and Nicobar Islands print UTGST in place of SGST'],
      shots: [{ src: p('hotel-booking'), alt: 'FlowXP guest bill for a stay: two rooms, the charges posted each night with GST, the balance and the guest’s details.' }]
    },
    {
      id: 'rooms', title: 'Housekeeping that knows which room is ready',
      body: 'Every room shows whether it is clean, dirty, inspected or out of order, and whether a guest is in it. Housekeeping marks rooms with one tap, and the desk sees at once which can be sold.',
      points: ['Clean, inspected, dirty and out of order, with a note on why', 'A room goes to housekeeping by itself when a guest checks out', 'Check-in warns if the room has not been cleaned', 'Give rooms to a housekeeper for the day', 'A room cannot be put out of order while a guest is in it', 'Filter to the rooms to clean, or the rooms ready to sell'],
      shots: [{ src: p('hotel-rooms'), alt: 'FlowXP rooms and housekeeping with each room’s status, the guest in it and buttons to mark it clean, inspected, dirty or out of order.' }]
    },
    {
      id: 'audit', title: 'Night audit: close the day properly',
      body: 'At the end of the day, FlowXP charges each room for the night, records the day’s figures exactly as they were, and moves the hotel’s date on. It will not close the day while a booking is neither checked in nor marked as a no-show.',
      points: ['Posts the night’s room charge once for each room, however many times you retry', 'Asks you to settle bookings that never arrived before the day can close', 'Keeps a guest who stayed past their date on for another night', 'Stores the day’s rooms sold, revenue, arrivals, departures and no-shows, so a later change of rate never rewrites history', 'The restaurant’s own sales and banquet functions that day count on that day'],
      shots: [{ src: p('hotel-audit'), alt: 'FlowXP night audit showing the hotel’s date, rooms occupied tonight, bookings not arrived and guests due out.' }]
    },
    {
      id: 'reports', title: 'The reports a hotel is run from',
      body: 'The manager’s flash, occupancy and rate by day, revenue by department, who is in the hotel and who owes, collections, no-shows, source of business and a look ahead. They follow the standard hotel report set.',
      points: ['Manager’s flash: rooms sold, occupancy, average rate (ADR), revenue per available room (RevPAR), revenue by department, GST, arrivals, departures, no-shows, for the day, the month so far and the year so far', 'Occupancy and revenue for any range, day by day, to CSV', 'Revenue by department: rooms, restaurant, laundry, spa, banquet, transport and more', 'Collections by payment method and by person, with refunds', 'In the hotel, arrivals and departures lists, and a high-balance list of guests who owe', 'No-shows and cancellations, and the room value they lost', 'Source of business: walk-in, phone, agent, each OTA, company', 'A forecast of rooms booked for the next weeks, and banquet events and what is owed'],
      shots: [{ src: p('hotel-flash'), alt: 'FlowXP manager’s flash report with occupancy, ADR, RevPAR and revenue for the day, month to date and year to date.' }, { src: p('hotel-occupancy'), alt: 'FlowXP occupancy and revenue report by day with a chart and totals.' }]
    },
    {
      id: 'banquet', title: 'Banquet and events, from enquiry to invoice',
      body: 'Take a wedding enquiry, hold the hall, confirm it, plan each function, and send the kitchen and floor a printed event order. When it is over, make the GST invoice.',
      points: ['Enquiry, hold the hall until a date, then confirm. A held hall frees itself when the date passes', 'A wedding with several functions: mehendi, sangeet and reception, each with its own hall, time and guests', 'A hall cannot be booked twice at overlapping times', 'Menu packages with a price a plate, worked out on the guaranteed guests', 'Hall rent and food are worked out from each function; add decor, sound or rooms by hand', 'Advance and payments, and a refund if it is cancelled', 'A printed banquet event order for the kitchen and floor, and a proforma invoice for the organiser', 'A hall calendar, and a report of events, hall use and what is owed'],
      shots: [{ src: p('hotel-banquet'), alt: 'FlowXP banquet event with two functions, the hall and menu for each, the charges with GST and the balance.' }, { src: p('hotel-hallcalendar'), alt: 'FlowXP hall calendar showing which hall is booked or held on which day.' }, { src: p('hotel-beo'), alt: 'FlowXP banquet event order, a printed page with the functions, times, set-up, menu and instructions for the team.' }]
    },
    {
      id: 'staff', title: 'Staff, the roster and the monthly pay sheet',
      body: 'Keep your people’s records, plan the week, mark who turned up, handle leave, and make the month’s payroll sheet from attendance.',
      points: ['Departments, shifts and each person’s usual shift and weekly off', 'A weekly roster, copied to next week in one tap', 'Daily attendance: present, absent, half day, leave, overtime', 'Leave asked for and approved, which marks the days for you', 'A monthly payroll sheet from attendance, with allowances and deductions, then locked when final', 'A month in progress shows what has been earned so far', 'Pay is visible only to the people you allow; a department head can run the roster without seeing salaries', 'To CSV for your accountant'],
      shots: [{ src: p('hotel-roster'), alt: 'FlowXP staff roster for a week with each person’s shift or day off.' }, { src: p('hotel-payroll'), alt: 'FlowXP monthly payroll sheet with days worked, overtime, pay and net pay for each person.' }]
    },
    {
      id: 'rates', title: 'Rooms, rates and seasons',
      body: 'Set up your room types and rooms once. Sell the same room with or without breakfast, and charge more in the peak season.',
      points: ['Room types with a rack rate, how many adults the rate includes and what an extra adult or child costs', 'Rate plans: room only, with breakfast, and so on', 'Seasonal rates for a date range, a festival, or Fridays and Saturdays', 'Check-in and check-out times, and the booking number prefix', 'Add many rooms at once, such as 101 to 110'],
      shots: [{ src: p('hotel-rates'), alt: 'FlowXP rate plans with a rate for each room type and the seasonal rates below.' }]
    }
  ],
  included: [
    { group: 'Front office', items: ['Bookings by phone, agent, website, company or OTA name', 'Walk-in guests', 'Check-in with room assignment and ID', 'Check-out into a GST invoice', 'Room moves, extensions and shortening', 'Cancel and no-show', 'Advance, payments and refunds', 'Guest records with ID and nationality', 'Calendar of every room'] },
    { group: 'The guest bill', items: ['Room charge each night', 'Charges for laundry, spa, transport and more', 'GST by slab for room tariff', 'Void with a reason', 'UTGST for union territories', 'Agreed rates kept per night'] },
    { group: 'Housekeeping', items: ['Clean, inspected, dirty, out of order', 'Rooms to housekeeping at check-out', 'Rooms given to a housekeeper', 'Rooms out of sale between dates'] },
    { group: 'Night audit and reports', items: ['Night audit', 'Manager’s flash', 'Occupancy, ADR and RevPAR', 'Revenue by department', 'Collections by method and person', 'In the hotel, arrivals, departures, high balance', 'No-shows and cancellations', 'Source of business', 'Forecast', 'CSV export'] },
    { group: 'Banquet', items: ['Enquiry, held, confirmed, completed', 'Several functions in one event', 'Hall calendar without double booking', 'Menu packages by the plate', 'Event order for the kitchen', 'Proforma and final GST invoice', 'Advance and refund'] },
    { group: 'Staff', items: ['Staff records and departments', 'Shifts and a weekly roster', 'Daily attendance and overtime', 'Leave', 'Monthly payroll sheet', 'Pay shown only to those allowed'] },
    { group: 'Restaurant and team', items: ['Tables, kitchen display and menu, as for a restaurant', 'Charge a restaurant bill to an in-house guest’s room, paid with the rest at check-out', 'Several roles with their own permissions', 'Activity log', 'Two-step login', 'Install on a phone or tablet'] }
  ],
  notYet: [
    'A direct link to MakeMyTrip, Booking.com and other travel sites. Bookings from them are typed in with the site named and its booking number, and you still update each site’s own screen when rooms are taken. A link through a channel manager is planned.',
    'Charging part of a split restaurant bill to a room, or charging to a room with no internet. A bill is charged to a room whole, with the connection on.',
    'Door-lock, telephone and TV integrations.',
    'Filing the foreign-guest form (Form C). The guest’s ID and nationality are recorded; the filing is not done for you.',
    'PF, ESI, professional tax and TDS in payroll. The payroll sheet works out pay for the days worked, overtime, allowances and deductions only.',
    'A booking engine for your own website, and a phone app for the front desk. The hotel screens are on the website.',
    'Working with no internet at the front desk. The hotel screens need a connection.'
  ],
  faq: [
    ['Does it work without the OTA connection?', 'Yes, if most of your guests come direct, through agents, by phone or as walk-ins. Bookings from travel sites are entered by hand with the site and its booking number. If most of your bookings come from those sites, you will be updating them by hand until the channel manager link is built.'],
    ['How is GST on rooms worked out?', 'By the rate charged for the night. By default up to ₹7,500 a night is taxed at 5% and above that at 18%. Both rates and the limit are in your hotel settings, so you can change them. Check them with your accountant, because the rules have changed more than once.'],
    ['We are in the Andaman and Nicobar Islands. Is the GST right?', 'The Andaman and Nicobar Islands are a union territory, so GST there is CGST plus UTGST. FlowXP prints UTGST on invoices, receipts and the GST screens for union territories without their own legislature.'],
    ['Can I run the restaurant and the hotel from the same login?', 'Yes. A hotel has the restaurant screens (tables, kitchen, menu) and the hotel screens together, and the front desk, housekeeping and night auditor see only their own parts.'],
    ['Do I still need Tally?', 'FlowXP makes the GST invoices, the GST files and the reports, and exports to CSV for your accountant. Whether your accountant keeps Tally for the books is up to them; FlowXP does not replace a full accounting package.'],
    ['What happens if two people book the last room at once?', 'Only one booking succeeds. The other is told that no room of that type is free for those dates.'],
    ['Are these the same reports as other hotel systems?', 'They follow the standard hotel report set (manager’s flash, occupancy and rate by day, revenue by department, in-house and high balance, collections, no-shows, source of business and a forecast). Other systems may name or lay them out differently.']
  ]
};
