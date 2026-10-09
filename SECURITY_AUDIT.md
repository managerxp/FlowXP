# FlowXP security audit (2026-10-08)

Scope: the API (`backend`), the website (`frontend`), the deployment files (`deploy`), and the mobile app (`mobile`). Method: code review, automated checks, and live attacks against a running development server with the demo data. This replaces nothing in `SECURITY.md` (the standing checklist); it records what was tested, what was found, and what was fixed.

**Not a penetration test.** Things only a person with the real production setup can check are listed at the end. Get an outside pen-test before taking payments at scale.

## Result in one paragraph

The foundations are sound: no SQL injection, no way for one business to read or change another's records in anything tested, no forgeable tokens, sound sign-in, secrets out of the repository. The audit found **one family of real defects in bill creation (fixed)**, **one cross-business file-deletion path (fixed)**, **secrets written to logs (fixed)**, **one flagged dependency (fixed)**, and a set of **decisions for you** about what each staff role may see and do. Nothing found lets an outsider reach another business's data.

## What was tested, and how

| Area | How | Result |
|---|---|---|
| Public attack surface | Walked all 622 routes; 26 need no sign-in | All 26 are deliberate (login, signup, reset, QR menu and bill links, salon booking, webhooks, crash reports, plans, contact). Every one has a rate limit or a secret token. |
| One business reading another's data | Signed in as two different restaurants; every record of A requested by B (reads and edits), invoices, customers, products, orders, suppliers, tables, staff, held bills; plus an 8-record automatic sweep | **Refused every time** (404). Two edit routes answered 400 because input is checked before ownership; their code was read and both scope the change to the business in SQL. |
| Same, in code | Read the ownership step of the riskiest handlers (reservations, reviews, commission payouts, bill splitting and merging, waiter assignment) | Each loads the record scoped to the business first. 229 UPDATE/DELETE statements update by id after such a lookup (listed by `scripts/security/sql.mjs`); that pattern is only as safe as the lookup before it, which is why a new route needs the same test. |
| Staff roles | Weakest role (kitchen) called all 622 routes at records that do not exist; a waiter likewise | Kitchen: 235 forbidden, 304 "not found" (modules a restaurant does not have), the rest are its own screens and shared basics. Waiter: only what its role is for. |
| Platform admin | A normal owner called six admin routes | All 403. Admin routes require super-admin and, in production, two-step verification. |
| SQL injection | Searched for request values in SQL text, dynamic sort/column names, and injection strings in login | None. Everything is parameterized; every sort or column choice comes from a fixed list. |
| Tokens and sessions | Forged "alg none", changed payload, guessed secret, expired, missing | All refused. Tokens pinned to HS256 with a session version (password change or "sign out everywhere" ends all sessions). |
| Cross-site forgery | A POST with the session cookie but without the app's header | Refused (403). Cookie is httpOnly, SameSite=Lax, Secure in production. |
| CORS, headers, errors | Probed with a foreign origin, bad JSON, a 2 MB body | Foreign site gets no access; nosniff, no framing, no-store; plain 400/413; no stack traces; no `X-Powered-By`. |
| Path traversal and secrets in the web root | Six traversal forms on `/uploads`, `/.env`, `/.git` | Nothing served. |
| Rate limiting | Seven password-reset requests from one address | Sixth is refused (429). Login, signup, contact, AI, public ordering all have limits. |
| Passwords and codes | Read sign-in code | bcrypt cost 12; equal-time answer for unknown emails; generic replies; 5 wrong tries lock an account for 15 minutes (also for reset codes); reset codes hashed and single-use. |
| Uploads | Read upload code | Images only (JPEG/PNG/WebP, no SVG), first-bytes check, size limits, served with a sandbox policy. |
| Cross-site scripting (website) | Searched for raw HTML insertion | Two places write HTML (QR cards, barcode labels); both escape names and codes. No token in browser storage. |
| Server-side request forgery | Listed every outbound call | Only fixed provider addresses (AI, messaging, Google sign-in, Cashfree). No user-supplied address is fetched. |
| Secrets in the repo | Scanned files and all history for env files and key patterns | No env file ever committed; the only hit is AWS's published example key in a test. Local `.env` is ignored. |
| Dependencies | `npm audit --omit=dev` | Frontend: 0. Backend: 1 critical (`proxy-addr`) now fixed, 0 left. Mobile: 26, all build tools or packages that carry them (see `MOBILE_AUDIT.md`). |
| Money tampering | Tried negative and oversized discounts, negative price and GST, absurd quantity on a real till | **Several accepted before the fix (see F1).** All refused now. |

## Fixed during the audit

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | **Medium** | A person with only the billing right could create bills that were worth less than they should: a discount larger than the bill zeroed it and recorded a ₹100,000 "discount" on a ₹94 sale (which also corrupts discount reports); a negative discount raised the price; a negative GST rate on a custom line cut the total (₹100 became ₹50) and wrote negative tax into GST reports; a huge quantity caused a server error. | `modules/billing.js` now refuses: negative or over-line line discounts, a bill discount above the bill or negative, a negative custom price, a GST rate outside 0 to 100, and quantities over a million. Verified live. |
| F2 | **Low-Medium** | The photo and logo address fields accept typed text. A business could point its own field at another business's public photo address, then replace or remove its own photo, and the server would delete the other business's file (local storage). | `removeFile` now only deletes inside the caller's own folder (`products/<id>/`, `logos/<id>/`). Test added. |
| F3 | **Low** | The request log wrote the full address, which for QR menu, bill and delivery-webhook links contains the secret token. Anyone reading logs could place orders for a table or post fake delivery orders. | The log now writes the route pattern (`/public/menu/:token`), never the real address. |
| F4 | **Low (critical by label)** | `proxy-addr` (used by Express to read client IPs) had an IP-spoofing advisory. The app sets trust-proxy to one hop, not a subnet, so exposure was limited. | Updated to 2.0.8 (`npm audit fix`); backend audit clean. |
| F5 | **Medium (app only)** | The mobile app showed every screen to every role, including the kitchen cook, because the server sent only a person's *overrides*, not what their role allows. The server always refused the actual calls, so no data was exposed, but staff were shown things they could not use. | `/auth/me` now also sends `effective_permissions`; the app uses it. Proven over HTTP for six roles. |
| F6 | **Medium** | (was O1) Billing staff could cancel any bill and give any discount, unlimited and unapproved. **Fixed:** cancelling a bill needs a reason and a manager's PIN, and a typed-in discount above the business's limit (default 20% of the bill, line discounts, bill discount and prices typed below catalogue combined) needs one too. Owners, admins and managers (right `approvals`) are free; they set a 4-8 digit PIN in Security. Five wrong PINs lock the person for 15 minutes; every approval is audited. The owner changes the limit and the cancel rule in Security. Drilled live in `scripts/security/approvals.mjs` (counter, pharmacy till, cancel) and `approvals2.mjs` (a table's bill, the salon till). A web sale queued offline with a big discount is refused when it replays, and shows as needing attention. | Done |
| F7 | **Medium-Low** | (was O2) A waiter's or cashier's product list carried the purchase price, so staff could see margins. **Fixed:** the product list, product, barcode and code lookups drop `purchase_price`, `unit_cost`, `margin_pct` and `cost_source` unless the person holds products, inventory, purchases or reports. Checked per role in `scripts/security/cost.mjs`. Other catalogues (pharmacy, salon, wholesale) are separate endpoints and were not changed. | Done |
| F8 | **Low** | (was O5) The Cashfree webhook had no freshness check, so a captured valid event could be replayed. **Fixed:** an event whose timestamp is more than 15 minutes old is refused (milliseconds or seconds both read). | Done |
| F9 | **Low** | (was O8) Passwords only needed 8 characters. **Fixed:** new passwords need 10 and may not be an obvious one (password123, 1234567890, one character repeated). Existing passwords keep working until changed. | Done |
| F10 | **Info** | (was O12) Opening the cash drawer without a sale left no trace. **Fixed:** each use is audited as `drawer.opened`. | Done |
| F11 | **Low** | (was O7) Public salon booking confirms by message to whatever number is typed, at the salon's cost. **Fixed:** a number can be booked online at most 4 times in 24 hours across all salons, cancelled or not (on top of the existing 3 open bookings per salon and 12 an hour per address). Checked in `scripts/security/booking.mjs`. A one-time code or CAPTCHA would be stronger but needs an SMS provider and a decision on cost. | Done |
| F12 | **Low** | (was O6) Anyone with a photo of a table's QR code could order remotely, with no limit on size (a quantity of 500 was accepted) beyond 20 requests per 10 minutes per address. **Fixed:** one guest order is at most 30 lines, 20 of a dish and 60 portions in all, and one table accepts at most 12 guest orders an hour from any number of devices. Checked in `scripts/security/qrorder.mjs`. Still open by choice: a rotating table code or staff confirmation of the first order would stop remote ordering outright, but changes how guests order, so it is your call. | Done (partly) |
| F13 | **Low-Medium** | (was O3) A waiter or cook was sent the day's takings, yesterday's, unpaid dues and the plan price. **Fixed:** `/dashboard` sends no figures to anyone without reports, payments, customers, purchases or settings (so not waiter or kitchen; the cashier keeps them), and the plan price and pending payment link go only to people with settings. The website shows such a person a plain greeting with their way to work; the mobile app already showed a notice. Checked per role in `scripts/security/revenue.mjs`. | Done |
| F14 | **Low** | (was O10) Stored 2FA secrets and payment/email/messaging keys were encrypted with a key taken from `JWT_SECRET`, so rotating that secret would lock 2FA users out. **Fixed, opt-in:** set `ENCRYPTION_KEY` (32+ characters) and new values use it; everything stored earlier keeps reading. `node scripts/reencrypt-secrets.mjs` moves the existing ones across (`--dry` to preview). Until you set the key nothing changes. Unit-tested; the move itself was only dry-run against the demo data. | Done (needs your key) |

## Open: decisions and recommendations

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| O4 | **Low** | **Delivery-platform webhooks (Swiggy, Zomato, magicpin, ONDC) are not signature-checked.** Each adapter's check is hard-coded to `true`; the only protection is a 160-bit random token in the address. Fine while they are mocks. | Before connecting a real platform, implement that platform's signature check and add a way to rotate the token. |
| O9 | **Low** | The app's own rate-limit counters live in server memory: they reset on restart and are not shared if you run more than one instance. **Partly fixed:** `deploy/nginx.conf` now adds a limit per address in front of the app (30 requests a second for the API, 5 for sign-in and password routes, with bursts), which survives restarts. Not tested here: nginx is not installed on this machine, so run `sudo nginx -t` before reloading. | Move the app's own counters to Redis when you run more than one server. |
| O11 | **Low (accepted)** | Sessions last 7 days from the last use, not from sign-in: the website keeps its session in an HttpOnly cookie and the mobile app gets a fresh token each time it opens (`/auth/me`), so it slides while in use and lapses after 7 idle days. Changing the password or using "sign out everywhere" ends every session at once. A stolen token works until then, and the server cannot yet tell which device is which. An account can still be locked for 15 minutes by someone who knows the email (see `SECURITY.md`). | A full refresh-token scheme (short access tokens, a per-device list you can revoke) is worth building only if staff phones are lost often; it changes login on both apps. Shortening `JWT_EXPIRES_IN` is a one-line change but logs out phones that stay offline longer than it. |
| O13 | **Info** | A retried request with the same Idempotency-Key returns the stored answer to any user of the same business (not across businesses). | Acceptable; scope by user if it ever carries personal data. |

Mobile items (unencrypted local database, the `flowxp://` link, build-tool audit warnings, permissions for Play) are in `MOBILE_AUDIT.md`.

## Not covered (needs the real setup, or a person)

- **Production mode.** The server was tested in development. HSTS, strict secret-length checks, and trust-proxy only apply with `NODE_ENV=production` behind nginx and HTTPS; confirm them on the live host (`curl -I https://flowxp.in/api/plans`).
- TLS settings, the database host (private network, strong password, backups with a restore test), where secrets live on the server, and file permissions.
- Other business types across businesses: the café/restaurant pair was tested end to end. Wholesale, salon and pharmacy use the same sign-in and business-resolution code and were reviewed, but the demo has one business of each, so no second-business test was possible.
- A browser-based test of the website (click-through for script injection, clickjacking, service-worker caching), real Cashfree signatures, the S3 bucket policy, the print agent, and third-party providers.
- Social engineering, physical access to staff phones, and denial-of-service at network level.

## Re-running the checks

`backend/scripts/security/` holds the scripts used here, with a README. After any change to billing, permissions, uploads or routes, run `routes.mjs`, `tenants.mjs`, `roles.mjs`, `probes.mjs` and `tamper.mjs` against a development server. Backend tests (985) and mobile tests (260) pass with these fixes.
