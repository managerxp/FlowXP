# FlowXP: pick up on another laptop

Written 2026-10-07. Read this first on a new machine (then `OFFLINE_FIRST.md`, the rule book for offline use), then `brain.md` (project memory) and `MOBILE.md` (mobile app plan and status).

## 0. First, get the code across (nothing is committed yet)
All work since the last commit (`1a3c6ae`) is **uncommitted** on branch `Feature`: about 80 files in `backend/`, `frontend/`, `mobile/` and the docs. The owner commits by hand (do not commit or push for them).
On THIS laptop, before leaving it: `git add -A && git commit -m "..." && git push` (or copy the whole `C:\flowxp` folder, excluding `node_modules`). `mobile/` is a new folder and `.env` files are ignored by git, so recreate them (section 2).

## 1. Install on the new laptop
- Git, Node 22 (`node -v`), Python 3 (a few helper scripts), PostgreSQL 15+ (any recent), Android phone with Expo Go **or** the Android emulator (section 5).
- `cd backend && npm install`; `cd ../frontend && npm install`; `cd ../mobile && npm install --legacy-peer-deps` (the `.npmrc` already sets this).

## 2. Configure
- **Postgres:** create an empty database `flowxp`, user `postgres`.
- **`backend/.env`** (copy `.env.example`): `DATABASE_URL=postgres://postgres:<password>@127.0.0.1:5432/flowxp`, `JWT_SECRET=<any long random string>`, `PORT=5100`, `NODE_ENV=development`. Migrations run when the server starts (up to `0076`).
- **Demo data (dev only):** `cd backend && npm run seed:cafe` creates "Brew & Bloom Café" with 28 dishes, tables, stations, offers and 30 days of bills. Login `cafe@flowxp.test` / `demo1234`.
- **`mobile/.env`:** `EXPO_PUBLIC_API_URL=http://<this laptop's LAN IP>:5100` (find it with `ipconfig`; for an Android emulator use `http://10.0.2.2:5100`). Not committed; the IP changes between networks.

## 3. Run
```bash
cd backend && npm run start          # API on :5100   (or use the app's preview launcher: .claude/launch.json "flowxp-api")
cd frontend && npm run dev           # website on :5174
cd mobile && npm run phone           # Expo dev server (use npm.cmd on Windows PowerShell if scripts are blocked)
```
Phone: open **Expo Go**, "Enter URL manually", `exp://<laptop IP>:8081`. Phone and laptop on the same Wi-Fi.
**Windows firewall:** allow inbound TCP 5100 and 8081 (administrator PowerShell: `New-NetFirewallRule -DisplayName "FlowXP dev" -Direction Inbound -Protocol TCP -LocalPort 5100,8081 -Action Allow -Profile Public,Private`). A Windows-made "Node.js" **block** rule on the Public profile overrides it: delete it, or set the Wi-Fi to Private. Test from the phone browser: `http://<IP>:5100/api/health` should answer a short "not found".

## 4. Check everything still works
```bash
cd backend && npm test                                   # 961 tests, needs Postgres (makes throwaway databases)
cd mobile && npm run release:check                       # typecheck + 100 tests + expo-doctor (21/21) + Android bundle
# against a running API and the demo café (each makes real demo sales/orders):
FLOWXP_EMAIL=cafe@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e            # sign in, sell, replay
...                                                      npm run e2e:offline   # network off, 3 sales, on
...                                                      npm run e2e:cafe | e2e:pages | e2e:orders | e2e:kitchen | e2e:changes
```

## 5. Android emulator (was being set up on the old laptop, not finished)
Old laptop: Java 17 + command-line tools were unpacked in `C:\Users\AbdulHayyu\android-sdk`; the SDK **licenses were not yet accepted** (the owner must accept them). To redo anywhere:
1. JDK 17 (e.g. Temurin) and Android command-line tools; set `JAVA_HOME`, `ANDROID_HOME`.
2. `sdkmanager --licenses` (type `y` to each).
3. `sdkmanager "platform-tools" "emulator" "platforms;android-35" "system-images;android-35;google_apis;x86_64"`.
4. `avdmanager create avd -n flowxp35 -k "system-images;android-35;google_apis;x86_64"`; `emulator -avd flowxp35`; check `emulator -accel-check` (Windows needs the Hypervisor Platform feature, which may need a reboot).
5. Then run the checklist in `MOBILE.md` ("Try it on a phone") and the Android 13 to 16 passes listed in `MOBILE_AUDIT.md`.

## 6. Where things stand
- **Backend:** retail phases 4 and 5, offers, café defaults, mobile sync (migrations 0074 to 0076: `invoices.client_key`, `sync_log` + triggers, `app_errors`), `GET /sync/head|changes`, idempotency on sales, products, customers, order items, held bills, stock adjust. 961 tests green.
- **Website:** café industry page and screenshots (`frontend/src/site/industries/content/cafe.js`, `frontend/public/product/cafe-*.webp`).
- **Mobile app (`mobile/`, Expo SDK 57, Expo Router, TypeScript, SQLite):** built and tested: sign-in, bills, scan, options, offers, held bills, tables and orders, kitchen screen, customers, products, stock, reports, offline bills + customer lookup + queued price/stock changes, Hindi, Help and tour, crash reports, printing via the Android print dialog. **Only the owner's phone has run it** (found two real bugs). See `MOBILE.md` for details and `MOBILE_AUDIT.md` for the honest readiness report (**NOT READY**, 55/100).
- **Not built in the app (website only):** purchases and suppliers, expenses, returns and credit notes, GST returns, staff and roles, business settings, subscription, loyalty and coupon set-up, table moves/merges/reservations, Flow AI, notifications, one-tap Bluetooth printing.

## 7. Next steps, in order
1. Accept Android licenses, finish the emulator, run the app on Android 13 to 16 online and offline (MOBILE_AUDIT "Release gate").
2. Confirm the "database is locked / null pointer" fix on a real phone (one operation at a time in `lib/db.ts`, product-list rebuild, `Settings > Refresh the product list`).
3. Write the HTTP-level tenant (A1/A2/B1/B2) and role test for the endpoints the app uses; decide about the `X-Offline-Sale` header being usable by a script (audit item 5).
4. Expo account: `npx eas-cli login`, `eas init`; first preview build (also confirms R8 shrinking, which was switched on untested); then Play Console (see `mobile/STORE.md`).
5. Real-phone UX pass; more languages (add a dictionary in `mobile/src/lib/i18n.ts`); then website-only features the owner asks for.
6. Owner-only launch tasks (production `.env`, domain/HTTPS, email provider, backups, Cashfree production, Gemini cap, Google keys, admin 2FA) are listed in `brain.md` and `DEPLOY.md`.

## 8. Things that bit us (save yourself the time)
- Shell: heredocs with apostrophes/backticks break in Git Bash; write files with the editor tool or a `.py`/`.cjs` script.
- Windows PowerShell blocks `npm` scripts: use `npm.cmd`, or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- `expo-router` needs the app to start at `index` (`unstable_settings.initialRouteName`), or the first screen listed (the scanner) opens first.
- `@expo/vector-icons` needs `expo-font` installed or expo-doctor fails.
- Expo Go may not support the newest SDK; if it refuses the project, make a development build.
- Release builds block plain HTTP (cleartext is off): a dev client against `http://` will not connect; use Expo Go or HTTPS.
- Changing what the phone keeps or what the server sends: bump `COPY_VERSION` in `mobile/src/lib/catalog.ts` (every phone downloads again), and add a numbered step in `mobile/src/lib/migrate.ts` for any table change.
- The dev API stops when the machine sleeps or a session ends: restart it before blaming the app (an empty menu was just that).

## 9. Pending (full list, 2026-10-07)

**Waiting on the owner**
1. Accept the Android SDK licenses (`sdkmanager --licenses`), so the emulator can be finished and Android 13 to 16 tested online and offline.
2. Commit and push (about 80 files uncommitted on `Feature`, including all of `mobile/`).
3. Real-phone check: confirm the "database is locked / null pointer" fix; look for crowded screens and hard-to-tap places; send screenshots.
4. Accounts for release: Expo, Google Play developer account, Play service-account key.
5. Have a Hindi reader check the wording in `mobile/src/lib/i18n.ts`.
6. Decide the `X-Offline-Sale` header (a script can use it to oversell and back-date up to 7 days): log those bills in the audit log, or restrict.

**Not built in the app (website only)**
Returns and refunds, purchases and suppliers, expenses, GST returns, staff and roles, business settings, subscription, loyalty and coupon set-up, table moves/merges/splits, reservations, Flow AI, push notifications, one-tap Bluetooth printing, languages other than Hindi (listed in the picker, show English).

**Before the Play Store** (readiness 55/100, NOT READY: see `MOBILE_AUDIT.md`)
- Release build with Expo; run on two real phones and a tablet; confirm R8 shrinking (switched on, untested).
- HTTP-level test: two restaurants, four branches, six roles, for the endpoints the app uses.
- Device drills: airplane mode, app killed during send, phone reboot.
- Production API on HTTPS; privacy policy page live; Data Safety form and content rating; store screenshots.
- TalkBack and 200% font checks.

**Launch tasks (owner only, from before the mobile work)**
Production `.env`; domain and HTTPS certificate; real email provider; backups; Cashfree production keys and brand name; Gemini spend cap; Google sign-in keys; admin 2FA setup.

**Suggested order:** licenses -> emulator pass -> fix what it finds -> pick the next website-only feature (returns and refunds is the most asked for) -> Expo preview build -> Play Console.

### Update 2026-10-08 (restaurant finished, shops started)
Done and tested (111 mobile tests): table move/join/split, waiter assignment, bookings and waiting list, returns with credit notes, expenses, suppliers and receive stock, use-by dates. Expenses and suppliers POST are now idempotent on the server.
**Still to build, in order:** (1) salon is DONE for daily use (till, booking, gift cards, clients, team, reports; menu/plan/settings editing and campaigns stay on the website); (2) pharmacy is DONE for daily use (till, batches, receiving); (3) wholesale and distributor: customers, orders and collections are DONE (online); still to build: (warehouse pick/pack/dispatch/delivery is DONE, online), (purchase orders, goods received and paying suppliers are DONE, online), returns, and (field visits, orders, payments and van sales, offline, are DONE; remaining for distributors: scheme hints offline, GPS on a visit, route planning); (4) retail stock counts and offers set-up; (5) GST returns and staff/roles stay on the website.

### Update 2026-10-08 (pharmacy offline)
Pharmacy now works with no internet: local medicine copy, queued sales to `/pharmacy/pos/invoices`, server validation and review flags (backend migration 0077, `pharmacyOffline.test.js`, drill `npm run e2e:pharmacy:offline`). The pattern and the checklist for the next business type are in `OFFLINE_FIRST.md`. Salon, wholesale and distributor are still online-only.

### Update 2026-10-08 (field sales offline)
A field rep can now work a route with no signal: visit, order and payment are queued and sent in order, once each (backend migration 0078, `fieldSalesOffline.test.js`, drill `npm run e2e:field`). The demo distributor is a WHOLESALE-type business with the distributor layer, so My route shows for both types.

### Update 2026-10-08 (van sales, and the web app)
Van sales work with no signal (backend: `distributorVehicles.controller.js`, test `vanSalesOffline.test.js`; phone: `van.tsx`, `van-sale.tsx`; drill `npm run e2e:van`).
The WEB app now shows what phones took offline: bills and wholesale orders carry `offline` and `review` (from `backend/src/utils/offlineNote.js`), the Invoices page has a "Needs a look (N)" tab and a "Taken offline · check" label on each row, the bill page has a screen-only notice (never printed on the customer's bill), the Sales orders page has a "Needs a look" stage. Files: `frontend/src/components/OfflineFlag.jsx`, `billing/InvoicesPage.jsx`, `billing/InvoiceDetail.jsx`, `wholesale/WholesaleOrders.jsx`, `wholesale/OrderDetail.jsx`.

### Update 2026-10-08 (warehouse)
Warehouse flow in the app: pick (with scanning), pack, send out (challan + bill), deliveries (`warehouse*.tsx`, `lib/warehouse.ts`, drill `npm run e2e:warehouse`). Backend: `GET /wholesale/orders` now also opens to the `fulfilment` right (showing only orders waiting to be picked); sync and `pos-catalog` open to `fulfilment`. The web app already had these screens and shows the same data.

### Update 2026-10-08 (buying)
Purchase orders, goods received (part deliveries, damaged goods, batch and use-by) and paying suppliers are in the app (`purchasing.tsx`, `purchase-order-new.tsx`, `purchase-order/[id].tsx`, `goods-received.tsx`, `lib/purchasing.ts`; drill `npm run e2e:purchasing`). The generic Suppliers screen now sends a wholesaler's "Receive stock" to Goods received. No backend change was needed. Returns are in the app too (`returns.tsx`, `return-sale.tsx`, `return-purchase.tsx`, `wh-return/[id].tsx`, `lib/returns.ts`; drill `npm run e2e:returns`): a shop sends goods back against a bill (reason, quantity, where the goods go: shelf, damaged, expired, not coming back) and gets a credit note that cuts what they owe; goods go back to a supplier against a delivered order with a debit note. One key per return, so a double tap makes one. No backend change. Price lists are in the app too (`price-lists.tsx`, `price-list/[id].tsx`, a "Change price list" button on a customer's account, `lib/pricing.ts`; drill `npm run e2e:pricing`): make everyday or offer lists, add a fixed price or a % off per item and unit with a quantity break, offer dates, switch a list on or off, make it the list for everyone, give it to a customer. Needs the `pricing` right on the server (owner has it). No backend change. Stock transfers are in the app too (More, "Moving stock": `transfers.tsx`, `transfer-new.tsx`, `transfer/[id].tsx`, `lib/transfers.ts`; drill `npm run e2e:transfers`): keep or send now, on the way, receive with good / damaged counts (short goods are not added anywhere; the server records them), cancel (goods come back). Needs `inventory` (send/receive also `fulfilment`) and at least two warehouses. No backend change. Wholesale is now covered end to end in the app.


Pharmacy medicine editing (2026-10-08): `medicine/new.tsx`, `medicine/[id].tsx`, `lib/MedicineForm.tsx`, `lib/medicine.ts`; drill `npm run e2e:medicine`. Add or change name, strength, form, salt, maker, schedule, prices, GST, prescription, batch and use-by tracking (locked while there is stock), barcode, reorder level, category, remove. Edits send only what changed. Online only (price and stock fixes on the product page still work offline). Backend: `POST /pharmacy/products` now honours the Idempotency-Key. Tablet fix: the left rail (`lib/Rail.tsx`) had been laid out as a bottom bar and hid the other tabs; it is a real left rail again with More pinned at its bottom.

UX pass 1 (2026-10-08, from the master UX brief): Home is compact (greeting, outlet switcher, big New bill with Scan and Bills, up to four quick actions the person may use, tappable 2x2 'Today's business', a one-line 'Finish setting up' that expands), More is grouped (Sell, Stock and buying, Customers, Your business, This phone) with icons and shows only what the person's permissions allow (`lib/access.ts`), the tab bar and tablet rail hide tabs the person cannot use. No business logic changed. Not done from the brief: a rename of the tabs, configurable quick actions, a conflict-choice dialog, Flow AI screen.

Billing pass (2026-10-08): the till has a Popular shelf (learned from what this phone sells, kept per outlet in the phone's kv, `lib/billing.ts`), a line total on each bill line, the total on the Take payment button, a leaner header; payment shows UPI, Cash, Card in that order, starts on the way this till was last paid, and offers Exact and round cash amounts; the success screen shows a tick, 'Payment received' and the amount, with New bill, Print and Send. Bill logic, idempotency and offline queue unchanged.

Kitchen pass (2026-10-08): the kitchen screen has a Large text mode (type and buttons about 30% bigger, the figures strip hidden so it is just tickets and big buttons); kitchen-role staff start on it, others can switch it with Large text / Normal text (remembered per phone). Kitchen-only staff already go straight to the kitchen screen with no tabs, till or reports. Ticket logic, timers, buzz, rush and undo unchanged. Not added: a separate Start preparing step (the server marks a dish as preparing when it is sent).

Inventory pass (2026-10-08): the Stock screen (`stock.tsx`, `lib/inventory.ts`; drill `npm run e2e:stock`) lists everything counted, worst first, each with an icon and words (Out of stock, Low stock, In stock) and the count; a summary line, search, All / Out / Low / In stock filters; tap an item for a bottom sheet with Add stock (how many came in) or Adjust stock (plus or minus with a reason chip), showing what the shelf will read; same offline fallback and one-key-per-change rule as the product page; Order more goes to Buying (wholesale) or Suppliers. The product page still works as before.

Customers pass (2026-10-08): the Customers list (`customers.tsx`, `lib/customers.ts`; drill `npm run e2e:customers`) says '₹840 due' for someone who owes and '₹1,250 spent' otherwise, with phone, bill count and 'last 5 days ago'; a total-due line; Everyone / Customer dues / Best customers filters. A customer's page has a Customer dues section: tap an unpaid bill, enter the amount (full by default), UPI / Cash / Card, Money received (POST /invoices/:id/payments, one key per payment). Picking a customer for a bill is unchanged.

Reports pass (2026-10-08): `reports.tsx` opens on Today with four figures (sales, bills, average bill, estimated profit from /profitability, shown only where the plan allows it, with a line saying it is an estimate), a 'What happened' card of plain sentences (best seller, busiest time, how most paid; `lib/reportsView.ts`), the top five sellers, and 'View detailed reports' for payment methods, channels, categories, best day, busiest hour and day by day. The same data and ranges as before; drill `npm run e2e:reports`. The sentences are English only (they contain item names).

Flow AI (2026-10-08): `flow-ai.tsx` + `lib/flowai.ts` (More > Ask Flow AI, and a button on Reports; needs the `ai` right and the plan's AI feature). A chat over the existing /ai endpoints: suggested questions (the server's own, else four plain ones), one-tap daily briefing, earlier chats, answers drawn as plain text (bullets, numbers, bold; nothing is run), 'Looking at your records…', the question comes back into the box if it fails, and every failure is a plain sentence (not set up, switched off, no questions left, slow down, no internet). Online only. Drill `npm run e2e:flowai` asks two real questions, which counts against the plan's monthly AI allowance and costs a little. No backend change.

Conflicts (2026-10-08): a price changed with no signal remembers the price the phone saw (`lib/conflicts.ts`, `_check` in the queued change, never sent to the server). When it is sent the server's price is read first: unchanged = sent; already the same = done; anything else = the change is held (state 'conflict', counted as needing a decision) and the Waiting screen asks 'Something changed on another device ... Keep my change (X) / Keep FlowXP's (Y)' (or Decide later). Keep mine sends it with its original key; keep FlowXP's drops it and shows the server price. Stock changes are 'add 5 / take away 3', not totals, so two devices' changes add up and never conflict. Bills never conflict: the server accepts them. Drill `npm run e2e:conflicts` (restores the price). Not covered: other offline edits (field and van orders, receiving stock) are new records, not edits of shared values.

Tablet pass on the older screens (2026-10-08): the width rules are in `lib/layout.ts` (tested): a rail from 768 wide, two columns of rows from 1000. `ColumnList` (in `lib/responsive.tsx`) is a FlatList that shows two columns on a wide screen and one on a phone; the list screens use it with `<Page grid>`: Products, Bills, Customers, Expenses, Stock, Suppliers, Buying, Returns, Price lists, Moving stock, Wholesale customers and orders, Salon clients, Use-by dates, Bills on hold. Pay, Receipt, Settings and Waiting are now width-limited like the rest instead of stretching edge to edge. Not changed: the till and the order screen already split into menu and bill on a tablet; detail and form screens stay one centred column (760); Pay is still one column. Checked only by type-check, tests and the release bundle: not seen on a tablet.

Pay screen on a tablet (2026-10-08): from 768 wide it is two panes: the bill on the left (each line with its quantity and amount, offers, GST, total; for a table's order, what is not yet billed) and the way to pay on the right (UPI, Cash, Card, cash amounts, the confirm button). A phone is unchanged (amount, then the way to pay). Same payment code and idempotency key in both layouts; the bill rows are `cartSummary` / `orderSummary` in `lib/billing.ts` (tested). Not seen on a tablet.

Salon service menu (2026-10-08): More > Service menu (salon, `products` right): `salon-services.tsx`, `salon-service/new.tsx`, `salon-service/[id].tsx`, `lib/ServiceForm.tsx`, `lib/salonMenu.ts`; drill `npm run e2e:salon-menu`. The menu by category with time and price, search, On the menu / Removed; add or change a service (name, price, how long, GST, category, who it is for, a note), edits send only what changed, remove and bring back. Still on the website: which team member does a service, the products it uses, commission, membership and package plans. Backend: `POST /salon/services` now honours the Idempotency-Key. Online only; the till's catalogue picks the change up when it next loads.

Salon memberships and packages (2026-10-08): More > Memberships and packages (salon, `products` right): `salon-plans.tsx` (Memberships / Packages tabs), `salon-plan.tsx` (one form for either, new or existing: /salon-plan?kind=&id=), `lib/salonPlans.ts`; drill `npm run e2e:salon-plans`. A membership: name, price, GST, how long, a discount % (on services, products or both), free services with a count, priority booking, on/off; a package: name, price, GST, how long, services with visit counts, on/off, with 'worth X one by one: the client saves Y'. Edits send only what changed; a membership's other benefits (points multiplier, perks) are kept when the discount changes. Clients who already hold one keep the terms they bought (server behaviour, stated on the form). Backend: POST /salon/membership-plans and /salon/packages now honour the Idempotency-Key (a repeat used to make a second plan). Drills leave 'Drill ...' plans and packages switched off. Selling them to clients is still done at the salon till. Gift cards, offers, loyalty, campaigns and automations remain website-only.

Distributor items (2026-10-08): (1) Route planning: `field.tsx` has day chips (today and the next six days; tomorrow's route is kept when today's loads, so it can be planned with no signal), Plan the day (move a shop up or down, or Suggest an order: not yet visited first, most overdue first, longest since an order; Beat order resets), the chosen order is kept on the phone per day, and a Follow up list of shops the rep said to visit again (`lib/route.ts`). (2) Offers offline: when the route loads online the offers each shop qualifies for are kept on the phone (`lib/schemeHints.ts`); the order screen shows 'Offers for this shop' with how many more to add for a one-product offer, 'No internet. Offers as they were X' when read from the phone; the server still prices the order. (3) Where a visit was: `expo-location` (foreground only), `lib/locate.ts` + `lib/spot.ts`; asked only when the business's visit_location setting is on (read from /wholesale/settings and kept), the first time a visit is recorded; no answer or no fix in 7 s = recorded without a place. New permissions ACCESS_COARSE/FINE_LOCATION: Data Safety, privacy policy and the Play location declaration must be updated (see STORE.md and MOBILE_AUDIT.md). Drill `npm run e2e:distributor` (records demo visits; restores the setting). No backend change. GPS distances between shops are not used: the suggested order is by money owed and time since an order, not by travel.

Restaurant final check (2026-10-08): (1) Help moved to the bottom of More (own 'Help' group above Account). (2) Scan removed for restaurants, cafés and cloud kitchens: no Scan on Home or the till, no scanning step in the getting-started list, no barcode box on the new-item form; the till says 'Search for an item'. Kept for retail, pharmacy; added to wholesale and distributor item search (`lib/SearchBox.tsx`: order for a shop, field order, van sale, goods received, purchase order) through the same scanner. (3) Kitchen screen: compact by default (large text is now a choice, not the kitchen role's default), smaller type, tablet shows the tickets to make in a grid (up to 4 across) so many are visible at once. (4) Till and table order: items on the bill are highlighted on the menu with a count badge and a tinted tile; the bill scrolls to and lights the line just added; the table-order screen shows 'On this order' beside the menu on a tablet (live). (5) Role finding fixed: the server only sent a person's overrides, so the app showed everything to every role. `/auth/me` now also sends `effective_permissions` (role defaults + overrides); the app uses it (older sign-ins that lack it still see everything until the next app start). Drill `npm run e2e:roles` proves, over HTTP for owner, manager, barista, waiter, kitchen and cashier, that nothing is shown that the server refuses; the kitchen role gets no Sell, Tables or Bills tabs. Backend: `effectivePermissions` in `modules/permissions.js` with tests. Old `npm run e2e` script repaired (it used a retired catalogue call).

List performance (2026-10-08, from the react-native-expert skill installed in .claude/skills): every two-column list (`ColumnList`) now draws only what is near the screen in small batches (initialNumToRender 14, maxToRenderPerBatch 10, windowSize 7, removeClippedSubviews on Android). The longest lists use memoized rows that redraw only when their own item changes: Products, Bills, Customers, Stock, and the till's menu tiles (a tile redraws only when its own count on the bill changes). Taps go through refs so the rows stay stable. No behaviour change; checked by type-check, the test suite and the release bundle, not measured on a phone. Screens that group rows under headings (Service menu, More) still use a ScrollView: they hold tens of rows, not thousands.

Tablet held upright (2026-10-08): the till and the table-order screen show a strip under the menu with every item on the bill / order (the one just added lit, tap to open the bill), because the two-pane bill only appears from 768 wide. Kitchen tickets are more compact: smaller type, tighter rows, a dish's own Ready button sits on its row (only when a ticket has several dishes; a single dish uses the ticket's Ready), and tickets sit in as many columns as fit (about 270 wide each) on a tablet either way up, including the Ready and Served lists when upright.


## Manager approval for bill cancels and discounts

- Backend: `migrations/0079_approvals.js`, `src/modules/approvals.js`, `src/controllers/approvals.controller.js`; hooks in billing, pharmacy and salon tills and `invoices.controller.js` cancel. New right `approvals` (owner, admin, manager, sales manager, distributor admin).
- Settings: `businesses.discount_cap_pct` (default 20), `cancel_needs_approval` (default on). `/auth/me` returns `approval` per business.
- Website: `frontend/src/lib/approval.js` (`withApproval` asks for the PIN on APPROVAL_REQUIRED and retries with a fresh idempotency key), used in BillingPage, PharmacyPos, SalonPos, InvoiceDetail; Security page has "Your approval PIN" and "Manager approval at the till".
- Mobile: no manual discounts or bill cancel there yet, so nothing to do; a refusal would show as an ordinary error.
- Check: `node scripts/security/approvals.mjs` (needs the dev server).


## End-to-end pass, 2026-10-09

Run: all 27 mobile drills per business type, the security and edge drills in `backend/scripts/security/`, the backend tests (995), the mobile tests (260) and a crawl of every website menu page for 12 roles across café, restaurant, cloud kitchen, pharmacy, salon, wholesale and distributor (vans), and supermarket.
Fixed: a bad payment method, a NUL character in text, bad pharmacy quantities and order-item quantities no longer cause a server error; the website's Customers link is hidden from roles that cannot open it; the pharmacy home page and Inventory link no longer show a cashier an access error.
Known gaps: phone push notifications are not built; Flow AI answers need the AI service to be reachable (the drill failed here on a timeout); the van and its demo stock drain a little with every van or edge drill run.


## Phone alerts (push), 2026-10-09

- Server: `migrations/0080_push_notifications.js` (`push_devices`, `notification_preferences.push`), `src/modules/push.js` (register, send through Expo in batches, forget dead phones, a `push` job), `src/modules/notifications.js` (notify() now has a phone channel, `userIds`, `channels`, `route`, `urgent`; new categories `orders`, `ready`, `bookings`), `POST/DELETE /api/notifications/devices`. Triggers: guest QR order, delivery-app order, dish ready (to the waiter or whoever opened the order), online salon booking, plus the existing stock / kitchen-delay / integration alerts now reach phones.
- Website: Notifications page has a Phone column.
- App: `src/lib/alerts.ts` (tested decisions), `src/lib/push.ts` (permission, registration, tap to open a screen), Settings > Alerts on this phone; asks once after sign-in; sign-out takes the phone off the list. `app.json` has the expo-notifications plugin and POST_NOTIFICATIONS.
- Check: stop the API server, then `node scripts/push.mjs` (26 checks, starts its own API on 5102 against a fake Expo).
- Needs you: the Firebase steps in `mobile/STORE.md` (item 0), then a build and a real phone.


## Account deletion, 2026-10-09

- Server: `migrations/0081_account_deletion.js` (`users.deleted_at`, `deletion_requests`), `modules/accountDeletion.js` (wipe a person, find sole owners), `controllers/accountDeletion.controller.js`. `POST /api/auth/delete-account` (password + two-step code if used), `POST /api/public/account-deletion` (limited to 5 an hour, same answer for known and unknown addresses, deletes nothing by itself), admin `GET/POST /api/admin/deletion-requests`.
- Rules: a person's own details are wiped and every session ends; the business keeps its bills (they say "Former team member"); the only owner of a business is held and a request is recorded for support.
- Website: public `/delete-account` (this is the link for the Play Data Safety form), Security page card, admin Deletions page. App: Settings > Delete my account opens the website page.
- Check: `node scripts/deletion.mjs` (30 checks; makes and removes its own people, uses a temporary administrator).
- Still yours: say so in the privacy policy, and answer support's emails (the queue only lists requests; it does not email anyone).


## Cloud kitchen demo and a small role fix, 2026-10-09

- `npm run seed:cloudkitchen` (in `backend/`) makes "Tandoor Box Cloud Kitchen": one kitchen, no dining room, 15 dishes, 10 customers, about 750 bills over 21 days. Sign in `cloudkitchen@flowxp.test` / `demo1234` (also `cloudkitchen-manager@`, `-kitchen@`, `-cashier@`). The café-specific mobile drills (`e2e-cafe`, `e2e-orders`, `e2e-kitchen`, `e2e-stock`) refuse it on purpose: it has no tables, options or ingredients. The others pass.
- A role that has Reports but not Inventory (wholesale accounts) can now read the warehouse list its report filters need; it still cannot open orders or stock.
