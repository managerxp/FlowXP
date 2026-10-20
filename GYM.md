# FlowXP Gym

A business type `GYM`, built like Salon and Hotel on the same tenant / outlet / permission model: `backend/src/modules/gym/*`, routes under `/api/gym` (staff), `/api/public/gym` (members on their own phone) and
`/api/device/v1` (gate devices), screens under `/app/gym/*`, and a public member page at `/gym/:slug`. Web first: nobody needs a native app. The plan, audit and status are in `GYM_PLAN.md`; the hardware contract is `GYM_DEVICES.md`.

Try it: `cd backend && npm run seed:gym`, then sign in as `gym@flowxp.test` / `demo1234` (staff `gym-manager@`, `gym-desk@`, `gym-trainer@`). Members sign in at `/gym/ironworks` with a code sent to their phone; with no messaging provider set up
locally run `node scripts/gym-dev-login.js ironworks 9845000001` to put a known code in the database (it refuses to run in production).

## Turning it on

1. Business type `GYM` (a choice at sign-up; the admin console can set it on an existing business). Plan features, each its own switch (by plan, by business type and per business, see `modules/planFeatures.js`): `gym_access` (QR cards, reception scanning, attendance),
   `gym_self_checkin` (members' own page), `gym_classes` (trainers, classes, packs, workout plans), `gym_rewards`, `gym_devices`. Members, plans and memberships need none of them. Other business types have all five switched off by default.
2. Migrations `0087` to `0091` run at boot (forward only; the rollback of each is written in its header comment, never to be run on a live gym).
3. *Gym settings > Rules*: the web address (`public_slug`), the member number prefix, the grace days, the repeat-scan wait, whether phone check-in is on, and the class rules. *Branches and QR*: opening hours, holidays, and the entrance poster.
4. For members to sign in, **messaging must be set up** (Super Admin > Settings > Messaging: WhatsApp Cloud or Twilio SMS). The sign-in code is sent straight through the provider and is never stored or logged. Without a provider no code reaches anyone and members cannot sign in on their own.
5. Staff roles: `GYM_RECEPTIONIST` (permissions `gym_desk`, `gym_members`), `TRAINER` (`gym_trainer`); owner, admin and manager hold all four of `gym_desk`, `gym_members`, `gym_setup`, `gym_trainer`. A per-person override works both ways.

Environment: no new variables are required. `ENCRYPTION_KEY` (already supported) is recommended in production: device secrets are encrypted under it. `APP_ORIGIN` (https in production) is the base of the entrance QR link.

## Who may do what

| | gym_desk | gym_members | gym_setup | gym_trainer |
|---|---|---|---|---|
| Scan, check in by lookup, daily code, turn a member away, read the access log | yes | | yes | |
| Register and edit members, change a member's status | | yes | yes | |
| Sell, renew, change plan, freeze | yes | | yes | |
| Discount, free membership, add days, cancel, transfer, merge, import, corrections | | | yes | |
| Plans, settings, branch hours, entrance QR, devices, rewards rules, reminders | | | yes | |
| Redeem points, fulfil a reward | yes | | yes | |
| Workout plans, goals, measurements, health notes | | | yes | yes (their assigned members only) |

A trainer's login (`TRAINER`, with only `gym_trainer`) sees only the members assigned to them and not their phone or email. Anyone limited to one outlet sees that outlet's members and members whose plan is valid there; asking for another outlet's member by id is a 404.
Another business's anything is always a 404. The restricted health note is never returned to the desk.

## Membership and money

A member is a `customers` row plus a `gym_members` row. A sale is `createInvoiceInTransaction` (GST, split payments, numbering) plus one `gym_memberships` row in the same transaction; the membership is a snapshot of the plan, so editing a plan never changes what was sold.
**Whether a member may come in on an unpaid invoice is the plan's rule**, read from the invoice at the moment of the scan:

| Plan payment rule | Comes in when |
|---|---|
| Paid in full (default) | the invoice has nothing owing |
| Any payment | something has been paid (or the bill is nil) |
| Pay later (n days) | nothing owing, or it is within n days of the start date |

A cancelled invoice, or one fully credited (refunded), never lets anyone in; a part credit leaves the membership running. A membership given free or carried over by a transfer is not an invoice case.

State is derived, not stored. Stored status is only ACTIVE, CANCELLED or TRANSFERRED; "not started", "frozen", "ended", "in grace" and "unpaid" are worked out from dates, freezes and the invoice at the moment of use, so nothing goes stale at midnight and no nightly job is needed for correctness.
Dates are inclusive gym-local calendar days (the business timezone, daylight saving handled by Postgres): a 30-day membership starting on the 1st works on the 30th and is refused on the 31st.

* **Freeze**: pushes the end date out by the days frozen, up to the plan's limit; ending it early gives back the unused days.
* **Change plan**: the unused days of the old membership, at its taxable price, are credited against the new plan; the old one ends yesterday. No cash moves: a cash refund is a credit note on the old invoice.
* **Transfer**: the rest of the membership goes to another member, not billed again. **Cancel** moves no money either: a refund is a credit note; a *full* credit note (or cancelling the invoice) also ends the membership.
* **Family**: a plan covering n people lets the head's membership cover that many people in all, the dependents in the order they joined.
* **Refund reversal** reaches the rewards and the packs too (below).

## Access: one engine, three doors

`modules/gym/access.js`. Reception, a member's phone and a gate device all call `attempt()`. It evaluates, in order: the credential, the member, the membership (started, not frozen, not past grace, paid as the plan requires, valid at this branch, inside the plan's hours) and the gym's own opening hours and holidays;
then history (a repeat within the wait, the day's visit limit, one card at two branches within minutes), then verification (the desk confirming, a fresh sign-in code, today's front-desk code). The decision and the visit are written in one transaction under a per-member lock; any error that is not a plain refusal
becomes `SERVICE_UNAVAILABLE`, recorded as nothing and approved as nothing.

Reason codes: `APPROVED`, `MEMBER_NOT_FOUND`, `INVALID_CREDENTIAL`, `CREDENTIAL_REVOKED`, `CREDENTIAL_EXPIRED`, `NO_MEMBERSHIP`, `MEMBERSHIP_NOT_STARTED`, `MEMBERSHIP_EXPIRED`, `MEMBERSHIP_FROZEN`, `MEMBERSHIP_SUSPENDED` (on hold or inactive), `PAYMENT_REQUIRES_ATTENTION`,
`BRANCH_NOT_ALLOWED`, `ACCESS_OUTSIDE_ALLOWED_HOURS`, `DUPLICATE_SCAN`, `DEVICE_NOT_AUTHORIZED`, `VERIFICATION_REQUIRED`, `NOT_CHECKED_IN`, `ACTION_NOT_ALLOWED`, `SERVICE_UNAVAILABLE`. A refusal shows the front desk the member (it has to); a phone or a gate gets only the code and a plain message.

**Credentials.** A printed card is `FXG1.<192-bit random token>`; only its SHA-256 is stored and the token is shown once, when the card is made (to reprint, replace the card: the old one stops at once). A phone pass is `FXD1.<token>`: single use, about a minute, issued to a signed-in member, so a screenshot is useless.
No QR holds a name, a phone number, a plan or a database id. **A printed card can be lent to a friend.** That cannot be prevented, so the controls are: a repeat-scan wait, the one-card-at-two-branches check, an optional desk confirmation of every scan, and replacing a lost card. Lookup by name always needs the desk to confirm it has seen the person.

**Entrance QR.** A link, `/gym/in/<random token>`, per branch. It says which gym and branch and grants nothing. The member signs in with a 6-digit code sent to their registered phone (10 minutes, 5 tries, one a minute, five an hour per number, the same answer for a number that is not a member),
gets a session cookie (`flowxp_member`, httpOnly, SameSite=Lax, 30 days by default, ended by the member or by the gym), then taps *Check in*. A photo of the poster could check someone in from home, so the gym can also require **today's four-digit front-desk code** (shown on the front desk screen)
and/or a **fresh sign-in code at every check-in**. Rotating the entrance QR retires an old poster.

**Self check-in, reception and device events are idempotent**: the same tap, scan or event sent again returns the first answer and records nothing new; five scans of one card at the same moment make one visit.

**Offline.** Reception and members' phones are online-only: if FlowXP cannot be reached nobody is let in and the desk says so. A gate device may, only if registered with the offline policy REPORT_ONLY, open on its own when it cannot reach FlowXP and report afterwards; FlowXP then checks each event as it would have been
judged at that time and flags any it should not have allowed (see `GYM_DEVICES.md`). The existing offline till queue (billing) is unchanged and not used by the gym.

## Rewards

Off until switched on. A point is earned once per real event (a ledger row per `source_type` + `source_ref`, unique per member): a visit that was let in (once a day), a membership paid in full, a referral (when the new member's first membership is paid), a visit-count milestone, a birthday.
The balance is the sum of the ledger; each earn is a lot with its own expiry, spending uses the oldest first, and expiry takes only what is unspent. Never rewarded: a refused or repeated scan, an unpaid or free membership. A refund or cancelled invoice takes back what the sale earned (and its referral reward) as far as unspent, once.
Redeeming locks the member, so concurrent redemptions cannot overspend. The general loyalty program on the till is separate and unchanged.

## Classes, packs and training

A class is created for a gym-local date and clock time, repeated weekly if asked, all or nothing; a trainer cannot be double-booked. Booking follows the door's rules judged at the class's time; a seat is never sold twice (a lock and a unique index); a full class has a waitlist and a freed seat goes to the first person who can still come.
Classes sold separately, and one-to-one training, use **packs**: a session is reserved at booking, given back if cancelled in time, kept if used, missed or cancelled late. Workout plans, goals and measurements are private to trainers, managers and the member.

## Reminders

Welcome, membership ending, ended, payment due, we-miss-you (only to members who agreed to offers), and birthday points, through the business's own messaging channel, between 9 am and 8 pm gym time, claimed in `gym_message_log` before sending so none goes twice. Off unless the business has a channel on and the reminder switched on.

## Tests

`backend/test/gymCore.test.js`, `gymAccess.test.js`, `gymPortal.test.js`, `gymRewards.test.js`, `gymDevices.test.js`, `gymClasses.test.js` (real Postgres, one throwaway database per file, like the rest). They include the midnight and daylight-saving boundaries, concurrent scans, bookings and redemptions,
replay, forgery, tenant and outlet isolation, and the route table with the real permission middleware.

## Known limits and what is not done

* **No gate hardware has been connected.** Only the generic signed-HTTP contract exists; no vendor adapter; no RFID/NFC credential type.
* **Members cannot pay online.** FlowXP's Cashfree integration bills FlowXP's own customers, not a gym's. A member renews at the desk (cash, UPI QR, card). There is no renewal link.
* **No native app.** The phone app (`mobile/`) has no gym screens. Members use the web page; staff use the web screens.
* **One time zone per business** (`businesses.timezone`), not per branch.
* A rewards event is paid in the same transaction as the thing that caused it, but a failure in the reward step is logged and does not fail the visit or the sale (it is not paid and not retried automatically).
* Reminders need a messaging channel; WhatsApp needs approved templates (printed under Messaging). The sign-in code uses SMS where the provider has it.
* Not built: online booking payments, locker assignments, equipment maintenance and incident logs, supplier/purchase screens specific to a gym (the general Products, Inventory, Purchases and Expenses screens work for a gym), churn prediction. Gym reports are the ones listed above; the Flow AI manager has no gym tools yet.
* Browser camera scanning uses `BarcodeDetector` (Chrome, Android) or a bundled decoder elsewhere; it was checked in a desktop browser, not on a range of phones. A USB scanner works as a keyboard.

## Troubleshooting

| Symptom | Look at |
|---|---|
| Member says no code arrives | Messaging provider set up? (Super Admin > Settings > Messaging). The server never logs codes; check `[gym] sign-in code not sent` in the log |
| Everyone is refused with PAYMENT_REQUIRES_ATTENTION | The plan's payment rule; the invoice may be unpaid. Take the payment on the member's page |
| Refused ACCESS_OUTSIDE_ALLOWED_HOURS | Branch hours/holidays (Gym settings > Branches), or an off-peak plan |
| Front desk says "Nobody is let in until this works again" | `SERVICE_UNAVAILABLE`: the database was unreachable; see the API log line `[gym] access attempt failed` |
| A gate never opens | Devices tab: online? the time on the device within 2 minutes of the server? signature path must match exactly; `GYM_DEVICES.md` |
| Entrance poster stopped working | Someone rotated it, or the branch was closed; print the current one from Gym settings > Branches |

## API

Permissions in `backend/src/routes/gym.routes.js`; every route is behind a role check, `gymOnly` (any other business type gets a 404) and, where priced separately, a plan feature.

```
## Staff (/api/gym)
GET    /api/gym/settings
PUT    /api/gym/settings
PUT    /api/gym/branches/:id/settings
POST   /api/gym/branches/:id/checkin-qr/rotate
GET    /api/gym/plans
POST   /api/gym/plans
PUT    /api/gym/plans/:id
POST   /api/gym/plans/:id/archive
POST   /api/gym/plans/:id/restore
GET    /api/gym/members
GET    /api/gym/members/duplicates
GET    /api/gym/members/export
POST   /api/gym/members/import
POST   /api/gym/members/merge
POST   /api/gym/members
GET    /api/gym/members/:id
PUT    /api/gym/members/:id
POST   /api/gym/members/:id/status
POST   /api/gym/members/:id/photo
POST   /api/gym/members/:id/memberships
POST   /api/gym/memberships/:id/renew
POST   /api/gym/memberships/:id/change-plan
POST   /api/gym/memberships/:id/freeze
POST   /api/gym/memberships/:id/unfreeze
POST   /api/gym/memberships/:id/extend
POST   /api/gym/memberships/:id/cancel
POST   /api/gym/memberships/:id/transfer
GET    /api/gym/memberships/:id/history
POST   /api/gym/members/:id/cards
POST   /api/gym/members/:id/revoke-access
POST   /api/gym/credentials/:id/revoke
POST   /api/gym/access/scan
POST   /api/gym/access/manual
GET    /api/gym/access/daily-code
GET    /api/gym/access/events
GET    /api/gym/attendance
POST   /api/gym/attendance
POST   /api/gym/attendance/:id/correct
GET    /api/gym/rewards/rules
PUT    /api/gym/rewards/rules
GET    /api/gym/rewards
POST   /api/gym/rewards
PUT    /api/gym/rewards/:id
POST   /api/gym/rewards/:id/archive
POST   /api/gym/rewards/:id/restore
GET    /api/gym/members/:id/points
POST   /api/gym/members/:id/points/adjust
POST   /api/gym/members/:id/redeem
POST   /api/gym/members/:id/rewards-exclusion
GET    /api/gym/redemptions
POST   /api/gym/redemptions/:id/fulfil
POST   /api/gym/redemptions/:id/cancel
GET    /api/gym/reports/rewards
GET    /api/gym/automations
PUT    /api/gym/automations/:key
GET    /api/gym/devices
POST   /api/gym/devices
PUT    /api/gym/devices/:id
POST   /api/gym/devices/:id/rotate-secret
POST   /api/gym/devices/:id/disable
POST   /api/gym/devices/:id/enable
GET    /api/gym/devices/problems
GET    /api/gym/trainers
POST   /api/gym/trainers
PUT    /api/gym/trainers/:id
POST   /api/gym/members/:id/trainer
GET    /api/gym/class-types
POST   /api/gym/class-types
PUT    /api/gym/class-types/:id
GET    /api/gym/classes
POST   /api/gym/classes
POST   /api/gym/classes/:id/cancel
GET    /api/gym/classes/:id/bookings
POST   /api/gym/classes/:id/book
POST   /api/gym/bookings/:id/cancel
POST   /api/gym/bookings/:id/attendance
GET    /api/gym/members/:id/packs
POST   /api/gym/members/:id/packs
GET    /api/gym/pt
POST   /api/gym/pt
POST   /api/gym/pt/:id/cancel
POST   /api/gym/pt/:id/finish
GET    /api/gym/reports/trainers
GET    /api/gym/exercises
POST   /api/gym/exercises
PUT    /api/gym/exercises/:id
GET    /api/gym/workout-templates
POST   /api/gym/workout-templates
GET    /api/gym/members/:id/workouts
POST   /api/gym/members/:id/workouts
PUT    /api/gym/workouts/:id
GET    /api/gym/members/:id/progress
POST   /api/gym/members/:id/goals
POST   /api/gym/members/:id/goals/:goalId
POST   /api/gym/members/:id/measurements
GET    /api/gym/dashboard
GET    /api/gym/reports/attendance
GET    /api/gym/reports/memberships

## Members on their own phone (/api/public/gym)
GET    /api/public/gym/in/:token
GET    /api/public/gym/me
GET    /api/public/gym/me/attendance
GET    /api/public/gym/me/classes
POST   /api/public/gym/me/classes/:id/book
POST   /api/public/gym/me/bookings/:id/cancel
GET    /api/public/gym/me/training
PUT    /api/public/gym/me/profile
POST   /api/public/gym/me/pass
POST   /api/public/gym/me/switch
POST   /api/public/gym/me/checkin
POST   /api/public/gym/logout
GET    /api/public/gym/:slug
POST   /api/public/gym/:slug/otp
POST   /api/public/gym/:slug/verify

## Devices (/api/device/v1, signed)
POST   /api/device/v1/access
POST   /api/device/v1/ack
POST   /api/device/v1/heartbeat
POST   /api/device/v1/events/batch
```
