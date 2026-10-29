# flowbook-api

Phase 1, milestones 1 and 2: the accounting engine and its HTTP API with sign-in, organizations and roles.

- `migrations/0001_core.sql`: organizations, financial years and periods, chart of accounts, journals, posting register, audit log. Balance, immutability, append-only audit and row level security are enforced by the database.
- `src/ledger.ts`: `post()` (the only writer of journals; idempotent, period-checked, gapless numbering) and `reverse()`.
- `src/rules.ts`: posting rules v1 (sale, credit note, customer payment and refund, supplier bill, supplier payment).
- `src/reports.ts`: trial balance, profit and loss, balance sheet, party balances, `reconcile()` self-check.
- `src/app.ts`: the Fastify API (`/v1`): auth, organizations, members, accounts, journals, periods, reports, audit. `src/server.ts` starts it; `src/auth.ts` (Argon2id, sessions), `permissions.ts` (roles), `provision.ts`.
- `src/money.ts`, `coa.ts`, `periods.ts`, `audit.ts`, `db.ts`.

Needs Node 24 (runs TypeScript directly) and a local PostgreSQL. Tests create and drop their own database; set `FLOWBOOK_ADMIN_URL` or `DATABASE_URL` if the default `postgres://postgres:postgres@localhost:5432/postgres` is not right.

```bash
DATABASE_URL=postgres://... npm start   # applies migrations, listens on PORT (default 5200)
npm install
npm test
npm run typecheck
```
