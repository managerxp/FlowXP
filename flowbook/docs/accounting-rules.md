# FlowBook accounting rules

Status: specification. All amounts below are in rupees for readability; storage is integer paise (see database-schema.md). GST rates in examples (18%) are illustrative only: rates always come from the versioned tax table (research/indian-gst-compliance.md).

## 1. Invariants (enforced in code AND in the database)

| # | Rule | Enforcement |
|---|---|---|
| I1 | A posted journal balances: sum of debits = sum of credits, per currency and in base currency | `journal_entries` posted through one function inside one DB transaction; deferred constraint trigger checks the sum at commit; test with random entries |
| I2 | Posted entries are immutable | no UPDATE/DELETE grants for the app role on posted rows; `BEFORE UPDATE/DELETE` trigger raises unless status is DRAFT |
| I3 | Corrections are reversal + replacement | `reverses_entry_id` and `replaced_by_entry_id`; the original stays; the reversal carries the same accounts with sides swapped and today's (or a chosen open-period) date |
| I4 | Drafts never touch statements | statements read only `status = 'POSTED'` lines |
| I5 | Posting is idempotent | unique `(organization_id, source_type, source_id, posting_kind)` plus `Idempotency-Key` on APIs; replay returns the original entry |
| I6 | The tax rule used is kept | each tax line stores `tax_code_id`, rate, rule version id and the base amount at posting time |
| I7 | Reports reconcile to the ledger | every report is a query over `journal_lines`; a nightly job compares sub-ledgers (AR, AP, inventory, bank) to their control accounts and flags differences |
| I8 | Closed periods are locked | posting date inside a locked period is refused unless the actor has `period.override` and gives a reason, which is audited |
| I9 | No floating point | BIGINT minor units; quantities and rates NUMERIC(18,6); rounding done in one place (`money.round`) with a documented rule |
| I10 | Every line carries organization, branch, currency, source document and audit reference | NOT NULL columns and FK |

Rounding rule (decision D-07): tax is computed per invoice line on the taxable value, rounded half away from zero to 2 decimals, then summed; the invoice total is rounded to the nearest rupee only if the organization turns on round-off, and the difference goes to the Round Off account. Changing this rule needs a decision record.

## 2. Account model
Types: ASSET, LIABILITY, EQUITY, INCOME, EXPENSE (and CONTRA via `normal_balance`). Groups under each type give the statement layout. Control accounts (Accounts Receivable, Accounts Payable, Inventory, Input GST, Output GST, Cash, Bank, Round Off, Retained Earnings, Exchange Gain/Loss, Suspense) are system accounts that cannot be deleted or posted to manually except by journal with a reason. Per-party balances live in sub-ledger columns (`party_id` on the line), not in per-party accounts.

Normal balances: assets and expenses debit; liabilities, equity and income credit.

## 3. Journal examples (intra-state, 18% GST = 9% CGST + 9% SGST; inter-state replaces the two with 18% IGST)

1. **Cash sale ₹1,000 + GST ₹180**: Dr Cash 1,180; Cr Sales 1,000; Cr Output CGST 90; Cr Output SGST 90. (If a POS posted this, see the contract: one posting only.)
2. **Credit sale**: Dr Accounts Receivable 1,180; Cr Sales 1,000; Cr Output CGST 90; Cr Output SGST 90. Plus, for stock items, Dr Cost of Goods Sold / Cr Inventory at cost (section 4).
3. **Customer payment ₹1,180**: Dr Bank (or Cash) 1,180; Cr Accounts Receivable 1,180. The allocation table links the payment to the invoice(s); a surplus becomes Customer Advance (liability) until applied.
4. **Supplier bill ₹5,000 + GST ₹900**: Dr Purchases (or Expense or Inventory) 5,000; Dr Input CGST 450; Dr Input SGST 450; Cr Accounts Payable 5,900. If ITC is blocked or not claimed: the tax goes to the expense instead of Input GST.
5. **Supplier payment ₹5,900**: Dr Accounts Payable 5,900; Cr Bank 5,900.
6. **Sales return / credit note ₹590 incl. tax**: Dr Sales Returns 500; Dr Output CGST 45; Dr Output SGST 45; Cr Accounts Receivable 590 (or Cr Customer Advance/refund payable). Stock back: Dr Inventory / Cr COGS at the original cost.
7. **Purchase return / debit note ₹590**: Dr Accounts Payable 590; Cr Purchase Returns 500; Cr Input CGST 45; Cr Input SGST 45. Stock out: Dr Purchase Returns offset / Cr Inventory at original cost, difference to Purchase Price Variance.
8. **GST payment (net)**: Dr Output CGST, Output SGST (balances); Cr Input CGST, Input SGST (balances used), Cr Bank (cash paid). Any unused input remains a debit balance carried forward.
9. **Expense paid (₹2,000 + GST ₹360, ITC eligible)**: Dr Expense 2,000; Dr Input CGST 180; Dr Input SGST 180; Cr Bank 2,360. Not yet paid: Cr Accounts Payable instead of Bank.
10. **Bank charges ₹118 incl. GST**: Dr Bank Charges 100; Dr Input CGST 9; Dr Input SGST 9; Cr Bank 118.
11. **Inventory purchase (perpetual)**: as example 4 with Dr Inventory instead of Purchases.
12. **Inventory consumption / sale at cost ₹600**: Dr Cost of Goods Sold 600; Cr Inventory 600. Consumption for production: Dr Production/WIP or Consumables Expense.
13. **Depreciation (straight line) ₹10,000**: Dr Depreciation Expense 10,000; Cr Accumulated Depreciation 10,000. Disposal: Dr Bank, Dr Accumulated Depreciation, Dr/Cr Loss/Gain on disposal, Cr Fixed Asset (cost).
14. **Customer refund ₹500 (after a credit note)**: Dr Accounts Receivable (or Customer Credit liability) 500; Cr Bank 500.
15. **Bad debt write-off ₹300**: Dr Bad Debts Expense (or Allowance) 300; Cr Accounts Receivable 300. GST reversal on write-off follows the tax rule at that date (*verify*).
16. **Foreign currency invoice USD 100 at 83.00, paid later at 83.50**: invoice Dr AR 8,300 / Cr Sales 8,300; payment Dr Bank 8,350, Cr AR 8,300, Cr Exchange Gain 50. Unsettled balances revalued at period end: Dr/Cr AR, Cr/Dr Unrealised Exchange Gain/Loss, auto-reversed next period.
17. **Accrual**: expense incurred, not billed: Dr Expense / Cr Accrued Expenses; reverse on the first day of next period when the bill arrives. **Prepayment**: Dr Prepaid Expense / Cr Bank, then monthly Dr Expense / Cr Prepaid.
18. **Settlement at a gateway**: customer pays ₹1,000 by card; gateway keeps ₹20 + ₹3.60 GST and settles ₹976.40. Payment: Dr Gateway Clearing 1,000 / Cr AR 1,000. Settlement: Dr Bank 976.40; Dr Gateway Fees 20; Dr Input CGST 1.80, Input SGST 1.80; Cr Gateway Clearing 1,000. Refund mirrors it.

## 4. Inventory accounting
Default: perpetual inventory with weighted average cost per item per location; FIFO as a later option (decision D-08). Receipt: Dr Inventory at cost (bill value excluding recoverable tax plus landed cost). Sale: COGS at the average at that moment, computed inside the same transaction as the movement, never edited later; a negative-stock sale posts COGS at last known cost and creates a revaluation task. Adjustments: Dr/Cr Inventory vs Inventory Adjustments (gain/loss). Transfers between locations: no P&L, location column changes. When FlowXP is the stock owner, FlowBook posts **valuation journals from FlowXP stock events** and does not own quantities (contract section 4).

## 5. Documents and statuses
Invoice: DRAFT → (approval) → ISSUED → PARTIALLY_PAID → PAID; ISSUED/PARTIALLY_PAID → OVERDUE is derived from due date, not stored; ISSUED/PAID → VOID is not a delete: it posts a reversal and is refused if payments or credit notes are allocated, or after e-invoice IRN generation unless the IRN is cancelled first. CANCELLED applies only to DRAFT. Bills mirror this. Credit notes: DRAFT → ISSUED → APPLIED/REFUNDED. Payment: DRAFT → POSTED → VOID (reversal). Period: OPEN → SOFT_LOCKED → CLOSED.

## 6. Period and year close
Soft lock: warns and needs a reason. Hard close: blocked except `period.override`. Year-end: income and expense accounts are closed to Retained Earnings by a system journal on the last day of the financial year, only after the user confirms; reopening posts a reversal of that journal and leaves an audit entry.

## 7. Audit
`audit_log` is append-only and records actor, organization, action, entity, before/after hash, IP, request id, AI involvement flag. The hash chain (`prev_hash`) lets an auditor detect deletion. Export for accountants includes the log.

## 8. Tests that must exist before launch
Random balanced/unbalanced entries; retry same Idempotency-Key 20 times in parallel gives one entry; void then re-issue reconciles; period lock; rounding table (paise edge cases); tax changing effective date mid-month; AR sub-ledger sum equals control account; trial balance equals zero; report totals equal ledger totals; concurrent payments on one invoice never over-allocate.
