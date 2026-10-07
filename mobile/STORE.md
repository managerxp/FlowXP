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
> You need a FlowXP account. Start a 7-day free trial at flowxp.in.
>
> Not in this app yet: table orders, held bills, customer lookup, and card machine connection. They are on the FlowXP website till.

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
| Personal info | Name, email address, phone number (account); the business's customers' names and phone numbers, only if a sale is linked to a customer (not in this version of the app). |
| Financial info | Purchase history: the bills made in the app. No card numbers are collected or stored: card payments are recorded as "paid by card" with an optional slip number. |
| App activity / diagnostics | Crash and error reports: the error text, screen, app version, OS version and a 3-letter phone code. No name, email or business. |
| Photos and videos | No. The camera is used live to read barcodes; nothing is saved or uploaded. |
| Data encrypted in transit | Yes (HTTPS). |
| Can users request data deletion? | Yes, through FlowXP support and the account settings on flowxp.in. |
| Data collection is | Required for the app to work (sign-in and sales); crash reports are not optional in this version. |
| Ads / tracking | None. |

## Permissions in the build

Camera only (to scan barcodes). The microphone, storage and overlay permissions are blocked in the configuration. A test (`test/release.test.ts`) fails if that changes.

## What only you can do

1. **Expo account**, then in `mobile/`: `npx eas-cli@latest login`, `npx eas-cli@latest init` (creates the project id), `npx eas-cli@latest update:configure` (adds the updates URL to `app.json`).
2. **Google Play Console developer account** (a one-time fee, identity checks that can take days). Create the app with the package name `com.flowxp.app`.
3. **Play service-account key** for uploads: save as `mobile/play-service-account.json` (already ignored by git).
4. **First build to test**: `npx eas-cli@latest build --platform android --profile preview` gives an installable `.apk`. Try it on real phones (camera, airplane-mode drill, printer) before the store build.
5. **Store build**: `npx eas-cli@latest build --platform android --profile production`, then `npx eas-cli@latest submit --platform android --profile production` (it lands as a draft in the internal track; you press release).
6. **Production server**: `https://flowxp.in` must be live with HTTPS, the migrations (up to 0076) applied, and `ADMIN_REQUIRE_2FA` on. The profiles point the app at `https://flowxp.in`.
7. Take the screenshots, fill in the store listing from this file, submit the data-safety form and content rating.

## Shipping a fix without the store (over-the-air)

A change to the app's JavaScript can reach phones without a new store release: `npx eas-cli@latest update --channel production --message "what changed"`. It reaches only builds with the same app `version` (the runtime version policy), and is picked up the next time the app opens (Settings > Check for an update does it at once). A change that adds a native library needs a new store build.

## Before every release

```bash
cd mobile && npm run release:check
```

Runs the typecheck, all tests, `expo-doctor` and a full Android bundle. After the build is installed on a phone, run the checklist in `MOBILE.md` (section "Try it on a phone").
