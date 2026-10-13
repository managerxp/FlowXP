/* Gaming lounges: PS5 and console lounges, pool and snooker halls. Facts from GAMING.md and the screens; screenshots are the real screens of the seeded demo lounge. */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'gaming',
  label: 'Gaming lounges',
  short: 'Gaming',
  blurb: 'A timer on every PS5, room and pool table, with food and drink on the same bill.',
  title: 'Start the timer. Serve the snacks. One bill.',
  lead: 'For PS5 and console lounges, private gaming rooms, and pool and snooker halls. A timer on every station that prices the time exactly, the food and drink ordered for that station on the same tab, and one GST bill when they are done.',
  hero: { src: p('gaming-board'), alt: 'FlowXP gaming board with each PS5, room and pool table, its running timer, what it has cost so far and the food and drink on its tab.' },
  heroPoints: ['Choose Gaming lounge when you sign up and these tools switch on', 'Works on a counter PC, a tablet and a phone', '7-day free trial, no card'],
  modules: [
    {
      id: 'timer', title: 'A live board with a timer on every station',
      body: 'See every PS5, room and table at a glance: who is playing, how long, what it has cost, and what is on the tab. Start, pause, stop and move a session in a tap.',
      points: ['Free, playing, paused, to bill and out of service, by zone', 'Start with the number of players, and an alarm or a fixed offer if you like', 'Pause when they go for food, resume when they are back, and the paused time is not charged', 'Move a session to another station, with its tab', 'Count frames or games on a pool or snooker table', 'The tile turns amber before time is up and red when it is over, and staff get a notification', 'Stopped by mistake? Take it back until the time is billed'],
      shots: [{ src: p('gaming-board'), alt: 'FlowXP gaming board with each PS5, room and pool table, its running timer, what it has cost so far and the food and drink on its tab.' }, { src: p('gaming-sessions'), alt: 'FlowXP sessions list with each sitting’s station, player, time played, charge, status and bill number.' }]
    },
    {
      id: 'rates', title: 'Rates that match how you actually charge',
      body: 'Price a console by the hour for one, two or four players, a pool table by the frame, and a private room by the half hour. Peak and happy-hour times change the price by themselves.',
      points: ['Price per hour by number of players: one player ₹100, two ₹150, four ₹200', 'Per minute, or in blocks of 15, 30 or 60 minutes, with a grace period and a minimum', 'Pool and snooker by the frame or game, by the hour, or both', 'Peak, weekend and happy-hour bands that follow the clock', 'A rate for one station, a zone, a kind of station, or all of them', 'Changing a rate never changes a session already running', 'Time is worked out to the minute from when it ran, so a reload or a restart cannot lose it'],
      shots: [{ src: p('gaming-rates'), alt: 'FlowXP rates with a private room, PS5 by the hour with peak times, pool by the frame and snooker by the hour.' }]
    },
    {
      id: 'fnb', title: 'Food and drink on the same bill',
      body: 'Every station has its own tab. Order a coffee for PS5-2 and it goes to the kitchen and onto that tab, so the player pays once for the time and the snack.',
      points: ['Staff add food and drink from the station’s tab, and send it to the kitchen or bar', 'Players can order from a QR code on the station, if you switch it on', 'The kitchen screen, recipes, stock and modifiers you already have for a café', 'Time and food on one GST invoice, each at its own rate', 'Split the bill, add a discount or a coupon, take cash, UPI or card', 'A tab with a running timer cannot be billed or cancelled until the timer is stopped, so time is never left off'],
      shots: [{ src: p('gaming-board'), alt: 'FlowXP gaming board showing food and drink on a station’s tab beside its timer.' }]
    },
    {
      id: 'wallet', title: 'Prepaid wallets, hour packs and offers',
      body: 'Regulars top up once and play against their balance. Sell hour packs, and offers like three hours for a set price.',
      points: ['Wallet top-ups with a bonus you choose: pay ₹500, get ₹50 extra', 'A bill can be paid from the wallet, or part from it and the rest in cash or UPI', 'A refund can go back to the wallet', 'Hour packs: ten hours for ₹800, good for 90 days, on the stations you pick', 'Fixed-time offers started from the board, charged extra only if they run over', 'The balance is the sum of its history, so it cannot drift, and it never goes below zero', 'What you owe players in prepaid money, as a figure'],
      shots: [{ src: p('gaming-players'), alt: 'FlowXP player page with a wallet balance and its history of top-ups, bonus and bills paid from it.' }, { src: p('gaming-offers'), alt: 'FlowXP offers and hour packs with their price, time and the stations they are for.' }]
    },
    {
      id: 'bookings', title: 'Bookings, with a hold on the station',
      body: 'Reserve a PS5, a room or a table for a time. A booked station is held just before the booking so it is not given away.',
      points: ['The day as a timeline for every station', 'No two bookings on one station can overlap, even if two people book at the same moment', 'Start the timer from the booking when they arrive', 'A no-show is marked after a wait you set, and the station is free again', 'A manager can start a held station anyway'],
      shots: [{ src: p('gaming-bookings'), alt: 'FlowXP bookings timeline with a row for each station and the day’s bookings, such as Rohit and friends on PS5-4.' }]
    },
    {
      id: 'events', title: 'Tournaments for a FIFA night or a pool cup',
      body: 'Run an event with an entry fee and a prize pool. Take entries, check people in and record who won.',
      points: ['A limit on players, with the last place taken once', 'The entry fee on a GST invoice, paid when they enter or later', 'Check in on the night, and withdraw someone with a refund note', 'Placings and prizes recorded, never more than the pool', 'A light tool: it keeps the entries and results; there is no bracket maker'],
      shots: [{ src: p('gaming-tournaments'), alt: 'FlowXP tournament with its entry fee, prize pool, players entered and who has paid.' }]
    },
    {
      id: 'insights', title: 'Reports that add up to your bills',
      body: 'See what the lounge earns from time and from food, which stations earn it, and when you are busiest. Every figure comes from bills that were really made.',
      points: ['Time and food and drink, before GST, equal to your invoices', 'Revenue, sessions and hours for each station, and how much each is used', 'Busy hours by day of the week', 'The games played most', 'Today, the last seven days, and what is stopped but not yet paid', 'A cancelled bill comes out of the figures'],
      shots: [{ src: p('gaming-reports'), alt: 'FlowXP gaming reports with time and food revenue, hours played, and takings and use for each station.' }, { src: p('gaming-dashboard'), alt: 'FlowXP gaming dashboard with today’s takings, the last seven days, what is waiting to be paid and wallet balances.' }]
    }
  ],
  included: [
    { group: 'The board', items: ['Every station with its timer', 'Start, pause, resume, stop', 'Move a session to another station', 'Alarm and time-up warnings', 'Frame counts for pool and snooker', 'Take back a stop'] },
    { group: 'Rates', items: ['Per hour by players', 'Per minute or in blocks', 'Per frame or game', 'Peak and happy-hour times', 'Grace and minimum time', 'By station, zone or kind'] },
    { group: 'Food and drink', items: ['A tab for every station', 'Kitchen and bar tickets', 'QR ordering from the station', 'Recipes and stock', 'One GST invoice for time and food', 'Split bills, discounts, coupons'] },
    { group: 'Prepaid', items: ['Wallet with a top-up bonus', 'Pay a bill from the wallet', 'Refund to the wallet', 'Hour packs with an expiry', 'Fixed-time offers'] },
    { group: 'Bookings and events', items: ['Booking timeline', 'No overlap, even at the same moment', 'Hold, seat and no-show', 'Tournaments with entry fees and results'] },
    { group: 'Players', items: ['Walk-ins need no sign-up', 'Name, mobile and gamer tag for regulars', 'A guardian on record for under-18s', 'History of their sessions'] },
    { group: 'Reports', items: ['Time and food and drink', 'By station and use', 'Busy hours', 'Most played games', 'Wallets owed', 'CSV and GST reports from the main reports'] },
    { group: 'Team and control', items: ['Attendant role for the board and the till', 'Owners and managers set stations and rates', 'Several outlets under one login', 'Activity log', 'Two-step login'] }
  ],
  notYet: [
    'Locking or unlocking a console or a PC. FlowXP keeps the time and tells your staff; it does not control a station.',
    'A page for players on their own phone, and booking online by players. Bookings and tournament entries are made by your staff.',
    'Tournament brackets and leaderboards. Entries, check-in, results and prizes are recorded.',
    'Gaming screens in the FlowXP phone app. The lounge runs in the browser on a counter PC, a tablet or a phone.',
    'Gaming cafés built around rows of PCs with their own client software.'
  ],
  faq: [
    ['Does the timer keep running if the page is closed?', 'Yes. The time is worked out from when the session started and when it was paused, kept on the server. Closing the page, a restart or a second screen all show the same time.'],
    ['How is the time charged?', 'To the minute, or in blocks you choose, at the rate for the number of players. A pause is not charged. Peak times and happy hours change the rate for the minutes they cover.'],
    ['Can players pay for food and the game together?', 'Yes. Food and drink ordered for a station are on its tab, and the time is added when the timer is stopped. One bill with GST on each line.'],
    ['Do I have to sign players up?', 'No. Most visitors are walk-ins. Add a player only when you want a wallet, an hour pack or their history.'],
    ['Can it switch off the console when time is up?', 'No. FlowXP warns your staff when time is nearly up and when it is over. It does not control the console.'],
    ['Does it handle GST?', 'Yes. Gaming time carries the GST rate you set, food and drink their own, credit notes reverse it exactly, and the GSTR-1 file and GSTR-3B figures are prepared for you to upload. Nothing is sent to the government for you.']
  ]
};
