# GST Requirements — Research Findings (India)

**Status:** Research baseline as of 2026-10-27, compiled from the sources listed per section. Rates and thresholds are **versioned configuration** in MediCore (see "Implementation rules" below) — nothing in this document may be hardcoded into application logic.

> ⚠️ These findings inform configurable defaults. Final applicability for any tenant depends on their registration, turnover, state, and transaction type. MediCore does not provide tax advice; configurations must be reviewed by the tenant's tax professional. Items marked **needs review** must be verified against the latest CBIC notifications before relying on them for filing.

## 1. GST rates for medicines (HSN Chapter 30) — "GST 2.0"

- The 56th GST Council (3 Sep 2025) restructured rates effective **22 September 2025**: main slabs are **5% and 18%**, plus a **40% de-merit rate** for sin/luxury goods. The 12% slab was largely merged into 5%; 28% into 18%.
- **Most medicines/formulations (Ch. 30) dropped from 12% to 5%** (drugs, vaccines HSN 3002, nutraceuticals, vitamin formulations).
- A list of ~33–36 life-saving/cancer drugs moved from 5% to **nil (exempt)** — **needs review:** exact count (sources cite both 33 and 36) and item-by-item Chapter 30 exceptions; the ERP rate master must be seeded from the official CBIC rate schedule.
- **Medical devices, diagnostics, kits, oxygen, consumables (gloves, gauze) → uniform 5%** (from 12%/18%).
- Effective date: 22 Sep 2025 (Notification No. 09/2025–Central Tax (Rate), dated 17 Sep 2025).
- Sources:
  - https://www.pib.gov.in/FactsheetDetails.aspx?Id=150302
  - https://taxguru.in/goods-and-service-tax/gst-mega-reforms-india-rates-slabs-key-2025.html
  - https://www.ey.com/content/dam/ey-unified-site/ey-com/en-in/alerts-hub/2025/09/gst-reduction-on-medicines-and-medical-devices-for-affordable-healthcare.pdf
  - https://morulaa.com/knowledge-hub/regulations/india/india-gst-reduction-medical-devices-diagnostics
  - https://busy.in/gst-rates/medicines

**Confidence:** Verified (multiple sources) for slab structure, medicines at 5%, devices at 5%. Nil-rated drug list: needs review.

## 2. E-invoicing (IRN)

- Mandatory for taxpayers with **aggregate annual turnover > ₹5 crore** (per PAN across all GSTINs) since 1 Aug 2023 (Notification 10/2023-CT); once crossed in any year since 2017-18, the obligation persists.
- **Notified-out:** government departments & local authorities, SEZ *units*, banks/NBFCs/insurers, GTAs, passenger transport service, cinema ticket sellers.
- **Reporting time limit: 30 days from invoice date, applicable to taxpayers with AATO ≥ ₹10 crore, since 1 April 2025** (Rule 48E; GSTN advisory). There is **no 30-minute rule in force**; older invoices are rejected by IRPs.
- Sources:
  - https://einvoice1.gst.gov.in/Others/Notifications
  - https://einvoice1.gst.gov.in/Documents/advisory270325.pdf
  - https://www.xflowpay.com/blog/e-invoice-limit
  - https://tax2win.in/guide/e-invoicing-gst

**Confidence:** Verified (multiple sources). **Needs review:** reported B2C e-invoicing rollout and possible threshold reduction for FY 2026-27 (not confirmed in force).

## 3. E-way bill

- Rule 138 CGST Rules: consignment value **exceeding ₹50,000** requires FORM GST EWB-01 (since 1 Apr 2018; unchanged). Below threshold optional unless a state mandates lower thresholds for specific goods.
- **No blanket pharma/medicine exemption found** in Rule 138 / Notification 74/2018 exemption lists.
- Sources:
  - https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter16/rule138_v1.00.html
  - https://razorpay.com/learn/what-is-e-way-bill-exemption
  - https://docs.ewaybillgst.gov.in/documents/EWBRules.pdf

**Confidence:** Threshold verified. "No pharma exemption" is absence-of-evidence — **state-specific thresholds for pharma need per-state review**.

## 4. Composition scheme (relevant to small pharmacies)

- Retail traders (incl. pharmacies) with turnover up to **₹1.5 crore** (₹75 lakh special category states) may opt in under Section 10: **1% (0.5% CGST + 0.5% SGST)** of turnover in the State/UT.
- Restrictions: **no ITC**, **no inter-state outward supply of goods**, cannot charge tax on invoices ("composition taxable person, not eligible to collect tax on supplies" legend), must issue **bill of supply**, not tax invoice.
- Sources:
  - https://cbic-gst.gov.in/pdf/faq-manual/faq-composition-levy-revised.pdf
  - https://tax2win.in/guide/gst-composition-scheme
  - https://razorpay.com/learn/gst-composition-scheme-benefits

**Confidence:** Verified.

## 5. GST registration thresholds

- Goods-exclusive suppliers: **₹40 lakh** aggregate turnover (Notification 10/2019-CT, effective 1 Apr 2019, state-by-state adoption); **₹20 lakh** in special category states.
- Services or mixed supplies: **₹20 lakh** (₹10 lakh special category states).
- **Medicines are NOT "declared goods"** — that concept belonged to Section 14 of the pre-GST CST Act 1956 and does not force lower thresholds on pharmacies.
- Note: **Section 14 of the CGST Act** is a different provision — change in rate of tax during movement of goods (relevant to GST 2.0 transition pricing).
- Sources:
  - https://gstcouncil.gov.in/node/4096
  - https://www.pib.gov.in/Pressreleaseshare.aspx?PRID=1567975
  - https://tax2win.in/guide/gst-registration-limit
  - https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter4/section14_v1.00.html
  - https://www.dor.gov.in/introduction-central-sales-taxes

**Confidence:** Verified for thresholds and the Section 14 distinction. **Needs review:** current state-by-state adoption list of ₹40 lakh vs ₹20 lakh for goods.

## 6. Tax invoice issuance (goods)

- **Section 31(2) CGST Act:** for goods, issue the tax invoice **before or at the time of removal** (where movement is involved) or **before or at the time of delivery** (no movement). Rule 47's 30-day limit applies to services, not goods.
- **Bill of supply** (Rule 49; proviso to Section 31(3)) for composition dealers and exempt suppliers — no tax may be charged.
- Sources:
  - https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter7/section31_v1.00.html
  - https://d23z1tp9il9etb.cloudfront.net/download/pdf25/Handbook_on_Invoicing_under_GST17-06-2025.pdf

**Confidence:** Verified (CBIC statute text + official handbook).

## 7. Return cycle (regular taxpayers)

- **GSTR-1 by the 11th**, **GSTR-3B by the 20th** of the following month.
- **QRMP** (AATO ≤ ₹1.5 crore): quarterly GSTR-1 (13th of month after quarter) and GSTR-3B (22nd/24th by state) with monthly PMT-06 payment; optional monthly IFF by the 13th.
- Composition: **CMP-08 quarterly (18th)** and **GSTR-4 annually**.
- Sources:
  - https://tutorial.gst.gov.in/userguide/returns/FAQs_change_profile.htm
  - https://blog.saginfotech.com/gst-due-dates-e-filing-of-tax-return
  - https://tax2win.in/guide/qrmp-scheme-under-gst

**Confidence:** Verified.

---

## Implementation rules (binding for MediCore code)

1. **No hardcoded tax rates anywhere.** All rates/thresholds live in versioned, effective-dated configuration tables; each posted transaction stores the rates actually applied (spec §13).
2. The rate master seed must be built from the official CBIC rate schedule; seeds in this repository are **development defaults** and must be reviewed before production use.
3. E-invoicing/e-way bill integrations must implement **sandbox and production modes**, never fabricate IRN/ack/QR/EWB values, and mark themselves `NOT STARTED` in the feature matrix until actually connected and tested (spec §1.32).
4. Composition-tenants must be served **bill of supply** documents and blocked from ITC workflows; invoice templates must support the required composition legend.
5. Invoice issue time semantics: invoice is created at/before dispatch — the POS posting flow must not permit posting without document creation (Section 31(2) behavior encoded in Phase 5 workflow).
