# FlowXP mobile app (React Native) and offline sync: plan
Offline pattern for every business type: see OFFLINE_FIRST.md.

> Setting up on another machine, running it, and what to do next: see `HANDOFF.md`. Readiness: `MOBILE_AUDIT.md`.

Status: plan, nothing built. Written 2026-10-07 after reading the web till's offline code (`frontend/src/lib/offlineQueue.js`,
`posCatalog.js`, `backend/src/middleware/idempotency.js`, `modules/billing.js`).

## 1. The rule that keeps this small

**The server decides; the phone remembers and replays.** This is how the web till already works, and the app copies it:

- A sale made offline is kept on the device with an `Idempotency-Key` and sent when the connection is back. The server numbers the
  invoice, checks stock, applies offers/coupons/points, and returns the real invoice. A resend returns the same invoice, never a second.
- The phone never works out stock, totals owed, tax or invoice numbers as the truth. It shows a *provisional* bill (price x qty from its
  local catalogue) and replaces it with the server's bill after sync.

So we do **not** build the "SQLite is a second master database" design (device-side stock counters, two-way row merging,
last-write-wins). That is where billing apps lose money. What we keep from that design: a local queue, device-made ids, incremental
download of changes, and no direct database-to-database sync.

## 2. What the phone can do with no internet (v1)

| Works offline | Needs a connection |
|---|---|
| Find products (name, barcode scan) from the local catalogue | Returns and credit notes (need the original invoice and its tax) |
| Make a bill: cash, UPI (recorded), card (recorded), split, held bills | Purchases, GRN, stock adjustments, transfers |
| Add a customer by mobile number (queued) | Reports, Flow AI, settings, offers set-up |
| Take a restaurant/café counter order and bill it | Table QR orders, kitchen screen (live by nature) |
| Print a provisional receipt (marked "not final") | Online payments (Cashfree), WhatsApp/SMS |

Anything outside the left column shows "Needs internet" instead of trying. Offline returns/purchases are v2 at the earliest.

## 3. Pieces

### 3.1 Local store (SQLite via `expo-sqlite`, or `op-sqlite` if 100k-product speed needs it)
- `products` (+ `product_barcodes`), `customers` (id, name, mobile, points), `categories`, `tax rates`, active `promotions`,
  `outlet settings` (round-off, receipt text). All per business **and** outlet (prices and stock follow the outlet).
- `outbox` (the sync queue): `id (= idempotency key, uuid)`, `kind` (`invoice`, `customer`, `order`), `path`, `body`, `created_at`,
  `state` (`pending | sending | failed`), `attempts`, `error`, `server_ref` (invoice id/number once sent).
- `meta`: `last_sync_version`, device id, last catalogue refresh.
- Secrets (the session token) in the OS keystore (`expo-secure-store`), never in SQLite.

### 3.2 Sync, upward (phone to server)
- Reuse the existing endpoints (`POST /api/invoices`, `/orders`, customer create) with `Idempotency-Key`. No new "bulk entity" API.
- One batch endpoint is optional later: `POST /api/sync/push` taking up to 50 outbox items in order and returning a result per item.
  Needed only if one request per sale proves slow on bad networks.
- A sale carries `offline: true` and `invoice_date` (the day it was taken). With `offline: true` the server records it even if stock is
  short (the shelf shows the shortfall) instead of refusing a sale that already happened.
- Send oldest first. Stop at the first "try later" (no network, 5xx, signed out). A sale the server **refuses** (out of stock, expired
  coupon) is parked as `failed` with the reason, for a person to fix. It never blocks the rest and is never silently dropped.
- Same ceilings as the web queue: bounded size (start at 500 sales, with a visible warning at 80%).

### 3.3 Sync, downward (server to phone): built in phase 0 (`sync.controller.js`, migration 0074)
Today the web till re-pages the whole catalogue (`GET /products/pos-catalog`). For a phone on mobile data that is too heavy, so:

- `sync_log` (`seq, business_id, branch_id null, entity, entity_id, changed_at`), written by triggers on `products`, `product_barcodes`,
  `product_branch_settings` (outlet price), `branch_stock` (outlet stock), `categories` and `customers`. The log says only *what*
  changed; the endpoint sends the **current row**, so many changes to one thing arrive once. Offers (`promotions`) are not synced yet (phase 3).
- First install: `GET /api/sync/head` -> download the catalogue with `pos-catalog` -> `changes?since=<head>`.
- `GET /api/sync/changes?since=<seq>&limit=500` (outlet = the outlet header, as for sales) returns `{ changes: [{entity, op, id, row}], next, has_more }`, scoped to
  the caller's business and outlet exactly like the existing tenant middleware (a person pinned to outlet A never receives outlet B).
- A deleted/archived row arrives as `op: "delete"`.
- If the phone's `since` is older than the log is kept (30 days) or newer than the log has reached, the server answers `409 RESYNC` and the phone re-downloads the
  catalogue with the existing `pos-catalog` paging. Same path as a first install.
- Stock numbers the phone shows are **hints** ("about 12 left"), refreshed on every sync, never decremented as truth. The server
  checks real stock at sale time.

### 3.4 Ids
- Every offline-made record gets a UUID (`Idempotency-Key` for sales). The server keeps the number it assigns; the app shows the UUID
  only in debugging.
- Existing tables use integer ids. No migration of those. Only the idempotency key crosses the wire, and the server stores it on
  the invoice (`invoices.client_key`, unique per business) so the *same sale is findable by its key*, even after the 48-hour key
  cleanup in `idempotency_keys`, and two copies arriving at once make one invoice. Built in phase 0 for `POST /api/invoices`
  (counter and café sales); restaurant table orders and held bills are phase 3.

### 3.5 Invoice numbers (decision needed, see section 6)
- GST invoice numbers must be sequential and gap-free per series. Two offline phones cannot both hand out "INV-1001".
- Recommended: the phone shows **"Bill pending"** with a provisional receipt number (`P-` + device code + counter). When the sale
  syncs, the server assigns the real invoice number from the outlet series, and the app updates the bill and (optionally) offers
  to reprint. This is how the web till already behaves ("the server still numbers the invoice").
- Alternative (only if you must hand out a final number at the counter while offline): give each device its own numbering series
  (`POS1-0001`) registered as a separate series on the outlet. More set-up, and GST filing then spans several series.

### 3.5 Conflicts, concretely
| Case | Rule |
|---|---|
| Stock goes below zero because another till sold the same item | The sale stands (the customer already left). Server records it, sets the product to negative, and flags "oversold" on the stock screen. Never reject a bill that was paid. A shop that wants hard blocking can use "don't sell below zero" and the sale is then **parked** for a person. |
| Price changed while offline | Honour the price the customer was quoted on the phone, if the server price differs by more than a limit, flag for review (limit = a setting, default: just flag, never refuse). |
| Offer expired/changed | The server applies offers when the sale arrives (`applyPromotions`). A difference from the phone's preview is shown on the final bill. |
| Customer created offline on two phones (same mobile) | The server matches by mobile number and returns the existing customer; the sale links to it. |
| Coupon/points already spent elsewhere | Server refuses the *discount*, not the sale: the sale is parked with the reason, or billed without the discount if the owner's setting says so. |
| Phone clock wrong | The server trusts the phone's time only for "taken at" (the invoice date is the date taken, within a 7-day sanity window), never for ordering. Ordering is the outbox order. |
| Same user on two phones | Allowed. Each device has a device id; outboxes are independent. |

## 4. The app

- **Stack:** React Native with Expo (managed workflow, EAS Build), TypeScript. Expo gives camera barcode scanning
  (`expo-camera`/`expo-barcode-scanner`), secure storage, SQLite, notifications and OTA updates without custom native code.
  Move to bare workflow only if a Bluetooth printer library demands it.
- **Navigation:** React Navigation; screens: Sign in, Outlet pick, Till (search/scan, cart, pay), Held bills, Sales (today, with
  sync badges), Customer lookup, Settings (device, printer, sync status), Needs attention (parked sales).
- **Data layer:** a small repository over SQLite; React Query only for online-only screens (reports etc.). The till reads
  **only** from SQLite, so it is the same speed on and off line.
- **Auth (built, phase 0):** no new login endpoint. `POST /api/auth/login` (and the 2FA step) already returns a `token`, and every
  route already accepts it as `Authorization: Bearer`. The app keeps it in the keystore and calls `GET /api/auth/me` on each start:
  for a Bearer caller (never for a browser cookie) the response carries a fresh `token`, so the 7-day session slides forward while
  the app is used. Offline longer than 7 days the token expires; the unsent sales stay in the outbox and are sent after signing in
  again. Admin 2FA rules apply as on the web.
- **Printing:** Bluetooth/USB ESC/POS 58/80 mm via a community RN library, behind one `Printer` interface so it can be swapped.
  UPI QR on the receipt as on the web.
- **Shared code:** pricing preview (price x qty, tax inclusive/exclusive, round-off, offers preview) is already plain JS on the web.
  Extract it into a package both apps import (`packages/pricing`) so the preview cannot drift from the server's rules. The server
  remains the final word.
- **Monorepo:** add `mobile/` beside `frontend/` and `backend/`; npm workspaces for the shared package.

## 5. Phases

0. **Backend foundations: DONE 2026-10-07** (no app yet): mobile token auth; `invoices.client_key` + unique index + lookup on replay beyond 48 h;
   `change_log` + triggers + `GET /sync/changes` + `409 RESYNC`; per-outlet scoping tests; isolation tests (other business -> nothing,
   pinned outlet -> nothing from other outlets). Tests in `backend/test/sync.test.js`.
1. **Online-only till on RN: BUILT 2026-10-07, not yet run on a phone.** `mobile/` (Expo SDK 57, Expo Router, TypeScript): sign in (password + 2FA),
   choose business/outlet, catalogue download (`/sync/head` then `pos-catalog`), search and barcode scan (expo-camera), cart, cash / UPI (QR) / card,
   the sale sent with its Idempotency-Key (kept across retries), receipt from the server's invoice with Share. Products that need option choices
   (café drinks) are refused in the app until phase 3. Printer is still open (phase 4 spike).
   Checks: `npm test` (11 logic tests, incl. a 100,000-product search), `npm run typecheck`, `npx expo-doctor` (21/21), `npx expo export --platform android`,
   and `npm run e2e` (the app's own code against a running server: sign in, download, sell, retry the same sale, receipt).
   To try it on a phone: set `EXPO_PUBLIC_API_URL=http://<this computer's LAN IP>:5100` (the API must listen on the network), run `npm start`, scan the QR with Expo Go.
2. **Offline billing: BUILT 2026-10-07, not yet run on a phone.** The catalogue lives in the phone's SQLite (one file per business+outlet), first a full
   download in one transaction, then `/sync/changes` (409 RESYNC -> full again). Sales taken with no signal (or a timeout, or a 502/503/504) go to the
   outbox with a provisional number `P-<device>-<n>` and a PENDING receipt; they are sent oldest first, stopping at the first "try later" and parking
   a refused sale as `failed` for a person (Sales screen: Try again / Discard). A sync badge on the till shows what is waiting. Sync runs on open, every
   30 s, when the app returns to the front, and after a sale is queued. The person and outlets are cached so the app opens offline.
   Decisions made while building it: the offline mark and sale day travel in HEADERS (`X-Offline-Sale`, `X-Sale-Date`), not the body, because the server's
   48-hour duplicate guard compares bodies and a retry of a timed-out first attempt must match it exactly; the server believes the day within 7 days,
   else dates the sale today; signing out keeps the outlet's database (unsent sales are sent after the next sign-in to that outlet); the queue holds 500.
   Known limits: category renames and customers are not synced to the phone yet; stock shown is the last synced figure; a sale queued at one outlet is
   only sent when that outlet is chosen again; a token expired during a long offline spell needs a sign-in before the outbox can send (nothing is lost).
   Checks: `npm test` (29, incl. the offline matrix and 100,000 products: download 1.6 s, search about 40 ms, barcode scan 0.03 ms in Node), `npm run e2e:offline`
   (network switched off, three sales, back on, each reaches the server once, in order, dated today, a repeat returns the same invoice).
3. **Café/restaurant counter: BUILT 2026-10-07 (counter sales only), not yet run on a phone.** A drink with option groups opens a picker (Size, Milk, Sugar,
   Add-ons: the server's own min/max rules, required single choices start on the first option); the same drink with different options is a different line;
   the preview prices the options in. The option groups are kept on the phone (re-read at most every 10 minutes while online), so the picker works offline.
   Offers: the till asks the server what they save (`/retail/promotions/preview`) and shows the saving; offline it shows the plain total marked "about".
   Kitchen: a switch "Send to the kitchen / barista" (café, restaurant, cloud kitchen); the sale comes back with a TOKEN shown big on the receipt. A sale
   taken OFFLINE is billed only (the server skips the ticket when `X-Offline-Sale` is set), and the pending receipt says to tell the barista.
   NOT built (still web-till only): table orders and billing an open order, held bills, customer lookup / visit card, combos, custom lines, split payments.
   Checks: `npm test` (42), `npm run e2e:cafe` (real latte with Large + Oat + Extra shot, two bakes for the offer: preview with offers equalled the server total
   to the paisa, token returned, options on the invoice line, then an offline sale billed without a ticket).
4. **Polish and release: BUILT 2026-10-07 up to the point that needs your accounts.** Crash reports: an error boundary (the screen says "Something went wrong, your sales
   are safe") and a global handler send the error, screen, app/OS version and the 3-letter phone code to `POST /api/app-errors` (no sign-in, rate-limited, nothing about a
   person or business, kept 30 days, grouped in `GET /api/admin/app-errors` for a platform admin); with no signal reports wait in a queue of 20. A fatal crash may die
   before it is sent. Settings screen: who/what/where, phone code, last sync, waiting sales, version, server, paper 58/80 mm, test print, send now, check for an update,
   test problem report, clear this phone's data (refused while any sale is unsent), sign out. Printing: `expo-print` hands the receipt to Android's print system
   (any printer the phone can reach; Bluetooth ones through their maker's app). No over-the-air updates (removed 2026-10-09); the project id is added by `eas init`, which needs your Expo account. Icons (from the FlowXP mark), splash, adaptive and
   monochrome icons, camera as the only permission (mic/storage/overlay blocked), `eas.json` profiles (development, preview apk, production aab auto-numbered, Play
   submit as a draft), `STORE.md` (listing text, data-safety draft, asset list, owner checklist), `store/` (512 icon, feature graphic), `npm run release:check`.
   NOT done and why: a one-tap Bluetooth ESC/POS printer (needs a native library and a real printer; the server already makes the bytes at `/invoices/:id/escpos`),
   phone screenshots for the store (need a real phone), and anything needing the Expo, Google Play or Sentry accounts. Device pairing was dropped: each phone already has its own code.
   Checks: `npm test` (50), `npm run release:check` (typecheck, tests, expo-doctor 21/21, Android bundle), backend `apperrors.test.js` (4).

### The pages (added 2026-10-07, after phase 4; built for phones and tablets)

Navigation: five tabs, a bar along the bottom on a phone and a rail down the left on a tablet or a phone turned sideways (`app/(tabs)`): **Home**, **Sell**, **Sales**,
**Products**, **More**. Orientation is free (it was portrait only). Lists keep a readable width on a tablet (`Page`), and **Sell** shows the menu on the left and the bill on
the right on a tablet; on a phone it has Menu / Bill chips with the total and Take payment always at the bottom.
- **Home**: today's sales (vs yesterday), bills, money owed, low stock, 14-day bars, best sellers this week, latest bills; sync status; New sale / Scan.
- **Sell**: menu grid by category (works with no signal), search/scan, options picker, a customer on the bill, kitchen switch, offers line.
- **Sales**: all bills for Today / Yesterday / 7 / 30 days / month with search and the summary; and "On this phone" (waiting / refused / sent).
- **Products**: the phone's own copy (searchable by name, SKU, barcode, category, offline); detail with price change, stock correction (a reason is required) and remove; add a product (scan its barcode).
- **More**: Customers (list, add, detail with bills and what they owe, start a bill), Stock (running low / everything counted), Reports (sales, average bill, GST, payment methods, channels, best sellers, categories, day by day), sales on this phone, Settings, switch outlet, sign out.
- Every page that reads from the server keeps its last answer and shows it with "No signal. Showing what was saved ..." when offline (`useLoad` + `cache.ts`). A refusal (not allowed) is never hidden behind old data.
- Following `ui-ux-pro-max`: 44 px minimum targets, contrast of all text at least 4.5:1 (grey text darkened to #475569, amber to #92400e), press feedback and ripple on every row, a spinner or retry on every load / failure, real icons, accessible labels and headings.
- Server fixes made for it: `POST /products` and `POST /customers` now honor the Idempotency-Key (a double tap made two). Checks: `npm test` (58), `npm run e2e:pages` (every page's calls against the demo café, 28 checks; it creates and removes one test customer and product).
- **Table orders and held bills (added 2026-10-07).** A restaurant or café gets a **Tables** tab (Products moves into More to keep five tabs). The floor shows every table by zone: free,
  booked, order open, cooking, ready to serve, served, with items, amount and how long; it refreshes every 15 s while showing. Tap a free table to open an order (a double tap opens one),
  a busy one to carry on. The order screen shows each item's kitchen status (not sent / cooking / ready / served), quantity buttons for unsent items, Mark served, Cancel item (after it was sent),
  Add items (tap a tile; tapping the same item raises its quantity; items with options open the picker), Send to the kitchen, Customer, Bill and pay (cash / UPI QR / card, one key so a double tap
  bills once), and Cancel the whole order. A takeaway order can be started from the floor; open takeaway and delivery orders are listed under the tables.
  Held bills: **Hold** on the till (name it), a "n bills on hold" line, a Held list (More > Bills on hold) with Resume (asks before replacing the bill on the till; takes it off the list first so two tills
  cannot resume one bill) and Discard. Held on the server (shared by the outlet's tills, the same shape the website till uses) when there is a signal, on the phone only when there is none.
  Orders and the floor need a connection (the kitchen is live): offline they show what was last loaded and say so; billing an order offline keeps it open and says so.
  Not in the app: delivery riders and aggregator orders.
  Added 2026-10-08 (online only, no offline queue): move, join and split a table and assign a waiter (`order/table.tsx`), bookings and the waiting list (`reservations.tsx`), return items from a bill with a credit note (`return.tsx`, from the receipt), expenses (`expenses.tsx`), suppliers and receive stock (`suppliers.tsx`, `receive.tsx`), use-by dates and write-off for supermarket/retail (`expiry.tsx`). Logic in `lib/floor.ts`, `lib/buying.ts`, `lib/retail.ts`; tests `floor.test.ts`, `buying.test.ts`.
  Wholesale returns (2026-10-08): a shop's returned goods (credit note, GST reversed, stock by disposition) and goods sent back to a supplier (debit note); `lib/returns.ts`, drill `npm run e2e:returns`.
  Wholesale price lists (2026-10-08): `price-lists.tsx`, `price-list/[id].tsx`, `lib/pricing.ts`, drill `npm run e2e:pricing`; More now has a left rail with More at the bottom on tablets (`lib/Rail.tsx`).
  Wholesale stock transfers (2026-10-08): `transfers.tsx`, `transfer-new.tsx`, `transfer/[id].tsx`, `lib/transfers.ts`, drill `npm run e2e:transfers`.
  Business types: restaurant, cafe, cloud kitchen, retail, supermarket, services, electronics, clothing, other use the normal till. SALON has its own till in the app (2026-10-08): `lib/SalonTill.tsx` on the Sell tab (client, services with who does each, retail, packages, memberships, free visits from a package or membership, a server quote, payment, receipt) and `appointments.tsx` (today/tomorrow, arrived, start, bill the visit, cancel, no-show); logic and tests in `lib/salon.ts`, `test/salon.test.ts`, drill `npm run e2e:salon` against `npm run seed:salon`. Online only. Salon completed 2026-10-08: booking and moving appointments with free slots (`appointment-new.tsx`), gift cards sold and paid with (also split with another method), offer codes and points at the till, Clients with segments, notes and history (`salon-clients.tsx`, `salon-client/[id].tsx`), Team: attendance and commission approve/pay (`salon-team.tsx`), salon dashboard and every report (`salon-reports.tsx`, generic table renderer). Still website-only for salons: editing the service menu and team, membership and package plans, salon settings (hours, policies), reminders and campaigns, complimentary gift cards, cancelling a membership. No offline queue for any salon screen. PHARMACY has its own till in the app (2026-10-08): `lib/PharmacyTill.tsx` on the Sell tab (search by name, salt or barcode with Scan, quantity, the server quote with GST, earliest-use-by batch picked by the server or chosen by hand, prescription medicines marked and checked before the bill with doctor and patient kept in the bill note, payment, receipt), `pharmacy-batches.tsx` (use-by summary, filter by expiring/expired/on sale/held back/recalled/blocked, hold back, recall, block, put back), `pharmacy-receive.tsx` (a delivery from a supplier: batch number, use-by date as 03/2027, damaged, cost; stock goes up batch by batch). Logic and tests in `lib/pharmacy.ts`, `test/pharmacy.test.ts`; drill `npm run e2e:pharmacy` against `npm run seed:pharmacy`. Offline (2026-10-08): the medicines (with details) are kept on the phone; a sale made with no internet is queued and sent later to the pharmacy till, validated by the server, flagged for review where needed. See `OFFLINE_FIRST.md` for the pattern every business type follows and the pharmacy validation table. Receiving a delivery, batch hold/recall and choosing a batch stay online. Website-only for pharmacies: adding or editing medicines with their details (salt, strength, schedule, batch/expiry tracking), serial numbers, stock adjustments by batch. WHOLESALE and DISTRIBUTOR have their own screens in the app (2026-10-08, online only): `lib/WholesaleHome.tsx` on the Sell tab (the day's sales, orders waiting, money owed/overdue/collected, who owes the most, and New order / Collect payment / Orders / Customers), `wholesale-customers.tsx` and `wholesale-customer/[id].tsx` (what each owes and since when, credit limit and what is left, unpaid bills, latest orders, account statement), `wholesale-order-new.tsx` (customer, products by piece or carton, the price THIS customer gets, offers, what is short, credit position, then Submit or Save as draft), `wholesale-order/[id].tsx` (status, products, what is reserved and sent, Send for approval, Confirm, Confirm anyway for a manager over the credit limit, Cancel), `wholesale-orders.tsx` (open, waiting for approval, finished), `collect.tsx` (a customer pays: cash, UPI, bank, card or cheque with reference; settles the oldest bills first or one you choose; extra is kept as advance; one receipt even if sent twice). Logic and tests in `lib/wholesale.ts`, `test/wholesale.test.ts`; drill `npm run e2e:wholesale` against `npm run seed:wholesale`. Field sales (2026-10-08, WORKS WITH NO INTERNET, for a field rep of a wholesale or distributor business): `field.tsx` (My route: today's shops in visiting order from the rep's beats, visited marks, orders and collections today, month target), `field-shop/[id].tsx` (the shop: what they owe, credit, unpaid bills, last orders and visits; Take an order, Collect payment, or record why there was no sale: no order, closed, owner not there, come back later), `field-order.tsx` (products and wholesale prices from the phone's own copy, cartons, minimum order; with a signal also the shop's real price, shortages and credit), `collect.tsx` with `field=1` (a payment tied to the visit). Everything a rep does goes through the phone's change queue (`lib/field.ts`): sent now if the server answers, otherwise kept and sent later IN ORDER (the visit first, so the order and payment can name it by `visit_ref`), once each, with durable keys on the server (migration 0078). Orders arrive as PENDING for the office to confirm (credit and stock are decided then); an order the server priced HIGHER than the shop was shown is written on the order. A field rep may now keep the catalogue on the phone (sync and pos-catalog accept `sales_orders`). Tests `test/field.test.ts`, backend `fieldSalesOffline.test.js`; drill `npm run e2e:field` (as `wholesale-field1@flowxp.test`, after `npm run seed:distributor`). Van sales (2026-10-08, works with no signal): `van.tsx` (My van: what the van carries by product with batches, sold today, and what has been sold on this phone and not yet sent is taken off what is shown), `van-sale.tsx` (the shop, only products the van carries, the shop's wholesale price from the phone's copy, cartons, a warning when asking for more than the van holds, paid in full / part paid / on credit, the real price and credit with a signal; sent now or kept and sent later behind its visit, once). Server (`distributorVehicles.controller.js`): the key is kept on the order and the bill, an offline sale is dated the day it was made, never refused for van stock or credit, and flagged (more sold than the van held, over the credit limit, a total that differs from what the shop was shown, either way because money may have been taken). Tests `test/van.test.ts`, backend `vanSalesOffline.test.js`; drill `npm run e2e:van` (makes real small demo van sales that cannot be undone from the app). Loading the van, taking stock back and the end-of-day count stay with the warehouse on the website. Not in the app yet for field sales: scheme hints offline, GPS location on a visit, route planning, targets screens beyond the month figure. Warehouse (2026-10-08, online): `warehouse.tsx` (board: orders to pick, being picked, ready to pack, ready to send out, on the road, could not deliver; tabs To pick / Pick lists / On the road; tap an order to start a pick list), `warehouse-pick/[id].tsx` (Start picking; items in bin order with batches and use-by dates; scan an item with the camera to tick it off, or tap; change the number if some are missing and the short part goes back to the order as a back-order; Finish picking; Pack it (one package, optional weight); Send it out with vehicle, driver and the kind of bill (tax invoice, paid now, on credit): the delivery challan and the bill are made together; cancel), `warehouse-delivery/[id].tsx` (out for delivery, delivered with who received it, could not deliver with the reason, try again, came back). Quantities are shown in the unit sold (cartons) and sent in base units. Every action carries its own key, so a double tap does it once. Logic and tests `lib/warehouse.ts`, `test/warehouse.test.ts`; drill `npm run e2e:warehouse` (makes a real order and a real dispatch: a bill and stock leaving the warehouse). A warehouse worker may now list the orders waiting to be picked (and nothing else) and keep the catalogue on the phone for scanning. Buying (2026-10-08, online): `purchasing.tsx` (Due in, Drafts, Ordered, Owed to suppliers with the total owed, Finished; New order; Receive without an order), `purchase-order-new.tsx` (supplier, products in the supplier's units, cost blank = the supplier's price list, expected date, note; saved as a draft), `purchase-order/[id].tsx` (status, ordered/arrived/still due per product, goods received, payments; Approve and order, Send to the supplier (share the message), Receive goods, Close: no more is coming, Cancel, Pay the supplier with a method and reference), `goods-received.tsx` (a delivery against an order: each line starts as everything still due; type what arrived, damaged (not paid for), cost if different, batch and use-by date such as 03/2027 where tracked, the supplier's bill number and date, accept extra, close the order, pay now; or a delivery with no order: supplier, products, cost). Every action carries its own key, so a double tap does it once. Logic and tests `lib/purchasing.ts`, `test/purchasing.test.ts`; drill `npm run e2e:purchasing` (makes a real order, deliveries and a payment). Still website-only for buying: serial numbers on goods received, bins and locations, debit notes, purchase returns, supplier price lists, creating a purchase order from the forecast. Still website-only for the warehouse: several packages per pick list, proof-of-delivery photo, a part delivery (the shop refused some goods: it makes the credit note), editing a delivery, stock transfers between warehouses, locations and bins. Not offline. Still website-only: picking, packing and dispatching orders (warehouse), purchase orders and goods received, returns and credit notes, price lists, stock transfers, import, reports; for distributors also principals, territories and beats, schemes set-up, vehicles, targets and field-sales visits. No offline use yet (orders and collections are sent live).
- **Kitchen screen (added 2026-10-07):** More > Kitchen screen (food businesses; a person whose role is KITCHEN opens straight to it, with no till or reports, and a Sign out button instead of Back).
  Same rules as the website's display: tickets from `GET /kitchen/tickets`, **To make / Ready to serve / Served** (Served behind a "Show served" button), by **station** (chips with how many are being made and
  whether any is late), each dish on time / nearly due (75% of its time) / late with the time left or over, rush tickets first and boxed, notes in bold, a strip across the top (to make, late, oldest, ready
  and waiting), and a **Cook now** row that adds up the same dish across tickets. One tap marks a dish ready, "All ready" the whole ticket; Ready tickets get Served (or "Handed over" for takeaway) and Back;
  Rush; a cancelled dish shows struck through as "Cancelled. Do not make." with "Got it" (remembered on the phone); **Undo** for 7 seconds after any move. It keeps the screen awake, refreshes every 8 s,
  ages the timers every 15 s, and buzzes for a new order (two short) or a dish that has just gone late (one long); "Buzz on/off" is remembered. Status is shown in words as well as colour, buttons are 52 to 56 px.
  On a tablet: To make on the left, Ready (and Served) on the right; on a phone: chips for the three columns. Needs a connection and the kitchen feature on the plan; offline it shows the last tickets and says so.
  Not in it: a sound (only the buzz; no audio file yet), setting up stations and routing, the kitchen performance report (website).
  Checks: `npm test` (76, incl. 10 for the kitchen logic), `npm run e2e:kitchen` (real tickets: latte with options to the Coffee Bar, cook now, rush first, ready / undo, cancelled dish, served; makes and cancels one table order).
  Checks: `npm test` (66), `npm run e2e:orders` (the whole table flow and held bills against the demo café: 25 checks; it makes one real sale and cancels two orders).
- NOT built (web only): the kitchen display, purchases / suppliers / expenses, loyalty and coupons set-up, GST returns, staff and roles, settings of the business, returns and credit notes, multi-outlet reports.
- Not seen on a real screen by me: the layouts follow the guidance and pass type and bundle checks, but only your phone and a tablet can show how they actually look.

### Easier to learn and use (added 2026-10-07; guided by the impeccable `onboard` / `clarify` / `distill` references and ui-ux-pro-max)

- **One vocabulary:** a *bill* is what a customer pays; an *order* is a table or takeaway before it becomes a bill; *sales* is only the money total (Home, Reports). The tab is now **Bills**; "Sales on this phone" became
  "Bills waiting to send"; "sync / outbox / catalogue / SKU" never appear on screen. `test/learning.test.ts` fails if jargon or "a sale" creeps back.
- **Tour (first time only, skippable, replayable from More > Help):** three screens (make a bill in three taps; no internet, keep selling; tables and the kitchen for a café, or "everything else is under More" for a shop), ending at "Make my first bill".
- **Getting started checklist on Home**, ticked by what the person really did (first bill, first scan, hold a bill or open a table and see the kitchen, look at Bills); goes away when finished or with Hide.
- **One-time hints** on Sell, offline, Tables, an order, Products and the kitchen screen: a title and two sentences, "Got it" once, never again. More > Help > "Show the tips and checklist again" resets them.
- **Help** (More, first line): how to make a bill, work offline, hold a bill, change a price, fix stock, add a customer, print, and for cafés take a table order and use the kitchen screen; each is 3 to 6 plain steps with a "Try it now" button.
- **Simpler till:** the permanent "About: the final bill..." line is gone (the total shows "≈" and the Sell hint explains it once); the outlet line no longer carries the user's name; an empty bill says what to do and has a button back to the menu;
  "Hold bill" / "Clear bill" say what they hold or clear; the receipt's first button is "Next customer: new bill" (Print and Share below it).
- **Sign-in:** remembers the email, Show/Hide password, "Forgot your password?" (flowxp.in), plain messages for no internet and for the authenticator code step.
- **Hindi (added 2026-10-07):** English / हिन्दी buttons on the sign-in screen and in Settings; remembered on the phone; changing it redraws every screen. `lib/i18n.ts` holds the dictionary (about 330 texts: tabs, buttons,
  fields, list rows, hints, tour, checklist, Help, the till, the sync line, sign-in); shared components translate their own text, so a screen gets Hindi for free. A text with no Hindi shows English. Not translated yet: messages that come
  from the server (its error texts), the kitchen screen's dynamic lines, receipts (they print what the server made), and the long Settings/Reports sentences. Other languages: add a dictionary beside `HI` and a button in `LANGS`.
  A native Hindi speaker should read the wording once: it was written for plain shop use, not by a translator.
- `mobile/PRODUCT.md` records who the app is for, its promises and its voice, for future design work.
- **Still to do:** a check on a real phone for crowding, tap comfort and anything still confusing.

### Works with no internet (added 2026-10-07)
Bills (queued, one key each), the menu and search, options, held bills (kept on the phone), the last-loaded pages (marked "saved"), **customer lookup** (the customer list is kept on the phone and followed by changes), and
**price and stock changes** (queued in an `actions` table with their own keys, shown on the till at once, sent after the bills; a refused one is parked with its reason; shown under Bills, Waiting to send). Needs internet: table orders
and the floor, the kitchen screen, adding a customer or a product, reports, a live total with offers. Checks: `npm test` (100), `npm run e2e:changes`.

### Try it on a phone (do this on a real Android phone before the store build)

1. Server reachable from the phone (same Wi-Fi: the API must listen on the network, `EXPO_PUBLIC_API_URL=http://<computer LAN IP>:5100`), or use a `preview` build against flowxp.in.
2. Sign in (and the 2FA step if the account has it). Choose the outlet. Wait for "Getting the products".
3. Scan three real barcodes with the camera; search by name; add a drink with options (size, milk) and see the price move.
4. Take a cash sale with change; a UPI sale (scan the QR with another phone); check the receipt, Share, and Print (set paper width in Settings).
5. **Airplane mode on**: the badge says no signal; sell three things; each shows a PENDING receipt. Close the app completely and open it again: the three are still waiting.
6. **Airplane mode off**: within 30 seconds the badge says all sent; open Sales: three real bill numbers; check them on the website.
7. Café: a latte with oat milk and an extra shot sends a kitchen ticket and shows a token; the same sale offline shows no ticket.
8. Settings: send a test problem report (it should appear in the admin list), clear data is refused while a sale waits.
9. Note any screen that looks cramped, any tap target that is hard to hit, any slow moment, and how long the first product download takes on your catalogue.
5. **Later, only if asked:** offline returns, offline customer edits, supplier bill photo upload queue, push notifications.

## 6. Decisions I need from you

1. **Invoice number offline:** provisional number then the real one on sync (recommended), or a separate series per device?
2. **Oversold stock:** always accept the sale and flag it (recommended), or park it for a person?
3. **Price differences:** flag only (recommended), or refuse above a limit?
4. **Android only first** (recommended: Play Store, then iOS), or both together?
5. **Printer:** which Bluetooth/USB receipt printer models must work on day one?
6. **How long offline** must it survive: hours (500 sales) or days? Days means a bigger local store and a louder warning.
7. **Expo or bare React Native.** Recommended: Expo.

## 7. How we test it

- Backend: delta endpoint (create/update/delete, scoped by business/outlet, resync after the log window, large `limit`),
  replay after 48 h returns the same invoice, two devices sending the same key at once -> one invoice.
- App, offline matrix (scripted with a mock server): cut the network mid-send; kill the app mid-send; send twice; server 5xx then ok;
  server refuses one sale among ten (others still go); clock set a day wrong; sign-out with pending sales (must warn, not wipe);
  100k-product catalogue first download and a delta of 5,000 rows on a mid-range phone.
- Money checks: for 1,000 random carts, the phone's provisional total equals the server total (or the difference is explained
  by an offer/price change the server reports).

## 8. Risks

- Phones that clear app data lose unsent sales: warn loudly while the outbox is non-empty; nudge "connect to send" after 1 hour.
- Printer support on Android is the usual time sink: budget a spike in phase 1.
- Keeping the shared pricing package and the server in step: the money test in section 7 runs in CI.
- This plan keeps the server single-instance (in-process caches). Revisit before running more than one API process.
