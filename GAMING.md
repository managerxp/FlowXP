# FlowXP gaming lounge

A PS5 / console lounge, private gaming rooms, pool and snooker. Business type `GAMING_CAFE` (the marketing name is "Gaming lounge"). Web only. The timer is **basic by design**:
FlowXP keeps the time and tells staff; it does not lock or unlock a console. Not built for a PC café.

Plan and the design reasoning are in `GAMING_PLAN.md`. Seed: `npm run seed:gaming` (demo "Pixel Lounge", `gaming@flowxp.test` / `demo1234`, staff `gaming-manager@`, `gaming-desk@`).

## The idea that holds it together

**A station is a table, and a session is that table's tab.**

- Making a station makes a `dining_tables` row (name, zone, seats, QR token). Food and drink for the station, ordered by staff or from the station's QR menu, land on the
  table's open `orders` tab and go to the kitchen like any table's. Nothing about food had to be rebuilt.
- When a session **stops**, its time (and frames) are written onto the same tab as lines of a catalogue product "Gaming time" (kind `SERVICE`, so it is not on the menu and
  tracks no stock; GST from the gaming settings, default 18%). The line has status `SERVED`, so it never reaches the kitchen. One order, one invoice, billed through the
  ordinary `orders.bill` and `createInvoiceInTransaction`: split bills, discounts, coupons, loyalty and receipts all work.
- Time is never a counter. A session is a list of **segments** (start, end, players, a copy of the rate), so a pause, a change of players, or a move to another station starts
  a new one, and the charge is worked out from them whenever asked. A reload, a restart or a second screen all agree. Editing a rate never changes a running session.

## Rules and policies

- **One live session per station** (unique index) and every change runs under one advisory lock per station: two staff cannot both start it, and a double tap cannot stop it twice.
  Repeats are harmless (pausing a paused session, stopping a stopped one).
- **A tab with a running session cannot be billed, cancelled, moved or merged** (`assertNoLiveSession`), so running time can never be left off a bill. A station with a stopped,
  unpaid session is `TO_BILL` and cannot be started again until its tab is paid or cancelled.
- **Pricing** (`modules/gaming/pricing.js`, pure functions): hourly price by number of players (a count between rows pays the next row up), a price per extra player past the last row,
  per-minute or 15/30/60-minute blocks with a grace (the grace forgives overshooting a block already paid for, not the first block) and a minimum, peak/weekend/happy-hour bands matched by the
  wall clock in the business timezone, a price per frame/game (alone, for a table with no clock charge, or on top of time). A bundle ("3 hours for ₹250") is a fixed price for its minutes; time
  over is charged by the minute; stopping early refunds nothing. A prepaid pack covers up to the minutes it has left.
- **Bookings**: no two live bookings on one station overlap (checked under the station's lock). A station booked to start inside `hold_minutes` cannot be started for someone else without an
  override. A no-show can be marked `noshow_minutes` after the start.
- **Wallet**: the balance is the ledger (no stored balance); each movement locks the customer; a spend that would go below zero refuses the whole bill (nothing is saved); unique
  `(business, source_type, source_ref)` makes a top-up with the same `request_id`, a payment posted twice, or one credit note refunded twice move the balance once. Money in is an advance
  `payments` row (counted the day it came in); GST is on the bill the wallet later pays. A WALLET payment is only a label for any business that is not a lounge.
- **Packs** are sold on a paid-in-full GST invoice. Minutes left = minutes bought − unvoided usage rows. The pack's minutes are read under a lock at stop, so two sessions cannot spend the
  same minutes; a stop taken back (reopened) gives them back. An expired pack, one whose invoice was cancelled or fully credited, or a withdrawn one, cannot be played.
- **Tournaments**: capacity is checked under a lock on the tournament; the fee is a GST invoice; withdrawing a paid entry says to refund by credit note; prizes are a record, never more than the pool.
- **Alerts**: the worker (about every 30 s) sends "ending soon" once and "time is up" once per timed session, to people with `gaming_desk` at that outlet. Nothing stops a station.
- **Tenancy**: every row has `business_id`; outlet-scoped reads use `tenant.scopeBranchId`; another business or outlet gets 404. Gaming routes exist only for `GAMING_CAFE` (404 otherwise).

## Permissions, roles, plan features

`gaming_desk` (board, sessions, players, top-ups, bookings, tournament entries) and `gaming_setup` (stations, zones, rates, offers, games, settings, corrections, tournaments, wallet
adjustments). Role `GAMING_ATTENDANT` = `gaming_desk` + `customers`, `billing`, `payments`. Owner/Admin/Manager hold both. Plan features: `gaming_stations` (board, timer, rates), `gaming_wallet`,
`gaming_bookings`, `gaming_tournaments`; all four are off for every other business type (`INDUSTRY_OFF`). A lounge keeps the table floor, kitchen and QR ordering switches.

## What changed outside the module

`orders.controller.bill/cancelOrder`, `modules/tabs.js lockOrders` (live-session guard); `modules/billing.js` (WALLET payment debits the wallet in the same transaction, lounge only);
`creditNotes.controller` (refund method WALLET, lounge only); `invoices.controller.cancel` (returns what the wallet paid); `tables.controller.update` (a station's table is changed under Gaming, not the floor);
`middleware/auth.js`, `modules/permissions.js`, `modules/planFeatures.js`, `modules/notifications.js` (category `gaming`), `utils/validate.js` (signup type), `routes/index.js`.

## Tables (migrations 0092 to 0094)

`gaming_settings` · `gaming_zones` · `gaming_stations` · `gaming_rates` · `gaming_bundles` (kind SESSION or PACK) · `gaming_games` · `gaming_sessions` · `gaming_session_segments` ·
`gaming_session_events` · `gaming_bookings` · `gaming_players` · `gaming_wallet_ledger` · `gaming_passes` · `gaming_pass_usage` · `gaming_tournaments` · `gaming_tournament_entries`; `topup_bonus` on settings.
Every foreign key to business-owned rows cascades (deleting a business removes the lounge; a test covers it).

## API (all under `/api/gaming`, GAMING_CAFE only)

Set-up: `GET/PUT /settings`, `/zones`, `/stations` (+ `/stations/:id/status`, `/archive`), `/rates`, `/bundles?kind=`, `/games`.
Board and sessions: `GET /board`, `GET/POST /sessions`, `GET /sessions/:id`, `/events`, `PUT /sessions/:id`, `POST /sessions/:id/{pause,resume,players,units,extend,transfer,stop,reopen}`.
Players and prepaid: `/players`, `/players/:id`, `/players/:id/wallet` (+ `/topup`, `/adjust`), `/players/:id/passes`, `/passes/:id/cancel`, `GET /wallet/liability`.
Bookings and events: `/bookings` (+ `/:id/{cancel,no-show,seat}`), `/tournaments` (+ `/:id/entries`, `/results`), `/entries/:id/{pay,check-in,withdraw}`.
Reports: `GET /dashboard`, `/reports/{summary,stations,heatmap,days,games}`. Starting/stopping a session, a top-up, a pack sale, seating and an entry accept an `Idempotency-Key`.

## Known limits

No device control (nothing locks a console or PC); no player phone page or online booking; no bracket engine; gaming screens are web only (the phone app shows its generic till);
one timezone per business; a booking takes no deposit; prizes are recorded, not paid; the utilisation figure is a guide (played time against a 12-hour day on the days a station was used);
the wallet is per business (shared by its outlets); a cash/UPI refund on a wallet-paid bill is a person's decision, as everywhere in FlowXP (only the wallet part returns on a cancel).

## Tests

`backend/test/gamingPricing` (pure pricing), `gamingSessions` (stations, timer, tab, billing, QR order, races, isolation), `gamingWallet` (wallet, packs, refunds, races), `gamingBookings`
(bookings, tournaments, business deletion), `gamingReports` (figures tie to invoices), `gamingSecurity` (permissions, plan switches, alerts). Helper `test/helpers/gaming.js`.
