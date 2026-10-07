# FlowXP: pick up on another laptop

Written 2026-10-07. Read this first on a new machine, then `brain.md` (project memory) and `MOBILE.md` (mobile app plan and status).

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
4. Expo account: `npx eas-cli login`, `eas init`, `eas update:configure`; first preview build (also confirms R8 shrinking, which was switched on untested); then Play Console (see `mobile/STORE.md`).
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
