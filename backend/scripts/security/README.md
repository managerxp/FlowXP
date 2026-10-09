# Security checks you can re-run

Written for the 2026-10-08 audit (`../../../SECURITY_AUDIT.md`). They test the running server with the demo data, so use a development server, never production.

| Script | What it proves |
|---|---|
| `routes.mjs` | Lists all routes and which need sign-in. Only the deliberate public ones should be public. |
| `tenants.mjs`, `tenants-sweep.mjs` | One business cannot read or change another's records. |
| `roles.mjs` | The weakest role is refused (or the route does not exist for that business type) everywhere it should be. |
| `probes.mjs` | Forged and expired tokens, cross-site forgery, CORS, headers, error leaks, oversized bodies, path traversal, rate limits. |
| `tamper.mjs` | A till cannot change what a bill is worth (negative prices, discounts above the bill, negative GST, absurd quantities). |
| `edges.mjs`, `edges2.mjs` | Bad input on every till (café, supermarket, wholesale, pharmacy, salon, a temporary cloud kitchen), table orders, wholesale orders and van sales: nothing may answer 5xx or accept nonsense. `edges2` takes a little stock off the demo van each run. |
| `approvals.mjs`, `approvals2.mjs`, `cost.mjs`, `revenue.mjs`, `offline.mjs`, `booking.mjs`, `qrorder.mjs` | The manager PIN and discount cap, who sees cost and takings, offline-sale audit, booking and QR order limits. |
| `sql.mjs` | Lists UPDATE/DELETE statements that do not name the business, for a person to review. |

Run `routes.mjs` first (`node scripts/security/routes.mjs scripts/security/routes.json`), from the `backend` folder.
