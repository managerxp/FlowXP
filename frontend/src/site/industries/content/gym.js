/* Gyms and fitness studios: facts from GYM.md and the screens; screenshots are the real screens of the seeded demo gym. */
const p = (name) => `/product/${name}.webp`;

export default {
  slug: 'gym',
  label: 'Gyms',
  short: 'Gyms',
  blurb: 'Memberships, a front desk that checks people in by QR, classes, trainers and reward points, billed on GST invoices.',
  title: 'Sell the membership. Check them in. Keep them coming.',
  lead: 'For gyms, fitness studios and yoga centres. Memberships billed on a GST invoice, a card or phone QR at the door, one rule for who may come in, attendance, classes with a waitlist, trainers and reward points.',
  hero: { src: p('gym-dashboard'), alt: 'FlowXP gym dashboard with active members, memberships ending this week, visits for the last seven days and what is still to collect.' },
  heroPoints: ['Choose Gym when you sign up and these tools switch on', 'Works on a front-desk PC, a tablet and a phone', '7-day free trial, no card'],
  modules: [
    {
      id: 'frontdesk', title: 'A front desk that knows who may come in',
      body: 'Scan a member’s card or phone, or find them by name. FlowXP checks the membership and answers at once, and every door uses the same rule.',
      points: ['Scan with a USB scanner or the camera, or look the member up by name or phone', 'The answer says why when someone is turned away: ended, frozen, not started, unpaid, outside their hours, wrong branch', 'A second scan within a few seconds is ignored, and the same card at two branches within minutes is flagged', 'Check in, check out, and add or void a visit with a reason on record', 'Who is in the gym now, visits today and who was turned away', 'If FlowXP cannot decide, the answer is no, never a guess'],
      shots: [{ src: p('gym-reception'), alt: 'FlowXP gym front desk with who is in the gym now, visits today, turned away today, the member code for the day, and a member found by name with a Check in button.' }]
    },
    {
      id: 'members', title: 'Every member, with their membership beside them',
      body: 'Join someone in a minute, sell them a plan, and see where their membership stands today without working it out.',
      points: ['Register a member with phone, emergency contact and consent kept with the record', 'Warns when a phone number already belongs to another member', 'Running, starting soon, ending soon, frozen and ended, worked out from the dates each time you look', 'A member’s visits, history and details in one page', 'Import a list from a spreadsheet, export, and merge two records for one person', 'Health notes are private: only trainers and managers see them'],
      shots: [{ src: p('gym-members'), alt: 'FlowXP gym members with phone, plan, end date, last visit and a status such as Active or Ends soon.' }, { src: p('gym-member'), alt: 'FlowXP gym member page with the running quarterly membership, Renew, Change plan and Freeze, recent visits, details and the printed card.' }]
    },
    {
      id: 'memberships', title: 'Plans, bills and the whole life of a membership',
      body: 'Set your plans once. Selling one makes a GST invoice, and renewing, freezing, extending, changing and cancelling are each a single action with a record.',
      points: ['Plans with price, GST, length, branches and hours the member may come, and a limit on freezing', 'You choose how payment counts: paid in full before entry, any payment lets them in, or pay later with a few days to settle', 'Sell, renew, change plan, freeze, add days, transfer and cancel', 'A cancelled bill or a refund through a credit note ends the membership for you', 'Family and shared plans where one membership covers several people', 'Each membership keeps the rules it was sold with, so editing a plan only affects the next sale'],
      shots: [{ src: p('gym-plans'), alt: 'FlowXP gym plans with price plus GST, length, who can use each and the payment rule, such as paid in full before they can come in.' }]
    },
    {
      id: 'portal', title: 'A page for the member, on their own phone',
      body: 'Members sign in with their mobile number and a code. There is no app to download and nothing to install.',
      points: ['A pass QR that renews itself every minute, so a screenshot is no use to anyone', 'Their membership, days left and reward points', 'Check in themselves by scanning the QR at the entrance, if you allow it', 'Book and cancel classes, see their workout plan and their visits', 'A printed card with a QR for members who prefer one', 'A QR carries a random code only, never a name or number'],
      shots: [{ src: p('gym-portal'), alt: 'A member’s phone page with their name, reward points, the running membership and a QR pass that renews itself.', phone: true }]
    },
    {
      id: 'attendance', title: 'Attendance you can trust',
      body: 'Every visit and every refusal is recorded with the reason, who did it and how they came in.',
      points: ['Visits by day, with how each member came in: front desk, their own phone or a gate', 'An access log of every attempt, including the turned away', 'Peak hours, visits per member and members who have stopped coming', 'Control how often a member may visit in a day, and how soon a repeat scan counts', 'Self check-in can need the code of the day from the front desk, or a fresh code sent to the member', 'Export to CSV'],
      shots: [{ src: p('gym-attendance'), alt: 'FlowXP gym attendance with each visit, the time in and out, how the member came in and their plan.' }]
    },
    {
      id: 'classes', title: 'Classes, trainers and one-to-one sessions',
      body: 'Put the week’s classes on a timetable. Members book a seat, and when a class is full the next person waits and is moved up if someone cancels.',
      points: ['Kinds of class, a trainer, a capacity and a start time, or repeat weekly', 'Booking from the desk or the member’s phone, with a waitlist and a cut-off for cancelling', 'Class packs and personal-training packs that count sessions off', 'Assign a trainer to a member, and a trainer’s own login shows only their members, with no phone or email', 'Workout plans, goals and body measurements for each member', 'Attendance for each class'],
      shots: [{ src: p('gym-classes'), alt: 'FlowXP gym timetable with Yoga, HIIT and Spin by day, the trainer, how many seats are taken and how many are left.' }]
    },
    {
      id: 'rewards', title: 'Reward points that cost you nothing until earned',
      body: 'Members earn points for visits, renewals, birthdays and bringing a friend, and spend them on what you choose.',
      points: ['Points for a visit once a day, for a paid membership, on a birthday and on visit milestones', 'A referral pays both people once the friend’s first membership is paid', 'Rewards such as a protein shake, free days or money off the next bill', 'Points expire when you say, and are given back out if a bill is refunded', 'Never paid for a refused check-in, a repeat scan or an unpaid membership', 'What you owe members in points, as a figure you can see'],
      shots: [{ src: p('gym-rewards'), alt: 'FlowXP gym reward rules with points for a visit, a birthday, a paid membership and a referral.' }]
    },
    {
      id: 'gates', title: 'Gates and readers, when you have them',
      body: 'A turnstile or a QR reader can ask FlowXP whether to open, using the same rule as the front desk.',
      points: ['Register a device for a branch and get a key and a secret, shown once', 'Every request is signed, and anything stale, forged or from a switched-off device is refused', 'The decision, the command to open and the gate’s reply are kept apart, so a failure can be traced', 'See whether a device is online, rotate its secret, or switch it off', 'A reader that works offline can report what it did afterwards, and FlowXP checks each one as it stood at the time', 'Needs a reader that can send a signed request, or a small bridge for one that cannot'],
      shots: [{ src: p('gym-devices'), alt: 'FlowXP gym settings with a registered front-door QR reader, its branch, when it was last heard from, and Rotate secret and Switch off buttons.' }]
    }
  ],
  included: [
    { group: 'Front desk', items: ['Scan a card or phone QR', 'Find a member by name or phone', 'Check in and check out', 'Reasons shown for a refusal', 'Duplicate and two-branch scan checks', 'Add or void a visit with a reason'] },
    { group: 'Members', items: ['Register, edit, import, export and merge', 'Duplicate phone warning', 'Emergency contact and consent', 'Private health notes', 'Family and shared memberships', 'Member code and printed card'] },
    { group: 'Memberships and billing', items: ['Plans with GST', 'Pay in full, any payment or pay later', 'Renew, change plan, freeze, add days, transfer, cancel', 'Branches and hours for each plan', 'Invoice, credit note and refund linked to the membership', 'Split payments'] },
    { group: 'Member’s phone page', items: ['Sign in with a mobile number and code', 'Pass QR that renews itself', 'Entrance QR and self check-in', 'Classes, workout plan and visits', 'Reward points'] },
    { group: 'Attendance', items: ['Visit log and access log', 'Daily visit limit and repeat-scan window', 'Peak hours and lapsed members', 'Code of the day for self check-in', 'CSV export'] },
    { group: 'Classes and training', items: ['Timetable and weekly repeats', 'Bookings and waitlist', 'Class and personal-training packs', 'Trainers and a trainer login', 'Workout plans, goals and measurements'] },
    { group: 'Rewards and reminders', items: ['Points ledger', 'Referrals and milestones', 'Rewards to redeem', 'Expiry and refund reversal', 'Reminders for an ending membership, a payment due, a class and a member who has gone quiet'] },
    { group: 'Gates and security', items: ['Signed device requests', 'Device list and secret rotation', 'Offline events checked afterwards', 'Receptionist, trainer, manager and accountant roles', 'Several branches under one login', 'Activity log and two-step login'] }
  ],
  notYet: [
    'Gate and turnstile makers’ own protocols. FlowXP speaks one signed request that a reader or a small bridge sends; it has not been tested against a particular make of hardware.',
    'RFID or NFC cards. Members come in with a QR, on a card or on their phone.',
    'Members paying online from their phone. Memberships are billed at the desk, and the member’s page shows what they have.',
    'Sending the sign-in code and reminders to members needs a messaging provider switched on for your account. Until then members cannot sign in on their own and reminders do not go out.',
    'Gym screens in the FlowXP phone app. The gym runs in the browser on a PC, tablet or phone.',
    'Lockers, equipment and incident logs.'
  ],
  faq: [
    ['How does someone come in?', 'By a QR on a printed card or on their phone, scanned at the front desk or a gate. At the desk you can also find them by name. They can check themselves in from their own phone by scanning the QR at the entrance, if you switch that on.'],
    ['Can a screenshot of the pass be used by someone else?', 'A phone pass lasts about a minute and works once. A printed card can be lent, so FlowXP ignores a quick repeat scan, flags the same card at two branches within minutes, and lets the front desk confirm a person before letting them in.'],
    ['What if a member has not paid?', 'You decide for each plan: paid in full before entry, any payment lets them in, or pay later with a few days. FlowXP reads this from the invoice at the moment they scan.'],
    ['Does the member need an app?', 'No. They open your gym’s page in the browser, sign in with their mobile number and a code, and see their pass, classes and points.'],
    ['Does it handle GST?', 'Yes. Memberships are billed on GST invoices, a refund goes through a credit note that reverses the tax, and the GSTR-1 file and GSTR-3B figures are prepared for you to upload. Nothing is sent to the government for you.'],
    ['Does it work with turnstiles?', 'It has the contract a gate or reader needs, and the checks on both sides. It has not yet been connected to a particular make of hardware, so a first installation needs a reader that can send a signed request or a small bridge. Ask us before you buy hardware.']
  ]
};
