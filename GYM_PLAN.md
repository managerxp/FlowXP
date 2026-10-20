# FlowXP Gym: plan, audit and status

A separate business type, `GYM`, built the way Salon and Hotel were: same tenant / outlet / permission model, a module under `backend/src/modules/gym/*`,
routes `/api/gym/*` (GYM businesses only), web screens under `/app/gym/*`, and a public member page at `/gym/:slug`. Web first: no native app is needed
by anyone (owner, staff or member). A future phone app calls the same API.

## Phase 0: what the repository already gives us (audited 2026-10-12)

| Need | Reused as it is | Gap, built here |
|---|---|---|
| Tenant, outlet, auth, roles | `withBusiness`, `requireOutlet`, `branchFilter`, `ROLE_PERMISSIONS`, per-user overrides, cookie session + CSRF header | Gym roles and permissions; business type `GYM` at signup |
| Gym membership billing | `createInvoiceInTransaction` (custom lines with GST, split payments, idempotency), invoice cancel and credit-note hooks (as Salon does) | A membership row tied to its invoice; payment state is read from the invoice, never copied |
| Member = customer | `customers` (phone, email), invoices, `points_ledger`, messaging opt-out | `gym_members` extends a customer (code, status, emergency contact, consent, restricted health note, family head) |
| Feature gating | `PLAN_FEATURES` keys, `requirePlanFeature`, three admin gates (see memory: feature-gating convention) | Keys `gym_access`, `gym_self_checkin`, `gym_classes`, `gym_rewards`, `gym_devices`; `INDUSTRY_OFF` entries |
| Time | `businesses.timezone`, `businessToday` | `localParts()` in SQL (DST safe), injectable clock for tests |
| Notifications | `modules/notifications.js` (staff), `modules/messaging` (customer WhatsApp/SMS, provider test double) | Gym templates; member OTP |
| Audit | `recordAudit` (fire and forget after commit) | `gym_membership_events` and `gym_access_events` (these are domain records, so they are written inside the transaction) |
| Rate limits, idempotency | `express-rate-limit` in `routes/index.js`, `idempotent()` middleware | Per-phone OTP limits, per-device event idempotency |
| Offline | Offline sales queue exists for the till only | Gym is online-only (see "Offline" below) |
| QR drawing | `qrcode` in the frontend (table QR cards) | Scanner screen uses the browser `BarcodeDetector` API or a USB (keyboard) scanner |
| CI | `backend` job runs `npm test` on a real Postgres; `frontend` builds | New tests follow the same one-throwaway-database-per-file rule |

Not present and not assumed: a customer login (members never had one), a member-facing payment gateway (Cashfree here is only FlowXP billing its own
customers), any gate hardware or vendor documentation.

## Design decisions

- **One decision engine** (`modules/gym/access.js`). Reception, self check-in and gate devices all call `authorize()` then `record()`. The decision, the
  attendance row and (later) the gate command are separate steps so a failure in one can be reconciled.
- **Membership state is derived, not stored.** Stored status is only ACTIVE / CANCELLED / TRANSFERRED. Not started, frozen, expired, in grace, unpaid are computed from
  dates, freezes and the invoice at the gym-local moment of the scan, so nothing goes stale at midnight and no nightly job is needed for correctness.
- **Credentials**: a printed card carries `FXG1.<random 192-bit token>`; only its SHA-256 is stored. A digital pass is a 60-second single-use token
  (`FXD1.<token>`) issued to a signed-in member; a screenshot is useless after a minute or one scan. Nothing about the member is inside any QR.
  A printed card can be lent to a friend: that is a fact of static QR codes, so the controls are staff confirmation, a duplicate cooldown and an impossible-travel check.
- **Entrance QR** is a link to `/gym/in/<token>`. It identifies a gym branch only; it grants nothing. Member must sign in with a phone OTP.
- **Failure is closed.** If the service or database cannot answer, the answer is SERVICE_UNAVAILABLE and no gate opens.
- **Money**: invoice and payments stay in FlowXP's invoice engine. Refund = credit note on the invoice (existing screen); the hook cancels the membership when fully credited.

## Phases

0. Audit (this file)
1. Core: migration 0087, settings, plans, members, memberships (sell, renew, freeze, extend, cancel, transfer), credentials, access engine, attendance. Tests.
2. Reception screen: scanner, manual lookup, attendance and access history, audit.
3. Member web: phone OTP, session, portal, digital pass, self check-in, printed card.
4. Rewards and reminders: points ledger with idempotency, referrals, notifications.
5. Trainers, classes, workout plans, personal-training packs.
6. Gate devices: provider-neutral contract, signed events, a generic signed-HTTP adapter. No vendor adapter without documentation and hardware.
7. Verification, 8. Production readiness and docs.

## Status
See the bottom; updated as each phase lands.

### Done (2026-10-12)
All eight phases have code, screens and tests. What each phase is, where it lives and how it was checked is in `GYM.md`; the device contract is `GYM_DEVICES.md`.

| Phase | Built | Tests |
|---|---|---|
| 1 Core | migration 0087; plans, members (import, export, merge, duplicates, restricted health note), the membership lifecycle on real invoices, credentials, the access engine, attendance, dashboard and reports | `gymCore`, `gymAccess` |
| 2 Reception | `/app/gym/reception`: USB scanner, camera QR (permission and camera-choice handling), lookup with confirmation, auto-hiding results, access log, corrections | `gymAccess`, `gymCore`, browser walk-through |
| 3 Member web | migration 0088; phone-code sign-in, session cookie, phone pass, entrance QR, self check-in with the daily-code and fresh-code controls, printed cards, profile | `gymPortal` |
| 4 Rewards, reminders | migration 0089; the points ledger, referrals, milestones, expiry, redemption, refund reversal, liability report, six reminders | `gymRewards` |
| 5 Trainers, classes | migration 0091; timetable, booking with waitlist, packs, one-to-one sessions, workout plans, goals, measurements, trainer report, member classes page | `gymClasses`, `gymPortal` |
| 6 Devices | migration 0090; signed device requests, decisions kept apart from gate commands, acknowledgements, key rotation, offline events checked afterwards, reconciliation | `gymDevices` |

Checks run: the gym test files (all passing), the full backend suite, `vite build`, and a browser walk-through of the dashboard, front desk (lookup, confirmation, check-in), member page, member web page on a phone-sized view (sign-in, pass QR), classes, rewards and devices screens.
There is no linter or type checker configured in this repository, so none was run.

### Not done or not verified
No gate hardware has been connected (the contract exists, no vendor adapter). No online payment by members. No gym screens in the phone app. Camera scanning was checked in a desktop browser only. See "Known limits" in `GYM.md`.
