# flowbook-api

Phase 1, milestone 1: the accounting engine. No HTTP layer yet.

- `migrations/0001_core.sql`: organizations, financial years and periods, chart of accounts, journals, posting register, audit log. Balance, immutability, append-only audit and row level security are enforced by the database.
- `src/ledger.ts`: `post()` (the only writer of journals; idempotent, period-checked, gapless numbering) and `reverse()`.
- `src/rules.ts`: posting rules v1 (sale, credit note, customer payment and refund, supplier bill, supplier payment).
- `src/reports.ts`: trial balance, profit and loss, balance sheet, party balances, `reconcile()` self-check.
- `src/money.ts`, `coa.ts`, `periods.ts`, `audit.ts`, `db.ts`.

Needs Node 24 (runs TypeScript directly) and a local PostgreSQL. Tests create and drop their own database; set `FLOWBOOK_ADMIN_URL` or `DATABASE_URL` if the default `postgres://postgres:postgres@localhost:5432/postgres` is not right.

```bash
npm install
npm test
npm run typecheck
```
