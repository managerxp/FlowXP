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
> Create your account in the app and start a 7-day free trial. Your business type switches on the tools it needs: restaurants and cafés (tables, kitchen screen, online orders, deliveries), rooms, guest bills), wholesalers and distributors (orders, credit, warehouse, field sales and vans), pharmacies, salons, gyms (front desk check-in), gaming lounges (station timers), and auto spare parts shops (part numbers, vehicle fitment, racks and bins, receiving).
>
> Some set-up and reports are on the website: card machine connection, gym and lounge set-up, and the full reports.

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

Notifications (Android 13 and later asks the person; the app asks once, in its own words first). Camera (to scan barcodes) and location while the app is open (only for field sales, and only if the business turns on "record where visits happen" on the website: until then the app never asks). There is no background location. The microphone, storage and overlay permissions are blocked in the configuration. A test (`test/release.test.ts`) fails if that changes. **Nearby devices / Bluetooth (added 2026-11-05):** the receipt printer. The app lists the Bluetooth printers already paired with the phone and sends the receipt to the one the person picks. The Bluetooth library also adds the Bluetooth permissions (connect, scan) and a fine-location permission that older Android versions need to find Bluetooth devices; the app uses location only for field-sales visits (above) and never reads the phone's position to find a printer. Nothing about the printer is collected or sent to FlowXP's servers: it is kept on the phone. Mention printing in the listing and the privacy policy, and answer the Play Console permission questions to match. **Files:** the app opens a file only when the person picks one (customer import, backup restore); no storage permission is needed.

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
| **Account creation** | In the app: Start your free trial (name, email, optional mobile, password of 8 or more characters, business name and kind, agree to Terms and Privacy Policy), then a 6-digit email code. Same server rules as the website. Checked live: `mobile/scripts/signup-live.mts`. |
| **Account deletion (in the app)** | Settings, Delete my account: password (and the sign-in code if two-step sign-in is on). The only owner of a business is told to hand it over or leave a request that support follows up. Also a website form for people who cannot sign in: https://flowxp.in/delete-account. **Enter this URL in the Play Console under "Data deletion".** |
| **Problem reports** | "Report a problem" (Settings, More, the error screen) sends what the person types plus the app version, phone type, and their name, email and business so FlowXP can reply. Add this to the privacy policy and to the Data safety form (Personal info and App info and performance: collected, required for the feature, not shared). Kept 180 days. Crash reports stay anonymous and are kept 30 days. |
| **Privacy policy** | https://flowxp.in/privacy, linked on the sign-in screen, the sign-up screen and in Settings. Must describe exactly what the Data safety form says (below), including crash reports, the push address, optional location and the AI assistant. |
| **Data safety form** | Use the table above. Add: **account creation collects name, email, optional phone and the business name** (Personal info, required, linked to the account). All data is encrypted in transit; users can request deletion. Nothing is sold or shared for ads. |
| **Permissions** | Camera (barcode and pass scanning, nothing saved), notifications (asked in the app's own words first), foreground location (only for field-sales visits when the business turns it on). No background location, no storage, no microphone, no overlay (checked in a generated manifest). Fill the Play permissions declaration for location. **Nearby devices / Bluetooth (added 2026-11-05):** the receipt printer. The app lists the Bluetooth printers already paired with the phone and sends the receipt to the one the person picks. The Bluetooth library also adds the Bluetooth permissions (connect, scan) and a fine-location permission that older Android versions need to find Bluetooth devices; the app uses location only for field-sales visits (above) and never reads the phone's position to find a printer. Nothing about the printer is collected or sent to FlowXP's servers: it is kept on the phone. Mention printing in the listing and the privacy policy, and answer the Play Console permission questions to match. **Files:** the app opens a file only when the person picks one (customer import, backup restore); no storage permission is needed. |
| **User-generated content, ads, kids** | No ads, no tracking, no public user content, no chat between users. Target audience 18 and over (business owners and staff). Not a Families app. |
| **Payments policy** | Changed 2026-11-05. Google requires Play Billing for in-app payments for features and cloud software, and forbids in-app buttons, links or messages that lead people to another payment method. So the phone app **shows no prices, no payment button, no payment link and no instruction to pay (not even "pay on the website" or an email to ask for a link)**. Settings, Subscription shows only the status, plan name, trial end date and days left, plus the next billing date when there is one. A write refused because the trial ended says only that the account is not active and changes are paused. Paying happens only outside the app. In Play Console, answer the payments and subscriptions questions as "no in-app purchases". Do not mention prices or how to pay in the store listing or screenshots. |
| **Target API and 16 KB pages** | Google requires new apps and updates to target Android 16 (API 36) since 2026-08-31, and updates to support 16 KB memory pages from 2027-02-01. `app.json` now pins `targetSdkVersion` and `compileSdkVersion` to 36 (React Native 0.86 uses 36 too). After the first store build, check the page size: `zipalign -c -P 16 -v 4 app.apk` ends with "Verification successful", and read Play Console's pre-launch report. |
| **App access for reviewers** | Play needs a login that works. **Create a reviewer account on the production server** (for example a spare parts shop or a café with sample data, using the seed scripts' pattern) and enter its email and password under App content, App access. Do not use a real customer's account. Tell the reviewer in the "App access" notes: "The app has no in-app purchases. Accounts are created and managed by the business owner; the sample account has an active plan so every screen can be reviewed. The app shows plan status only." Give the reviewer account an ACTIVE subscription (not a trial) so no trial-ended message can appear. |
| **Security** | HTTPS only (cleartext off in release builds), no backups of app data, token in the phone's secure storage, no secrets in the app, crash reports carry no personal details. |
| **Content rating** | Questionnaire: utility app, no violence, sexual content, gambling, or user-shared content. Expect Everyone. |
| **Listing** | Text above (updated for all business types), icon and feature graphic ready, **screenshots still to take on a real phone**. |

## Testing it now

Phone (Android) on the same Wi-Fi as this laptop, no accounts needed: install Expo Go, run the API (`backend`, `npm run start`) and `npm run phone` in `mobile/` (it uses `mobile/.env`: `EXPO_PUBLIC_API_URL=http://<laptop IP>:5100`), allow ports 5100 and 8081 in the Windows firewall, and open the QR. Alerts and the camera-free paths work in Expo Go; push alerts need a real build. An installable `.apk` needs your Expo login (`npx eas-cli@latest build --platform android --profile test`): set the API address in the `test` profile of `eas.json` to a server your phone can reach over HTTPS first.


## Play Console account facts (checked 2026-11-05)

- A **personal** developer account made after 2023-11-13 must run a closed test with at least 12 testers who stay opted in for 14 days in a row before it can apply for production. An organisation account is exempt but needs a D-U-N-S number.
- Complete in Play Console: Data safety (with the deletion questions), Advertising ID (answer: not used), Financial features declaration, content rating, target audience, App access (reviewer login) and the privacy policy link.
- Android developer verification: verify the developer identity in Play Console; Play registers its own apps automatically.
- Do not claim any link to GSTN or any government body in the listing.
