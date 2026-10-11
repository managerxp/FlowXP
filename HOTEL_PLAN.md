# FlowXP Hotel & Restaurant: plan and status

A separate business type, `HOTEL` ("Hotel & restaurant"), for small and mid-sized Indian hotels, lodges and resorts with a restaurant.
Modelled on what a property management system (IDS Next, eZee, Hotelogix and similar) does. IDS Next does not publish its report menu, so the
reports below follow the standard hotel PMS set (manager's flash, night audit pack, occupancy / ADR / RevPAR, revenue by department,
arrival / departure / in-house lists, high balance, cashier, source of business). Say so to anyone who asks "is this the same as IDS Next".

One outlet (branch) = one property. Each property has its own business date, rooms, rates and night audit.

## How it fits the rest of FlowXP
- Restaurant side: `HOTEL` is treated as a food business (tables, kitchen, menu, recipes, offers), so the existing restaurant screens work unchanged.
- Room side: new module `backend/src/modules/hotel/*`, routes `/api/hotel/*` (HOTEL businesses only), web screens under `/app/hotel/*`.
- Guest bill: one consolidated GST tax invoice at check-out, made with the same invoice engine (`createInvoiceInTransaction`), so numbering, GST and
  payments behave as everywhere else. Room tariff GST follows the nightly tariff slab (default: up to ₹7,500 a night 5%, above that 18%; both
  editable in hotel settings; confirm the rates with your accountant).
- Revenue is accrued by the date it was charged (`folio_charges.charge_date`), not by when the guest paid.

## Phases
1. **Front office core (this build)**: room types, rooms, rates and plans (with seasonal overrides), guests, reservations (walk-in, phone, OTA
   name, corporate), availability, check-in with room assignment, in-house folio, charges and payments, check-out with GST invoice, room moves,
   extensions, cancel and no-show, housekeeping board, night audit (posts the night's room charge, rolls the business date, stores the day's
   figures), and the core reports.
2. **Banquet and events**: halls, hall bookings (diary), event orders (BEO), proforma and final invoices, advance, menus and package rates,
   amendments log.
3. **Staff management**: employees, departments, shifts and rosters, attendance, leave, payroll sheet, housekeeping task assignment.
4. **Remaining reports and controls**: budget vs actual, forecast, trial balance, city ledger (company accounts), group reservations, rate
   audit, user activity (night-audit exceptions).
5. **Channel manager link**: through a partner channel manager (STAAH, eZee, AxisRooms and similar) rather than a direct connection to each OTA.
6. **Phone app** screens for housekeeping and the front desk.

## Reports (phase 1)
| Report | What it shows |
|---|---|
| Manager's flash | A day: rooms available / sold, occupancy %, ADR, RevPAR, room / F&B / other revenue, tax, arrivals, departures, in-house, no-shows, cancellations, with month-to-date and year-to-date columns |
| Occupancy and revenue | One row per day for a date range: rooms sold, occupancy, ADR, RevPAR, revenue |
| Revenue by department | Room, F&B, laundry, spa, banquet, transport and miscellaneous, per day |
| Arrivals / departures / in-house | The lists a front desk works from, with balances |
| High balance | In-house guests whose unpaid folio is above their advance |
| Cashier / collections | Money taken, by payment method and by person |
| No-shows and cancellations | Who, when, why, and the revenue lost |
| Source of business | Bookings and revenue by source (walk-in, phone, website, each OTA, corporate) |
| Room status | Housekeeping state of every room |
| Guest ledger | Every in-house guest's charges, payments and balance |

## Market notes (Andaman and small Indian hotels)
- **Must fix before selling in the Andaman and Nicobar Islands:** it is a union territory, so GST there is CGST + UTGST, not CGST + SGST. The invoice engine
  prints SGST today. Add UTGST labelling (and the right state in the GST files) for businesses in a union territory.
- **OTA without a channel manager:** bookings from MakeMyTrip, Booking.com and others are entered by hand with their source (the booking form has a source and a
  reference). The risk is selling the same room twice, so the desk must update each OTA's own extranet after every change. Interim aids: an availability sheet
  to share with agents and an iCal feed; the real answer is the channel-manager link (phase 5).
- **Seasonal trade:** the peak is roughly October to May, so seasonal rates, peak/lean rate plans and the forecast report matter more than anywhere else.
- **Packages and transport:** many bookings are packages with ferry, cab and sightseeing. The folio's TRANSPORT and MISC departments carry these for now; a
  proper package builder is a later item.
- **Foreign guests:** ID and nationality are recorded; Form C filing is not done for the hotel.

## Still open (not built)
- Channel manager / OTA link (phase 5). Charging part of a split restaurant bill to a room, and charging to a room offline (a room charge needs the live list of guests).
- Phone app screens for the front desk and housekeeping. Offline use of the hotel screens.
- Group blocks and company (city ledger) accounts, trial balance, budget vs actual, rate audit, user-activity report for night audit.
- Statutory payroll (PF, ESI, professional tax, TDS). Form C for foreign guests. Door locks, PBX, telephone billing.
- Hotel reports are the standard set, not IDS Next's own report names.

## Honest limits (to show on the website's "not built yet")
- No direct OTA connection until phase 5.
- No door-lock, PBX or telephone-billing integration.
- No FRRO / Form C filing for foreign guests (the guest's ID and nationality are recorded; filing is not done for you).
- Reports follow the standard hotel set, not IDS Next's own report names.

## Status
See the bottom of this file; updated as each step lands.

### Done
- Restaurant bill to room (migration 0086, `modules/hotel/roomCharge.js`): a hotel's till and order screens have a "To room" method. The bill is a normal GST invoice left unpaid on the guest's customer record
  (`charge_to_booking_id` on `POST /invoices` and `POST /orders/:id/bill`, checked in the same transaction), and a folio line (`folio_charges.invoiced`) points at it. It is on the guest's balance
  (`hotel_charges_paise` / `hotel_paid_paise`), is not hotel revenue (the restaurant counts it on the day), and at check-out the guest's payment is shared out over those invoices and the room invoice.
  A cancelled bill falls off. What is taken at check-out is also written to the folio payments, so collections see it. Tests: `hotelRoomCharge.test.js`.
- Phase 2 banquet and events (migration 0084, `modules/hotel/banquet.js`, `/api/hotel/banquet/*`, screens `Banquet*.jsx`, `EventForm.jsx`, `EventDetail.jsx`): halls, menu packages, events with
  several functions, hold / confirm / cancel, hall clash prevention, charges worked out from each function, advance and refund, event order (BEO) and proforma pages, completion into one
  GST invoice, hall calendar, banquet report. Role BANQUET_MANAGER, permission `banquet`. Tests: `backend/test/hotelBanquet.test.js`.
- Phase 3 staff (migration 0085, `modules/hotel/staff.js`, `/api/hotel/staff/*`, `HotelStaff.jsx`, `StaffTime.jsx`, `StaffPayroll.jsx`): departments, shifts, employees, roster, attendance,
  leave, monthly payroll sheet (not statutory payroll), housekeeper room assignment. Role HR_MANAGER; permissions `hr` and `payroll` (salary hidden without `payroll`). Tests: `hotelStaff.test.js`.
- A refund taken by a different method from the advance now comes off what goes on the invoice (`netByMethod`); a same-day check-out no longer breaks departure > arrival.
- Website: `/industries/hotel` with 13 real screenshots, in the menu, sitemap and llms.txt; the home page has a hotel tab.
- Phone app: a hotel's restaurant works like a restaurant; the rooms and front desk are on the website only.
- UTGST: union territories with no legislature print UTGST (receipt, invoice, GST screens); a sale inside Andaman is no longer mistaken for inter-state.
- Phase 1 front office: migrations 0082 and 0083, `backend/src/modules/hotel/*`, `/api/hotel/*`, web screens in `frontend/src/app/hotel/*` (front desk, bookings,
  booking detail with folio and check-in / check-out, calendar, rooms and housekeeping, night audit, reports, set-up). Roles FRONT_DESK, HOUSEKEEPER,
  HOUSEKEEPING_SUPERVISOR, NIGHT_AUDITOR. Demo: `npm run seed:hotel` (Sea Pearl Resort, hotel@flowxp.test / demo1234). Tests: `backend/test/hotel.test.js`.
- Hotel can be chosen at signup.
