# FlowBook design system

FlowBook is a financial instrument. It should feel like a well-set ledger: calm, exact, dense where data needs it, spacious where decisions are made. It must not look like FlowXP's marketing pages or a generic AI dashboard (no blue-cyan gradients, no floating pills, no decorative blobs, no oversized hero numbers for the sake of it). Original identity: this file defines it; no competitor logos, text or layouts are copied.

## 1. Principles
1. **Numbers are the interface.** Tabular figures, right-aligned, with the currency and sign unambiguous.
2. **Status is never colour alone.** Draft, Posted, Void each have text and an icon.
3. **Every figure drills down** to its transactions.
4. **Irreversible means confirmed.** Posting, voiding, closing a period, sending to the government each get a summary dialog that states the effect on the books.
5. **Quiet by default.** One accent colour; colour is saved for status and charts.
6. **Estimates look different from facts.** Forecast values are dashed, labelled and lighter.

## 2. Colour tokens (light default, dark optional)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #FAF9F6 | #121513 | page |
| `--surface` | #FFFFFF | #1A1E1B | cards, tables |
| `--surface-2` | #F2F0EA | #222723 | table header, hover |
| `--ink` | #1B1F1C | #ECEFEA | text |
| `--ink-2` | #4B544E | #AEB7B0 | secondary text (contrast 7:1 on bg) |
| `--line` | #DAD6CB | #333A35 | borders |
| `--accent` | #0F6B4F | #3FBF92 | primary actions, links |
| `--accent-ink` | #FFFFFF | #07130E | text on accent |
| `--credit` | #0F6B4F | #3FBF92 | inflow, credit balance |
| `--debit` | #A33A2B | #E5877A | outflow, debit balance, danger |
| `--warn` | #8A5A00 | #E0B04D | overdue, attention |
| `--info` | #2F4B7C | #8FA8D8 | neutral notices |
| Chart series | #0F6B4F, #A33A2B, #2F4B7C, #8A5A00, #6B5B95, #5B6B73 | lighter variants | categorical, colour-blind safe with patterns/labels |
All text pairs pass WCAG 2.2 AA (4.5:1; large 3:1); verify with the tool before release.

## 3. Typography
Inter for UI, JetBrains Mono (or Inter with `font-variant-numeric: tabular-nums`) for amounts and document numbers. Scale 12/13/14/16/20/24/32; body 14 in dense tables, 16 in forms. Line height 1.4 body, 1.2 headings. Weights 400/500/600 only.

## 4. Spacing and layout
4 px base: 4, 8, 12, 16, 24, 32, 48. Page max width 1440, content gutter 24 desktop, 16 mobile. Radius 6 on controls, 8 on cards; no larger. Shadows only for popovers and dialogs. Sidebar 240 (collapsible to 64).

## 5. Navigation
Left sidebar groups: Home, Sales, Purchases, Banking, Accounting, Inventory, GST, Reports, Integrations, AI, Settings. Top bar: organization switcher (with branch filter), global search (Ctrl/Cmd+K), create menu, notifications, user. Breadcrumbs on detail pages. Saved views per list. Accountant mode shows a client switcher.

## 6. Components and rules
- **Tables:** sticky header, tabular numerals right-aligned, row height 40 (dense 32), column chooser, sort, filters as chips, saved views, footer totals, bulk select, keyboard navigation, empty/loading/error states, 25/50/100 pagination, virtualised beyond 500 rows. Totals row bold. Negative amounts in parentheses and `--debit`.
- **Forms:** labels above fields, helper text below, errors inline with a summary at the top on submit, never clear fields on error, autosave drafts, Enter submits only on single-field forms, Ctrl/Cmd+S saves draft, line-item grids with keyboard add row (Tab on last cell).
- **Money inputs:** type=text with inputmode decimal, formats on blur (Indian grouping 12,34,567.00), currency symbol in the field affix, never accepts more than 2 decimals for INR.
- **Document status chips:** Draft (outline), Issued (filled neutral), Partially paid (accent outline), Paid (accent), Overdue (warn), Void (strikethrough ink-2). Posted/unposted shown by a "Posted to books" line with the journal link.
- **Dialogs:** Title states the action; body states the accounting effect ("Posts a journal: Dr AR ₹1,180, Cr Sales ₹1,000, Cr GST ₹180"); buttons "Cancel" and a specific verb ("Post invoice"). Destructive uses `--debit`.
- **Charts:** line for trends, bars for comparisons, stacked bars for composition; zero baseline on bars; labelled axes; table view toggle; tooltips with exact values; forecasts dashed.
- **Notifications:** toast for success (4 s), persistent banner for sync or reconciliation problems with a link to fix.
- **Loading and sync:** skeleton rows, "Last synced 2 min ago" with a state dot, never a spinner longer than 400 ms without a label.
- **AI panel:** right drawer, answers show period, as-of time, source links, and an "Estimated" tag where relevant.

## 7. Responsive
Breakpoints: 0 to 639 phone (single column, tables become card lists with the key two fields), 640 to 1023 tablet (sidebar collapsed), 1024 to 1439 desktop, 1440+ wide. Create flows work on a phone; complex grids (journal entry, bank match) are desktop-first with a read-only phone view.

## 8. Accessibility
WCAG 2.2 AA; visible focus ring 2 px `--accent` with offset; target size 24 px minimum (44 px on touch); all actions keyboard reachable; table semantics (th scope), aria-live for async status; reduced-motion respected; no information by colour alone; screen-reader names for amounts include sign and currency ("minus 1,180 rupees").

## 9. Motion
150 to 200 ms ease-out for open/close; no animated number counters on financial values; skeleton shimmer disabled under reduced motion.

## 10. Screen inventory
Landing, login, register, onboarding wizard, dashboard, sales workspace (customers, quotes, invoices, payments, credit notes), purchases workspace, accounting workspace (accounts, journals, ledger, periods, assets), GST workspace, banking workspace, reports, AI assistant, Integrations Hub, organization settings, users and roles, subscription and billing.

## 11. Example: invoice list row
`INV-2026-0412 · Asha Traders · 28 Oct 2026 · Due 12 Nov · [Partially paid] · ₹11,800.00 · Balance ₹4,800.00 · ⋯` with the amount columns right-aligned in tabular figures, due date turning `--warn` when overdue.

## 12. Example: dashboard hierarchy
Row 1: Cash and bank, Receivables due, Payables due, Net profit this month (each a link, each with "as of" time). Row 2: Income vs expense (12 months), Cash flow. Row 3: Ageing bars, Tax liability, Upcoming payments. Row 4: Unreconciled bank lines, low stock, AI insights with explanations.
