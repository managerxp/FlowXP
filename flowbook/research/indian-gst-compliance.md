# Indian GST and data-protection compliance notes

Accessed 2026-10-29. **Status: not legal advice, and not verified against primary sources.** Primary sources (GSTN, CBIC, Income Tax Department, MeitY) were not opened in this pass; web search only returned secondary summaries (ClearTax, Taxguru, GSTSafar, Taxilla, Vyapar Taxone, Moneylife) and Zoho's own page. Every number below must be re-checked on gst.gov.in, cbic-gst.gov.in, incometax.gov.in and meity.gov.in before a rule is coded or marketed. A tax professional must sign off.

## 1. e-Invoicing
- Mandatory for taxpayers with aggregate turnover above a threshold; **₹5 crore from 1 Aug 2023** per Zoho's e-invoicing page and several secondary sources.
- A time limit for reporting to the IRP exists for large taxpayers: secondary sources say **30 days from document date for AATO ₹100 crore and above** (invoices, debit notes, credit notes). Smaller bands: *unknown, verify*.
- Flow: issuer sends invoice JSON (schema 1.1) to an IRP, gets IRN, acknowledgement number/date and a signed QR. Cancellation is allowed within a window (*verify hours*).
- Who can call IRP APIs: taxpayers through a GSP/ASP arrangement; Zoho says it is a registered GSP. **FlowBook cannot submit directly without a registered route.** Plan: partner with an existing GSP first.
- FlowXP today: generates e-invoice JSON (brain.md, 2026-10-15 "e-invoice JSON"). That is an export, not a submission.

## 2. e-Way bill
Generated from invoice plus transport data; goods consignment value threshold and validity rules exist (*verify current values*). Needs the same GSP route for API generation. FlowXP wholesale stores an e-way bill number only.

## 3. Returns
GSTR-1 (outward), GSTR-3B (summary and tax payment), GSTR-2B (auto-drafted inward, read-only), GSTR-9 (annual), CMP-08 (composition), plus the Invoice Management System (accept/reject supplier invoices) which Zoho lists. FlowXP has GSTR-1 and GSTR-3B JSON/report. **Label every FlowBook output "prepared for filing", never "filed".** Actual filing goes through the GST portal, an offline tool upload or a GSP with taxpayer OTP.

## 4. Rules to encode (all versioned by effective date, none hard-coded)
- Place of supply (intra-state: CGST+SGST; inter-state: IGST; export/SEZ special). FlowXP has `modules/gst/states.js`.
- HSN digits requirement by turnover band (*verify*), SAC for services.
- Rate slabs and changes: GST rates were restructured in 2025; **do not hard-code any rate**, load from a tax-rate table with `effective_from` (*verify current slabs*).
- Reverse charge, ITC eligibility and blocked credits (Sec 17(5)), ITC reversal, time limit to claim.
- TDS/TCS under GST and under the Income Tax Act (Zoho notes an update for the Income Tax Act, 2025; *verify what changes and from when*).
- Invoice mandatory fields, serial number rules (unique, up to 16 chars, per financial year), credit/debit note rules, bill of supply for exempt/composition, record retention (commonly 72 months after the due date of the annual return; *verify*).
- Rounding: invoice values in rupees; round-off line allowed; tax computed per line then summed, or per invoice, depending on settings (*verify; pick one and document*).

## 5. Data protection (DPDP)
- The Digital Personal Data Protection Rules, 2025 were reported as notified on about 13 to 14 Nov 2025 (Moneylife, 14 Nov 2025). Commencement is phased: some rules immediately, consent-manager rules after 1 year, most operational duties after **18 months** (secondary sources). That puts the main duties around **May 2027**, *verify exact dates on meity.gov.in*.
- Accounting data includes customers' personal data (names, phones, GSTIN of proprietors). FlowBook is a data fiduciary or processor depending on the contract: decide and write it into the terms.
- Needs: notice and consent where applicable, purpose limitation, retention limits balanced against statutory record retention, breach notification process, erasure/export on request, children's data caution. FlowXP already has `accountDeletion.js` and `backup.js` to build on.
- Retention conflict: tax records must be kept even if a user asks for deletion. Anonymise personal fields, keep the ledger.

## 6. What can and cannot be claimed
| Capability | Can claim when |
|---|---|
| GST invoices, registers, reports | now |
| GSTR-1/3B JSON prepared | now (FlowXP has it) |
| e-invoicing | a GSP integration is built and tested in the government sandbox |
| e-way bill generation | same |
| One-click GST filing | a filing route is contracted, tested end to end, legal reviewed |
| Bank sync | an aggregator or bank agreement is live |

## 7. Open items for a CA / lawyer
Thresholds and time limits by turnover band; current rate slabs; e-way thresholds; retention period; composition scheme limits; DPDP role (fiduciary vs processor); whether FlowBook needs its own GSP/ASP registration or can remain a partner's reseller.
