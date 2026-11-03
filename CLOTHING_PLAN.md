# Clothing retail (business type `CLOTHING`): architecture and plan

## What was inspected (2026-11-03)

FlowXP is a Vite + React 19 web app with an Express + raw `pg` API (not Next.js, no ORM). The brief's stack suggestion is overridden by its own rule: reuse what exists.
`CLOTHING` already existed as a bare business-type name (a generic shop). Retail (SUPERMARKET / RETAIL) already has, and clothing reuses unchanged:

| Need in the brief | Already in FlowXP |
|---|---|
| Barcode-first till, split payments, credit, held bills, offline queue, WhatsApp/print | `BillingPage`, `modules/billing.js`, offline POS + `pos-catalog` |
| Many barcodes per product, SKU generation, search | `product_barcodes`, `modules/sku.js`, `productIdentity.js` |
| Stock per outlet + ledger | `branch_stock`, `moveStock`, `inventory_transactions`, stock center, counts, transfers |
| Returns and exchanges (credit spent as payment) | `ReturnsPage`, `credit_notes`, `exchangeCreditNoteId` |
| Offers (percent, BOGO, bundle), coupons, loyalty | `modules/promotions.js`, coupons, points |
| Purchases, suppliers, supplier bill import | purchases, suppliers, `invoiceScan` |
| GST (CGST/SGST/IGST, HSN), credit notes, GSTR | `modules/tax.js`, GST reports |
| Roles and permissions, plan gating | `ROLE_PERMISSIONS`, `PLAN_FEATURE_KEYS` / `INDUSTRY_OFF` |

## Design decision

**A size/colour variant IS a `products` row.** Billing, stock, GST, barcodes, returns, exchanges, offers, transfers and the offline till all work per variant with no new engine, and nothing is duplicated.
Clothing adds only a layer on top, the same pattern as Auto Parts:

- `clothing_styles` (the product the shopper thinks of: brand, gender, season, fabric, pattern, fit, HSN, GST, default prices, size set)
- `clothing_variants` (1:1 on `products`: style, colour, size) with a unique colour+size per style
- `clothing_size_sets` (custom size sets; the built-in ones are in code)
- A SKU is `<style code>-<colour code>-<size>`; a barcode is an in-store EAN-13 from a sequence, so a scan identifies the exact size and colour.

Plan feature `cl_catalog` gates it (project convention); every other industry has it off by default.

## Phases

1. **Foundation (built first):** style catalogue, size/colour matrix wizard, variant generation, SKU and barcode, per-variant price/reorder, stock matrix, CSV import, website page.
2. **Till:** size/colour picker for a style on the existing till, scan identifies the variant, exchange by size/colour on the existing returns flow.
3. **Store operations:** purchase entry as a size/colour matrix on top of the existing purchase API, supplier ledger view, customer size/colour preferences.
4. **Intelligence:** best sizes/colours, size-wise and colour-wise sales, ageing, dead stock, margin by style.
5. **Advanced:** label printing (barcode and price tags), branch transfer matrix, promotions per category, AI insights.

Phases 2 to 5 are listed in `brain.md` as pending until built.
