# FlowXP mobile: production-readiness audit (2026-10-07)

**Status: NOT READY for the Play Store.** The core (sign in, billing, offline queue, tables, kitchen) is built and tested in code and against the dev server. It has not been run on a release build, on several Android versions, or by real staff. Nothing here is "production ready" until the gate at the bottom is met.

What was and was not checked is stated per item. "Verified" = I ran it. "Reasoned" = read from code only. "Not done" = needs something I do not have here (emulator, signing keys, Expo/Play accounts, a second phone).

## Verified in this audit
- **Android manifest (generated with `expo prebuild`):** permissions are CAMERA, INTERNET, VIBRATE only; READ/WRITE_EXTERNAL_STORAGE, RECORD_AUDIO, SYSTEM_ALERT_WINDOW are removed. `targetSdk` and `compileSdk` are **36 (Android 16)**, `minSdk` 24. No WAKE_LOCK needed (keep-awake uses a window flag).
  - CAMERA: scanning barcodes (Sell, Scan, new product). Requested the first time Scan opens. If denied: a screen explains and Sell still works by search. INTERNET: all server calls. VIBRATE: kitchen alerts; if the system blocks it nothing happens.
- **Fixed now:** `allowBackup` was on (an Android backup could copy the bills database to another phone): now off. R8 code shrinking and resource shrinking were off for release: now on (**must be confirmed by the first EAS preview build; not built here**). Cleartext HTTP is now explicitly blocked in release.
- **Fixed now (battery):** the app asked the server every 30 s even when idle. Now every 20 s only while bills are waiting, every 2 minutes otherwise, and when the app returns to the front.
- **Fixed now (data safety):** the phone database had no version tracking. Added numbered upgrades (`lib/migrate.ts`) that run once, in a transaction, only add, and resume after a crash. Tests prove waiting bills, held bills and products survive v1 to v3 and a failed upgrade rolls back (3 tests).
- **Fixed now (duplicates):** holding a bill twice (double tap) made two held bills; `POST /held-bills` now honours the Idempotency-Key and the app sends one per Hold. Earlier in this project the same was done for products, customers, order items, sales, order billing and stock adjustment.
- **Phone database robustness (fixed earlier, from real-phone failures):** one connection, one operation at a time (queue), WAL, busy timeout, rebuild of the product list on storage errors, versioned product copy.
- **Tests:** mobile 94 (money, cart, catalogue, offline matrix, outbox, held bills, orders, kitchen, learning, migrations, Hindi); backend 961 (incl. tenant isolation, roles, idempotency, sync). Drills against a real server: `e2e`, `e2e:offline`, `e2e:cafe`, `e2e:pages`, `e2e:orders`, `e2e:kitchen`.

## Architecture (F)
Implemented: UI -> screens/hooks -> `lib/` logic and stores -> SQLite (catalogue, outbox, held, groups, kv) -> outbox + sync -> HTTPS API (Bearer token, X-Business-Id, X-Branch-Id, Idempotency-Key) -> Express -> PostgreSQL. The app never talks to the database directly (verified: no database driver for the server in the app; only `expo-sqlite` for its own file). There is no separate "repository" class layer: `catalog.ts`, `outbox.ts`, `held.ts` play that role over a small `Db` interface. Recommended and not worth a rewrite.
Outbox states are `pending / failed / sent` (not the longer list requested). There is no PENDING_UPDATE or PENDING_DELETE because the app only queues new sales; every other change (price, stock, customers, orders) is an online call and is refused offline with a message. No CONFLICT state is needed for sales (the server accepts them; stock may go negative and is flagged). Product price/stock edits made offline are not supported.

## Findings
### P0 (blocks release)
1. **Release AAB never built or run.** Signing, R8, native modules in release are unverified. Needs the Expo account and a preview build on real phones.
2. **Not tested on a real device or emulator by me.** Two real-phone failures (database locked, null pointer in the SQLite library) were found only by your phone; the fix for the second is unconfirmed.
3. **Tenant isolation and role checks are proven at controller/middleware level (backend tests), not through the real HTTP stack for the endpoints the app uses.** The Restaurant A/B, branch A1/A2/B1/B2 and six-role matrix over HTTP was **not built**.
4. **Google Play prerequisites not done by anyone yet:** developer account, privacy policy page confirmed live, data-safety form, content rating, screenshots from a real phone, production server on HTTPS.

### P1
5. **An offline sale can oversell and be back-dated up to 7 days by any signed-in user who sets the `X-Offline-Sale` header** (by design for the app; also usable from a script). Mitigation to add: record "taken offline" on the invoice and in the audit log, and alert on stock below zero.
6. **A held bill whose reply is lost is held twice** (server and phone). Rare; needs a reconcile step.
7. **Receipts and card/UPI "payments" are recorded by hand; there is no payment gateway in the app.** A cashier can mark UPI paid without money arriving (same as the website).
8. **No refunds/returns, purchases, suppliers, expenses, staff, roles, settings, subscription, Flow AI, notifications, QR ordering admin or loyalty screens in the app.** They exist on the website. The list you gave is therefore mostly **not implemented in the app**; nothing in the app pretends otherwise.
9. **Session expiry while offline:** the 7-day token can expire during a long outage; unsent bills stay and send after sign-in. No refresh-token flow exists (the server issues one 7-day token that slides on app start).
10. **Dev builds block HTTP** now that cleartext is off; use Expo Go or an HTTPS dev server.

### P2
11. Receipt printing uses Android's print dialog (no one-tap Bluetooth ESC/POS).
12. Kitchen and tables poll (8 s / 15 s) while open; no push notifications (not built). The kitchen buzz works only while the screen is open.
13. Screen reader and large-font behaviour were designed for (labels, 44-56 px targets, contrast 4.5:1, text alongside colour) but **not tested with TalkBack or at 200 % font**.
14. Only Hindi is translated; other languages fall back to English.
15. Corrupt-database recovery: a damaged product list is rebuilt automatically; a damaged outbox file is not auto-repaired (it would be reported and needs a manual reset).

### P3
16. No crash-free-rate dashboard; crash reports go to our own endpoint and are viewable by a platform admin only.
17. No certificate pinning (HTTPS only; fine for most apps).
18. Consider moving `current_stock` hints to a per-outlet delta log for very large catalogues.

## Not done, and why
Emulator and Android 13/14/15/16 runs, tablets, gesture vs 3-button navigation, weak-network and packet-loss runs, battery/Doze measurements, device reboot and low-memory runs, release AAB, Play pre-launch report, TalkBack, notifications and deep links (not implemented), Flow AI (not in the app), 10,000-row lists on a phone (tested in Node only: 100,000 products download 2.3 s, search 46 ms, barcode 0.08 ms), Play Billing (the app has no purchases).
Account deletion: the app has no sign-up, so Play's in-app account-creation deletion rule does not apply; deletion is requested through flowxp.in (state this in the data-safety form).
Current Play rules (2026): target API 36 is met in the build; everything else must be checked against Play Console's own current policy pages before submitting, because I did not fetch them in this audit.

## Scores (honest, 0 to 100)
| Area | Score | Why |
|---|---|---|
| Offline | 72 | Bills survive restart and signal loss, tested; no offline edits, one real-phone database bug fixed but unconfirmed |
| Sync | 70 | Idempotent, ordered, retry-safe, parks refusals; no conflict states, no weak-network testing on a device |
| Security | 68 | Secure token storage, no secrets in the app, HTTPS in release, backups off, tenant tests at controller level; no HTTP-level matrix, offline-header abuse open |
| Google Play | 40 | API 36, minimal permissions, listing drafted; accounts, forms, screenshots, release build all pending |
| UX | 70 | Tested for words and structure; not seen by real users beyond your phone |
| Performance | 65 | Node-measured; not on low-end phones |
| **Production readiness** | **55** | **NOT READY** |

## Release gate (all must be true)
- [ ] Release AAB built by EAS, installed, and the core journeys pass on at least two real phones (one low-end) and one tablet.
- [ ] Android 13, 14, 15, 16 each run once (emulator is enough for compatibility).
- [ ] HTTP-level tenant (A1/A2/B1/B2) and role matrix test written and green against the real API.
- [ ] Airplane-mode drill, app-kill-during-send drill and phone-reboot drill done on a device.
- [ ] Production API on HTTPS; privacy policy live; Data Safety and content rating submitted; screenshots uploaded.
- [ ] TalkBack pass and 200 % font pass.
- [ ] Decision on the offline-header abuse (item 5).
