# FlowBook: checklist for the accountant

Please read each point, tick it or write what should change. "Today" means what the software does now. Nothing here is filed with the GST portal by itself; every return is a draft the owner checks.

Rates and codes below come from `flowbook/api/src/catalogue.ts` (the ready list) and the posting rules in `flowbook/api/src/rules.ts`. Rates are the ones the app ships with; they were **not** checked against the notifications in force today (the GST rates were changed from 22 Sep 2025, and some items may have moved again).

---

## 1. GST rates in the ready list (about 150 items)

Every item is added with an HSN/SAC and a GST rate. The owner can change the rate on any item. Please confirm or correct:

| Group | Rate in the app | HSN used | Doubt for the accountant |
|---|---|---|---|
| Cement (OPC, PPC) | 18% | 2523 | rate after the 2025 change |
| River sand, M-sand, aggregate, fly ash, lime | 5% | 2505 / 2517 / 2621 / 2522 | |
| Ready-mix concrete | 18% | 3824 | |
| TMT bars, MS angle/channel/flat/plate, pipes, GI sheet, binding wire, nails, welding rod | 18% | 7214, 7216, 7211, 7208, 7306, 7210, 7217, 7317, 8311 | |
| Red clay brick, fly ash brick, AAC block, hollow block | 5% | 6901 / 6815 / 6810 | |
| Paver block, kerb stone | 18% | 6810 | |
| Granite, marble, Kota stone | 18% | 6802 | |
| Tiles, tile adhesive/grout, sanitaryware, kitchen sink | 18% | 6907, 3214, 6910, 3922, 7324 | |
| Paints, putty, primer, thinner, waterproofing | 18% | 3208, 3209, 3210, 3214, 3814, 3824 | |
| Plywood, doors, windows, glass, locks, hinges | 18% | 4412, 4418, 4407, 7610, 3925, 7005, 8301, 8302 | |
| Wires, cables, switches, sockets, MCB, RCCB, DB, conduits, fans, earthing | 18% | 8544, 8536, 8538, 8537, 3917, 3925, 8414, 7326 | |
| **LED bulb, tube light, panel light** | **5%** | 8539 / 9405 | please confirm |
| Pipes, fittings, valves, taps, tanks, pumps (plumbing) | 18% | 3917, 7306, 8481, 3925, 8413 | |
| Fasteners, safety gear, tarpaulin | 18% | 7318, 3926, 4015, 6506, 6401, 6306 | |
| **Diesel** | **0%** | 2710 | outside GST, ok? |
| **Labour (mason, carpenter, electrician, plumber, painter...) and contractor work** | **18%** | SAC 9954 | see 2 below |
| JCB / scaffolding hire | 18% | SAC 9973 | |
| **Transport / truck hire** | **5%** | SAC 9965 | goods transport agency: 5% with no credit, or 18%? |

- [ ] Rates above are correct as of today, or corrected: ______________________
- [ ] HSN codes are right for each group (the app warns if a line has no HSN or fewer than 4 digits)
- [ ] Is 4-digit HSN enough in GSTR-1 table 12 for this business's turnover? (the app's default is 4; 6 or 8 can be chosen)

## 2. Works contracts and labour (builders)

Today a work order carries **one** GST rate for all its items (default 18%). Each RA bill is posted as an ordinary purchase bill (subcontractor) or sales invoice (client) at that rate.

- [ ] Is 18% right for labour-only and for works-contract services here? When should it be 12% / 5% (affordable housing, government works)?
- [ ] Should a work order allow a different rate per item? (not possible today)
- [ ] Composite supply (materials plus labour in one contract): is one blended rate acceptable, or should materials and labour be billed separately?

## 3. Running-account (RA) bills and retention

How it works today:
1. Each RA bill records the quantity measured **to date**; the invoice/bill is raised only for the new quantity, at the work order's rate.
2. The retention percentage (0 to 50%) of the **taxable value** is held back on that bill. **Nothing is posted for retention.** The bill stays in full in payables/receivables; the held amount only blocks payment until it is released.
3. GST is charged on the **full bill**, including the part held back.

- [ ] Is GST on the full value (retention included) the correct time of supply when retention is held back?
- [ ] Retention is held on the taxable value only. Should GST on the held amount also be held? (today the GST is payable to the vendor in full)
- [ ] Is it acceptable that retention has **no separate ledger account** (it is only a reminder on the bill)? Or must it show as a liability / asset in the balance sheet?
- [ ] Releasing retention: today the owner lowers the held amount and then pays. Is that enough, or is a separate retention-release bill needed for the audit trail?
- [ ] Defects-liability period and retention against bank guarantee: not handled. Needed?

## 4. TDS (tax deducted at source)

Today TDS is **typed by the user** when recording a payment (amount and section). Nothing is calculated or suggested.
- On a supplier payment: the amount cut is credited to *TDS payable* and the vendor is paid the rest.
- On a customer receipt: the amount the customer cut is debited to *TDS receivable*.

- [ ] **Section 194C** (contractors): 1% individual/HUF, 2% others; threshold per bill and per year. The app does not apply this automatically. Should it? On which value (with or without GST if shown separately)?
- [ ] Other sections to offer: 194J, 194H, 194I, 194Q (purchase of goods over 50 lakh)? Which are needed for a builder / electrician / hardware business?
- [ ] TDS on **GST-inclusive** vs **GST-excluded** value: which rule should the app follow?
- [ ] Is the TDS-payable account enough, or does the accountant want Form 26Q / challan reports? (no TDS return is produced today)
- [ ] Lower-deduction certificates and PAN-missing rate (20%): not handled.

## 5. TCS

On a **sales invoice** the user may set a TCS rate (0 to 20%) and section. TCS = rate x (taxable value + GST), credited to *TCS payable*.

- [ ] Is TCS on (value + GST) the right base?
- [ ] Which TCS sections should be listed so the user picks rather than types?

## 6. Advances

A payment not applied to any bill or invoice stays as an advance (unapplied amount) against the party and can be applied later. It is shown in "Advances and retention".

- [ ] GST on **advance received** (time of supply for services): not calculated today, as far as the code shows. Needed for services? (goods have no GST on advances)
- [ ] Advance paid to a contractor and its **recovery from RA bills**: manual today (apply the payment when settling). Acceptable, or must it deduct automatically on each bill?
- [ ] Mobilisation advance with interest: not handled.

## 7. Input tax credit (ITC) and GSTR-3B

Today: credit is taken on every purchase bill and expense in the month of the bill. Reverse-charge bills are shown separately (3.1(d)) and credit is claimed. Debit notes reduce credit. The "ineligible ITC" lines in the 3B draft are **zero**.

- [ ] **Blocked credit, section 17(5)**: (works contract for an immovable property not plant, construction of own building, food, motor vehicles, etc.). Nothing is blocked automatically. This matters for builders. How should it work: a per-item or per-bill "not eligible" flag?
- [ ] ITC matching with GSTR-2B: not done. Is a monthly manual check acceptable, or is import of 2B needed?
- [ ] Rule 42/43 (exempt plus taxable supplies, partial credit): not handled.
- [ ] Credit only after payment within 180 days: not tracked.
- [ ] Reverse charge: only on purchase bills; credit and liability are booked in the same month. Confirm this is right (liability paid in cash, credit claimed in the month of payment?).

## 8. GSTR-1 and invoices

- [ ] B2B / B2C large / B2C small split and place of supply: correct? (interstate if the party's state differs from the business state; exports always IGST)
- [ ] Credit notes and debit notes linked to a bill/invoice of the same party: acceptable rules?
- [ ] Invoice numbering by financial year and series: confirm format meets Rule 46 (16 characters, unique).
- [ ] Round-off to the nearest rupee on invoices only: ok?
- [ ] E-invoice (IRP) and e-way bill: built but **never tested with a live account**. Which turnover limit applies to this client?
- [ ] Composition-scheme dealers: not supported.
- [ ] Cess: not supported (not needed for the trades above? confirm).

## 9. Real estate (flats and plots)

Units have stages and payments against them.

- [ ] Sale of under-construction flats: GST rate (1% / 5% without credit, or 5% / 12% with) and whether land value is deducted (one-third). Today the user picks one GST rate per bill; **no land-value deduction**.
- [ ] Completed property sale (no GST) vs under-construction (GST): is a rate of 0% enough?
- [ ] Booking / stage payments: recorded as receipts against the unit. Is the GST timing right?

## 10. Books and year-end

- [ ] Chart of accounts: default accounts (sales, purchases, inventory, TDS payable/receivable, TCS payable, input and output GST, round-off, opening balance). Anything missing for these trades (e.g. retention, advance from customers, work in progress)?
- [ ] Stock: moving-average cost? FIFO? Which does this client follow?
- [ ] Fixed assets: depreciation both as per books and as per Income Tax. Confirm rates.
- [ ] Period lock after filing: available. Confirm that it matches the client's practice.
- [ ] Cancelling a document: done by reversing the journal, never by deleting. Ok for audit?
- [ ] Trial balance, profit and loss, balance sheet: please compare against a month of this client's real books and note any difference.

---

### How to test (about two hours)

1. Take **one real month** of the client's purchase bills, sales invoices, payments and expenses.
2. Enter or import them into a FlowBook trial business.
3. Compare: GST payable (3B), HSN summary, trial balance, party outstanding, TDS payable.
4. Write each difference next to the number it affects and send it back.

**Sign-off:** Name ________________  Date ________  Rates confirmed [ ]   Rules confirmed [ ]   Changes needed [ ]
