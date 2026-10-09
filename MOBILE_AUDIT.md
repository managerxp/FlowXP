# FlowXP mobile: production-readiness audit (2026-10-07)

**Status as of 2026-10-07: NOT READY for the Play Store.** The core (sign in, billing, offline queue, tables, kitchen) is built and tested in code and against the dev server. It has not been run on a release build, on several Android versions, or by real staff. Nothing here is "production ready" until the gate at the bottom is met.

What was and was not checked is stated per item. "Verified" = I ran it. "Reasoned" = read from code only. "Not done" = needs something I do not have here (emulator, signing keys, Expo/Play accounts, a second phone).

## Re-audit 2026-10-08 (after the wholesale, pharmacy, salon, field, UX and Flow AI work)

**Status: still NOT READY.** The items that need an account, a signing key, a device or a hosted server are unchanged (see the gate at the bottom). What I could check and fix here is below.

**Verified (I ran it)**
- `npm run release:check` is green: typecheck, accessibility scan (new), 224 mobile tests, `expo-doctor` 21/21, Android bundle export. Backend: 981 tests pass.
- Manifest (from `expo prebuild`, then removed): permissions are CAMERA, INTERNET, VIBRATE only; storage, microphone and overlay are removed; `allowBackup=false`, `usesCleartextTraffic=false`, R8 minify and resource shrinking on, predictive back off, orientation unspecified (tablets and rotation work), `adjustResize` for the keyboard. Two intent filters on the main screen: the launcher and the `flowxp://` link.
- Assets: icon, splash, adaptive foreground and monochrome are all 1024 px; store icon 512 and feature graphic 1024x500 are in `mobile/store`.
- No secrets or keys in the app source; the only `http://` is the dev default `10.0.2.2` (the release profiles use `https://flowxp.in`); no `console.log`; no `__DEV__` branches.
- Dependencies: `npm audit --omit=dev` reports 26 (15 high). All are in build tools (Metro, `@expo/cli`, `braces`, `micromatch`, `node-forge` through the code-signing helper) or in packages that carry them (`expo`, `react-native`, `expo-router`, `expo-updates`); none is in code the phone runs, except `decode-uri-component` / `query-string` (a malformed link could waste CPU: needs someone to open a crafted `flowxp://` link). They cannot be cleared without moving off Expo SDK 57. Re-check when upgrading the SDK.

**Fixed now**
- 16 touch targets were 44 px; Android's minimum is 48. All raised to 48 (steppers, chips, hint buttons, sync line, kitchen undo).
- 6 controls had no role or label for TalkBack (menu tiles, quantity steppers, close, waiting rows). Fixed. `npm run a11y` (`scripts/a11y-scan.cjs`) now fails if a Pressable has no role or a text box has no label, and runs inside `release:check` (177 controls, 0 missing).
- `STORE.md` data-safety draft was out of date (said customers were not in the app). Corrected, and Flow AI added (see P1).

**Added later the same day: location.** Field sales can now record where a visit happened (`expo-location`, foreground only, no background permission; verified in a generated manifest: ACCESS_COARSE_LOCATION and ACCESS_FINE_LOCATION appear besides CAMERA, INTERNET, VIBRATE). It is asked for only in a business that turned on "record where visits happen", only when a visit is recorded, and a refusal or a slow fix just records the visit without a place. **Play must be told:** Data Safety needs Location (approximate and precise) collected, optional, not shared; the privacy policy must say it; the Play permission declaration for location needs a reason (field visit proof). Drafted in `mobile/STORE.md`; owner task.

**New findings**
- **P1: privacy policy and Data Safety must be updated before submitting.** (a) The app now holds customers' names, phone numbers and what they owe, suppliers, expenses and stock. (b) Flow AI sends the question and business figures from our server to the AI provider; the website privacy policy does not mention AI processing. Play treats a service provider acting for you differently from "sharing", but the policy must say it. Owner/legal task. The draft answers are in `mobile/STORE.md`.
- **P1: `MOBILE_AUDIT` item 8 is out of date.** In the app now: returns and credit notes, purchase orders and goods received, suppliers, price lists, stock transfers, field sales, van sales, warehouse, medicines, salon, customer dues, Flow AI. Still website-only: staff and roles, business settings, subscription, notifications, QR ordering admin, loyalty.
- **P2 (done 2026-10-09): `expo-updates` removed** (it was switched off and is one of the audit's flagged packages). Fixes now ship only as store builds.
- **P2 (done 2026-10-09): the `flowxp://` link removed.** Nothing in the app, website, backend or emails used it; the app still opens web links and phone calls with the system.
- **P2: the phone database is not encrypted** (customer names and phones, bills). The Android sandbox and device encryption protect it and backups are off. SQLCipher is possible later.
- **P2: 16 KB memory pages.** Play requires 16 KB support for new releases. Expo SDK 57 / React Native 0.86 ship aligned libraries (reasoned, not checked). Confirm in the Play pre-launch report.
- **P2: the Flow AI answer text and the "What happened" sentences on Reports are English only** (they contain names and figures).

**Scores now:** Google Play 45 (was 40), UX 74 (was 70), Security 68, Offline 74, Sync 70, Performance 65. **Production readiness 58: NOT READY.**

---

## First audit 2026-10-07 (kept for the record)

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
5. **An offline sale can oversell and be back-dated up to 7 days by any signed-in user who sets the `X-Offline-Sale` header** (by design for the app; also usable from a script). **Now:** the date is limited to 7 days back and 1 ahead (anything else is dated today), and every such sale is written to the audit log as offline with the day the phone claimed (`scripts/security/offline.mjs`). Stock below zero shows on the shelf and in Flow AI's findings; there is no separate alert.
6. **A held bill whose reply is lost is held twice** (server and phone). Rare; needs a reconcile step.
7. **Receipts and card/UPI "payments" are recorded by hand; there is no payment gateway in the app.** A cashier can mark UPI paid without money arriving (same as the website).
8. **No refunds/returns, purchases, suppliers, expenses, staff, roles, settings, subscription, Flow AI, notifications, QR ordering admin or loyalty screens in the app.** They exist on the website. The list you gave is therefore mostly **not implemented in the app**; nothing in the app pretends otherwise.
9. **Session expiry while offline:** the 7-day token can expire during a long outage; unsent bills stay and send after sign-in. No refresh-token flow exists (the server issues one 7-day token that slides on app start).
10. **Dev builds block HTTP** now that cleartext is off; use Expo Go or an HTTPS dev server.

### P2
11. Receipt printing uses Android's print dialog (no one-tap Bluetooth ESC/POS).
12. Kitchen and tables poll (8 s / 15 s) while open. **Push alerts built 2026-10-09** (new guest or delivery order, dish ready, booking, stock): working end to end against a stand-in for Expo (`backend/scripts/push.mjs`); not yet tried on a real phone, which needs the Firebase steps in `mobile/STORE.md`. The kitchen buzz in the open screen is unchanged.
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
