# FlowXP on Google Play: listing and release checklist

Drafts for the owner to review. The data-safety answers are declarations to Google: check each against what you actually do before submitting.

## Listing

**App name** (30 characters at most): `FlowXP: Billing & Inventory`

**Short description** (80 at most): `Fast billing for shops, cafés and restaurants. Keeps working with no internet.`

**Full description** (4,000 at most):

> FlowXP is the billing app for your counter. Scan or search, take cash, UPI or card, and hand over the bill. If the internet drops, keep selling: every bill is saved on the phone and sent to FlowXP by itself when the signal is back, once and in order.
>
> For shops and supermarkets
> - Scan barcodes with the phone camera, or search by name
> - Your whole product list is kept on the phone, so searching is instant even with thousands of products
> - GST worked out for you; the bill you hand over is the one FlowXP makes
>
> For cafés and restaurants
> - Choose size, milk, sugar and add-ons for each drink, with the price changing as you tap
> - Send the order to the kitchen or barista screen and call out the token number
> - Offers (such as a happy hour or any 2 bakes for one price) are shown before you take payment
>
> Works with no internet
> - Bills made offline are marked "pending", then sent automatically with their real bill numbers
> - A sale is never made twice, even if the signal drops at the worst moment
> - A bill FlowXP refuses stays on the phone with the reason, for you to decide
>
> Print or share
> - Print the receipt to any printer your phone can reach, 58 mm or 80 mm paper, or share it
>
> Create your account in the app and start a 7-day free trial, no card needed. Your business type switches on the tools it needs: restaurants and cafés (tables, kitchen screen, online orders, deliveries), hotels (front desk, rooms, guest bills), wholesalers and distributors (orders, credit, warehouse, field sales and vans), pharmacies, salons, gyms (front desk check-in), gaming lounges (station timers), and auto spare parts shops (part numbers, vehicle fitment, racks and bins, receiving).
>
> Some set-up and reports are on the website: card machine connection, hotel night audit and banquets, gym and lounge set-up, and the full reports.

**Category:** Business. **Tags:** point of sale, billing, inventory, GST. **Contact:** the support email on flowxp.in. **Website:** https://flowxp.in. **Privacy policy:** https://flowxp.in/privacy

## Assets

| Asset | File | Status |
|---|---|---|
| App icon 512x512 | `store/icon-512.png` | ready |
| Feature graphic 1024x500 | `store/feature-graphic-1024x500.png` | ready |
| Phone screenshots (2 to 8, 9:16, at least 320 px) | | **to take on a real phone** |

Suggested screenshots: the till with a bill and an offer line; the options picker (Large, Oat, Extra shot); the pay screen with the UPI QR; the receipt with its token; the till showing "3 sales waiting to be sent" (the offline story); the Sales screen after they were sent.

## Content rating (questionnaire)

Utility / business app. No violence, sexual content, gambling, user-generated content shared between users, or location sharing. Expect "Everyone".

## Data safety (draft)

| Question | Answer |
|---|---|
| Does the app collect or share user data? | Collects: yes. Shares with third parties: no. (FlowXP's own servers are the app's backend, not a third party.) |
| Personal info | Name, email address, phone number (account); the business's customers' and suppliers' names, phone numbers and what they owe (entered by the business). |
| Financial info | Purchase history: the bills made in the app. No card numbers are collected or stored: card payments are recorded as "paid by card" with an optional slip number. |
| Device or other IDs | The phone's notification address (a code Expo's push service gives this install), kept on FlowXP's servers with the person's account so alerts reach their phone. Collected only if the person turns alerts on; removed when they turn them off or sign out. Used only to send FlowXP's own alerts: no ads, not shared, not sold. |
| App activity / diagnostics | Crash and error reports: the error text, screen, app version, OS version and a 3-letter phone code. No name, email or business. |
| Photos and videos | No. The camera is used live to read barcodes; nothing is saved or uploaded. |
| Data encrypted in transit | Yes (HTTPS). |
| Can users request data deletion? | Yes. Web link for the form: https://flowxp.in/delete-account (also reachable from Settings in the app). Signed-in people can delete their own account from Security on the website; others can ask, and support confirms by email before deleting. The business keeps its own bills and records. |
| Data collection is | Required for the app to work (sign-in and sales); crash reports are not optional in this version. |
| Location | Approximate and precise location, only for field-sales staff in a business that has switched on visit places, only while the app is open, only at the moment a visit is recorded. It is stored with that visit on FlowXP's servers so the business can see where visits happened. Not shared, not used for ads, not collected in the background. The person can say no and keep working. |
| Ads / tracking | None. |
| Flow AI (an optional assistant) | When a person asks Flow AI a question, the question and figures from the business's own records go from FlowXP's server to an AI service provider to write the answer. The provider acts for FlowXP and does not use it for ads. State this in the privacy policy before submitting; the business can switch it off. |

## Permissions in the build

Notifications (Android 13 and later asks the person; the app asks once, in its own words first). Camera (to scan barcodes) and location while the app is open (only for field sales, and only if the business turns on "record where visits happen" on the website: until then the app never asks). There is no background location. The microphone, storage and overlay permissions are blocked in the configuration. A test (`test/release.test.ts`) fails if that changes.

## What only you can do

0. **Phone alerts need Firebase** (Google's service that actually delivers them to Android; Expo passes ours to it). Once: (a) create a Firebase project and add an Android app with package `com.flowxp.app`; (b) in `mobile/`, run `npx eas-cli init` (this adds the project id the app reads); (c) Firebase > Project settings > Service accounts > generate a private key, then `npx eas-cli credentials` > Android > Google Service Account Key for Push Notifications (FCM V1) > upload it; (d) download `google-services.json` from Firebase into `mobile/` and add `"googleServicesFile": "./google-services.json"` under `android` in `app.json` (it is safe to commit, but not before the file exists, or the build fails). Without these the app still works; alerts just say "not available in this build". On the server nothing is needed (`PUSH_ENABLED=true` is the default); `EXPO_ACCESS_TOKEN` only if you turn on "enhanced push security" in Expo.

1. **Expo account**, then in `mobile/`: `npx eas-cli@latest login`, `npx eas-cli@latest init` (creates the project id).
2. **Google Play Console developer account** (a one-time fee, identity checks that can take days). Create the app with the package name `com.flowxp.app`.
3. **Play service-account key** for uploads: save as `mobile/play-service-account.json` (already ignored by git).
4. **First build to test**: `npx eas-cli@latest build --platform android --profile preview` gives an installable `.apk`. Try it on real phones (camera, airplane-mode drill, printer) before the store build.
5. **Store build**: `npx eas-cli@latest build --platform android --profile production`, then `npx eas-cli@latest submit --platform android --profile production` (it lands as a draft in the internal track; you press release).
6. **Production server**: `https://flowxp.in` must be live with HTTPS, the migrations (up to 0100) applied, and `ADMIN_REQUIRE_2FA` on. The profiles point the app at `https://flowxp.in`.
7. Take the screenshots, fill in the store listing from this file, submit the data-safety form and content rating.

## Shipping a fix

Every change goes out as a new store build (raise the version, build, submit). Over-the-air updates were removed on 2026-10-09 (`expo-updates` is no longer installed), so a store release is the only way a phone gets new code. The channels in `eas.json` are left over and do nothing.

## Before every release

```bash
cd mobile && npm run release:check
```

Runs the typecheck, all tests, `expo-doctor` and a full Android bundle. After the build is installed on a phone, run the checklist in `MOBILE.md` (section "Try it on a phone").


## Google Play policy checklist (2026-10-13)

What the app and server already do, and what only you can do. "Checked" means it was run or read in the code on 2026-10-13; nothing here was tested on a Play review device.

| Policy area | State |
|---|---|
| **Account creation** | In the app: Start your free trial (name, email, optional mobile, password of 10 or more characters, business name and kind, agree to Terms and Privacy Policy), then a 6-digit email code. Same server rules as the website. Checked live: `mobile/scripts/signup-live.mts`. |
| **Account deletion (in the app)** | Settings, Delete my account: password (and the sign-in code if two-step sign-in is on). The only owner of a business is told to hand it over or leave a request that support follows up. Also a website form for people who cannot sign in: https://flowxp.in/delete-account. **Enter this URL in the Play Console under "Data deletion".** |
| **Problem reports** | "Report a problem" (Settings, More, the error screen) sends what the person types plus the app version, phone type, and their name, email and business so FlowXP can reply. Add this to the privacy policy and to the Data safety form (Personal info and App info and performance: collected, required for the feature, not shared). Kept 180 days. Crash reports stay anonymous and are kept 30 days. |
| **Privacy policy** | https://flowxp.in/privacy, linked on the sign-in screen, the sign-up screen and in Settings. Must describe exactly what the Data safety form says (below), including crash reports, the push address, optional location and the AI assistant. |
| **Data safety form** | Use the table above. Add: **account creation collects name, email, optional phone and the business name** (Personal info, required, linked to the account). All data is encrypted in transit; users can request deletion. Nothing is sold or shared for ads. |
| **Permissions** | Camera (barcode and pass scanning, nothing saved), notifications (asked in the app's own words first), foreground location (only for field-sales visits when the business turns it on). No background location, no storage, no microphone, no overlay (checked in a generated manifest). Fill the Play permissions declaration for location. |
| **User-generated content, ads, kids** | No ads, no tracking, no public user content, no chat between users. Target audience 18 and over (business owners and staff). Not a Families app. |
| **Payments policy** | The app has **no in-app purchase and shows no prices or payment screens**. A trial ends on the server and the app shows the server's plain message. The paid plan is bought on the website. Play's payments rules for apps used with a paid account are your decision to check with Google before launch: if Google asks, either keep the app a companion to a service bought outside it (as now), or add Google Play Billing. Do not add "buy" buttons or price lists to the app without deciding this. |
| **Target API and 16 KB pages** | Expo SDK 57 / React Native 0.86 target a current Android level and ship 16 KB aligned libraries (reasoned; confirm in the Play pre-launch report). |
| **App access for reviewers** | Play needs a login that works. **Create a reviewer account on the production server** (for example a spare parts shop or a café with sample data, using the seed scripts' pattern) and enter its email and password under App content, App access. Do not use a real customer's account. |
| **Security** | HTTPS only (cleartext off in release builds), no backups of app data, token in the phone's secure storage, no secrets in the app, crash reports carry no personal details. |
| **Content rating** | Questionnaire: utility app, no violence, sexual content, gambling, or user-shared content. Expect Everyone. |
| **Listing** | Text above (updated for all business types), icon and feature graphic ready, **screenshots still to take on a real phone**. |

## Testing it now

Phone (Android) on the same Wi-Fi as this laptop, no accounts needed: install Expo Go, run the API (`backend`, `npm run start`) and `npm run phone` in `mobile/` (it uses `mobile/.env`: `EXPO_PUBLIC_API_URL=http://<laptop IP>:5100`), allow ports 5100 and 8081 in the Windows firewall, and open the QR. Alerts and the camera-free paths work in Expo Go; push alerts need a real build. An installable `.apk` needs your Expo login (`npx eas-cli@latest build --platform android --profile test`): set the API address in the `test` profile of `eas.json` to a server your phone can reach over HTTPS first.
