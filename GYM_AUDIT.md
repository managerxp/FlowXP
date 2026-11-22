# Flow Gym: audit against the master prompt (2026-11-22)

Read-only audit; no gym code was changed. Sources: `GYM_PLAN.md`, `GYM.md`, `backend/migrations/0087-0091`, `backend/src/routes/gym.routes.js`, `gymPublic.routes.js`, `backend/src/modules/gym/*`, `frontend/src/app/gym/*`, `AppShell.jsx`, `planFeatures.js`, `permissions.js`.
Stack check: React + Vite + Tailwind 4 + Router, Express, raw `pg`, numbered JS migrations, PM2/Nginx on a VPS. Nothing in the prompt needs a different stack, database or login system. "Verified" = I read the code or route; I did not run anything new.

## Classification

| # | Prompt area | Status | What exists (source) | Gap |
|---|---|---|---|---|
| 1 | Members: registration, ID, photo, emergency contact, restricted health note, duplicates, CSV import/export, merge, status | AVAILABLE | `gym_members` (extends `customers`), `/gym/members*`, `MemberForm.jsx`, `GymMembers.jsx` | Walk-in "quick register" speed pass unverified; Excel (.xlsx) import not checked (CSV only is assumed) |
| 2 | Member profile page | PARTIAL | `MemberDetail.jsx` panels: Memberships, Visits, Details, Card and phone pass, Family, plus Packs/Training in `MemberExtras.jsx` | Not the tabbed profile asked for. No header strip of wallet / dues / sessions / lifetime spend. No Payments, Purchases or Wallet tab |
| 3 | Plans | AVAILABLE | `gym_plans`, `/gym/plans*`, `GymPlans.jsx` (freeze eligibility, branch restriction, GST, archive) | Daily / session-count plan types, access hours, cancellation rules: check against `plans.js` before building |
| 4 | Subscription lifecycle (sell, renew, upcoming/scheduled, freeze, extend, cancel, transfer, change plan, audit) | AVAILABLE | `gym_memberships`, `gym_freezes`, `gym_membership_events`; routes `/members/:id/memberships`, `/memberships/:id/renew|freeze|unfreeze|extend|cancel|transfer|change-plan|history`; state is derived from dates, freezes and the invoice (so an unpaid or future membership does not count as active) | Status names differ from the prompt (Pending payment / Suspended are not separate states); confirm sequential memberships in `memberships.js` |
| 5 | Attendance, QR, access rules | AVAILABLE | `modules/gym/access.js` (one decision engine), `gym_attendance`, `gym_access_events`, `gym_credentials`, `gym_pass_tokens`, `/gym/access/*`, `GymReception.jsx`, `GymAttendance.jsx`, devices contract `GYM_DEVICES.md` | No gate vendor adapter (by design). Policy for members with dues at the door: verify setting exists |
| 6 | Wallet (advance deposit) for members | MISSING | Only a messaging wallet (`wallet_ledger`, business-level) and a gaming wallet (`gaming_wallet_ledger`, gaming only) | A gym member wallet ledger: deposit, spend, refund, balance, liability. Must be its own ledger, separate from dues and from session packs |
| 7 | Outstanding dues / credit limits / collection | PARTIAL | Dues come from the invoice (`balance_due_paise`), shown per membership with "Collect" link; dashboard sums month dues | No per-member dues total, no credit limit, no overdue list, no payment commitment date, no refund approval flow (refund = credit note) |
| 8 | Session / package balance | AVAILABLE | `gym_packs`, `gym_pack_usage`, `/members/:id/packs` | Visual progress bar on profile |
| 9 | Supplements and inventory | PARTIAL | FlowXP's general products, stock, billing and GST engine are shared by all types (gym nav hides nothing for them) | No gym-flavoured sale screen (search a member, cart, wallet). Batch/expiry tracking not checked for non-pharmacy types. Supplement categories not preset |
| 10 | Member purchase history + lifetime spend | MISSING | Invoices carry the customer, so the data exists | A per-member Purchases tab (product, qty, price, tax, method, invoice link) and totals |
| 11 | Trainers, PT sessions, classes, bookings, waitlist | AVAILABLE | `gym_trainers`, `gym_class_*`, `gym_pt_sessions`, `/gym/trainers|classes|pt|bookings`, `GymClasses.jsx`, workout plans, goals, measurements | Trainer commission and trainer attendance not found; trainer role limited to assigned members: verify |
| 12 | Rewards / points | AVAILABLE | `gym_reward_*`, `gym_points_ledger`, `GymRewards.jsx` | none for this prompt |
| 13 | Reports | PARTIAL | `/gym/dashboard`, `/gym/reports/attendance|memberships|rewards|trainers` | No revenue split (membership vs supplement vs PT), no wallet, no stock/expiry, no retention (renewal rate, churn, inactive members); no Excel export |
| 14 | Dashboard | PARTIAL | `GymDashboard.jsx` + `/gym/dashboard`: state counts, visits today, who is inside, denied entries, sales and dues this month | Missing: today's revenue, outstanding total, wallet liability, supplement sales, low stock, renewals due in 7/15/30 days, recent activity |
| 15 | Notifications | AVAILABLE | `gym_automations`, `gym_message_log`; six reminders; WhatsApp templates (expiry, payment due, month start) | Low-wallet and class reminders depend on item 6 / 11 |
| 16 | Multi-branch | AVAILABLE (verify) | `branchFilter`, `requireOutlet`, per-branch settings, `allowed_branch_ids` on memberships | Needs the branch-isolation tests from the QA list run against gym |
| 17 | Roles | PARTIAL | Permissions `gym_desk`, `gym_members`, `gym_setup`, `gym_trainer` plus FlowXP's `inventory`, `reports`, `billing` | No dedicated Accountant gym role; Inventory manager uses generic `inventory` |
| 18 | Member portal | PARTIAL | `public/GymPortal.jsx`, `/gym/me*`: phone OTP, pass QR, self check-in, attendance, classes, training, profile | Not shown to members: wallet, dues, purchases, invoices, renewal options |
| 19 | Navigation | PARTIAL | Front desk, Members, Plans, Classes, Rewards, Attendance, Settings | The prompt's 12 sections: Overview, Billing & Payments, Wallet, Supplements, Reports, Trainers, Branches are not gym menu entries yet |
| 20 | Phone app | PARTIAL | Members, member page, attendance, classes, plans, settings on the phone | Nothing for wallet / purchases yet |

## Tests that exist
`backend/test/gymCore`, `gymAccess`, `gymPortal`, `gymRewards`, `gymDevices`, `gymClasses` (all passing at last full run, 2026-11-03; one unrelated date-dependent rewards test fails).

## Gaps ranked by value to a gym owner
1. **Member profile header + Payments / Purchases tabs** (read-only, uses existing invoices): answers the "who owes what, what did they buy" question at once. Low risk, no new money logic.
2. **Dashboard additions** from real queries (today's revenue, dues, renewals due in 7/15/30 days, recent activity, low stock).
3. **Member wallet** (new ledger, deposit / spend / refund, idempotent, in a transaction) and paying invoices from it. This is the only real new financial engine.
4. **Dues control**: per-member credit limit, overdue list, payment commitment, door policy for dues.
5. **Supplement sale screen** at the desk using the existing billing engine, then stock/batch alerts.
6. **Reports** (revenue split, retention, wallet) and Excel export.
7. **Portal** shows wallet, dues, purchases, invoices.
8. **Navigation** reshaped to the 12 sections, after the pages exist.

## Rules for implementation
Reuse `createInvoiceInTransaction`, `idempotent()`, `withBusiness`, `branchFilter`, `recordAudit`, `PLAN_FEATURES` keys (each new capability gets a key and an INDUSTRY_OFF entry), and the numbered migration style (next free number after the latest migration). Money in integer paise. Nothing is built yet.
