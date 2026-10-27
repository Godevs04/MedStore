# Module Catalog & Feature Verification Matrix

Statuses: NOT STARTED · IN PROGRESS · IMPLEMENTED (code + UI exists) · TESTED (automated tests pass) · VERIFIED (end-to-end/manual evidence) · BLOCKED · NOT CONNECTED (external integration deliberately not represented as operational)

Evidence sources:
- **Integration** — `pnpm --filter @medicore/api test:integration` (76 tests across `auth`, `catalog`, `inventory`, `commerce`, `acceptance`, `saas` suites, real API on `medicore_test`).
- **E2E** — `pnpm --filter @medicore/api exec tsx scripts/e2e-journey.ts` (47 asserted steps, results in `e2e-results.json`).
- **Browser** — live walk of the PRD §38 journey against `localhost:3000` / `:3001`.

## Foundation

| Feature | Backend | Frontend | Database | Tests | Evidence / notes |
|---|---|---|---|---|---|
| Registration (org bootstrap) | TESTED | VERIFIED | TESTED | auth.test.ts; E2E-01 | Creates org, roles, trial, branch, settings in one tx |
| Login / logout / sessions | TESTED | VERIFIED | TESTED | auth.test.ts; E2E-02/03 | Cookie + Bearer; session list/revoke endpoints |
| Failed-login lockout | TESTED | — | TESTED | auth.test.ts (423 after 5) | |
| Password reset / email verify | IMPLEMENTED | IMPLEMENTED (forgot/reset pages) | TESTED | token flows exercised via invitations | Console email transport — no delivery claim |
| Invitations & acceptance | TESTED | IMPLEMENTED (Users invite + accept page) | TESTED | auth.test.ts, catalog.test.ts | Production needs email delivery |
| RBAC permission enforcement | TESTED | IMPLEMENTED (nav + actions gated by permission; server authoritative) | TESTED | auth.test.ts, catalog.test.ts (403 assertions) | Custom roles |
| Tenant isolation | TESTED | — | TESTED | auth/catalog/inventory/acceptance suites; E2E-28/29 | Non-membership returns 404 (no existence leak); cross-tenant invoice read/return rejected |
| Branch / warehouse management | TESTED | VERIFIED | TESTED | harness setup; E2E-04/05 | |
| Org settings & setup checklist | TESTED | VERIFIED | TESTED | E2E-06/07 | Posting gate enforced for sales/purchases |
| Plan limits (branches/users/warehouses) | TESTED | VERIFIED | TESTED | saas.test.ts | Configurable plan limits JSON; −1 = unlimited |
| Plan module entitlements | TESTED | IMPLEMENTED (locked nav items show "Upgrade") | — | saas.test.ts (`FEATURE_NOT_ENTITLED` 403) | purchases, accounting, pos, returns gated per plan; trial includes all modules |
| Monthly invoice quota | IMPLEMENTED | IMPLEMENTED (usage meter) | — | — | `PLAN_LIMIT_REACHED` when the IST-month count hits the plan limit |
| Lapsed subscription | TESTED | IMPLEMENTED (banner) | — | saas.test.ts (402 on writes, reads allowed) | Expired/cancelled, or past period + grace |
| Tenant suspension | TESTED | IMPLEMENTED (platform console) | TESTED | saas.test.ts | Revokes sessions; 403 except subscription view; settings preserved |
| Plan & billing page | TESTED (`GET /organizations/subscription`) | IMPLEMENTED | — | saas.test.ts | Current plan, usage meters, plan comparison. Online payment collection not connected |
| Audit logging (append-only) | TESTED | VERIFIED (audit page) | TESTED | E2E-27; saas.test.ts (actor named) | DB triggers reject UPDATE/DELETE on audit, ledger and journal lines |
| Live dashboard | TESTED | IMPLEMENTED | — | E2E-46 | KPIs (today/month sales, receivables, payables, stock value), alerts, recent invoices, module tiles; welcome state for users without a workspace |
| Feedback (toasts) | — | IMPLEMENTED | — | — | Every mutation toasts success/failure with the server's field-level message; session expiry toast |
| Shared-browser sign-in | TESTED | IMPLEMENTED | — | saas.test.ts | Auth/platform routes ignore a stale tenant header; switching org/branch resets cached data |

## Master data & tax

| Feature | Backend | Frontend | Database | Tests | Notes |
|---|---|---|---|---|---|
| Product CRUD + change history | TESTED | VERIFIED | TESTED | catalog.test.ts | Edit drawer; GST column shows resolved rate or "No rate" |
| Barcode lookup | TESTED | IMPLEMENTED (POS scan) | TESTED | catalog.test.ts; E2E-10 | |
| Duplicate detection (strength-aware) | IMPLEMENTED | NOT STARTED | TESTED | — | Never merges differing strengths/forms |
| Tax rate versions (effective-dated) | TESTED | IMPLEMENTED (Configuration: add / end / status) | TESTED | catalog.test.ts | No hardcoded rates in posting paths |
| Standard GST loader | TESTED | IMPLEMENTED | TESTED | acceptance.test.ts | Loads 5% medicine HSNs effective 2025-09-22; idempotent; audited. Must be reviewed against CBIC notifications |
| Missing tax rate blocks posting | TESTED | IMPLEMENTED (POS line warning) | — | acceptance.test.ts | `TAX_RATE_MISSING` (422) — never silently zero-rated |
| Vendors (GSTIN format + state check) | TESTED | VERIFIED | TESTED | catalog.test.ts | Ledger, open invoices, edit drawer. Format check only |
| Customers | TESTED | IMPLEMENTED | TESTED | catalog.test.ts | Statement, invoices, receive payment, edit |
| CSV import | TESTED | IMPLEMENTED | TESTED | catalog.test.ts | Row-level errors; retry-safe commit |

## Inventory engine

| Feature | Backend | Frontend | Database | Tests | Notes |
|---|---|---|---|---|---|
| Batch creation (opening stock, lot merge) | TESTED | VERIFIED | TESTED | inventory.test.ts | |
| FEFO allocation | TESTED | IMPLEMENTED (POS "Auto FEFO") | TESTED | inventory.test.ts; acceptance.test.ts | Multi-batch spanning |
| Expired / recalled / quarantined blocking | TESTED | IMPLEMENTED (disabled in POS batch picker) | TESTED | inventory.test.ts; acceptance.test.ts; E2E-24 | Drugs Rules 65(17) |
| Explicit batch override (audited) | TESTED | IMPLEMENTED | TESTED | inventory.test.ts | |
| Oversell prevention (row-locked) | TESTED | — | TESTED | inventory.test.ts (8 concurrent) | Never negative |
| Append-only movement ledger | TESTED | VERIFIED | TESTED | E2E-26 | |
| Ledger↔balance reconciliation | TESTED | — | TESTED | E2E-25 | |
| Stock adjustments (with GL posting) | TESTED | IMPLEMENTED | TESTED | acceptance.test.ts | Dr Inventory loss / Cr Inventory at batch cost |
| Stock transfers | TESTED | IMPLEMENTED | TESTED | inventory.test.ts; E2E-18/19/20 | |
| Stock counts | TESTED | IMPLEMENTED | TESTED | inventory.test.ts; E2E-21/22 | |
| Expiry dashboard | TESTED | VERIFIED | TESTED | E2E-17 | |
| Recalls | TESTED | IMPLEMENTED | TESTED | E2E-23/33 | |

## Purchasing

| Feature | Backend | Frontend | Database | Tests | Notes |
|---|---|---|---|---|---|
| Purchase orders (send/confirm/cancel) | TESTED | IMPLEMENTED | TESTED | commerce.test.ts; E2E-34 | FY numbering `PO/2627/000001` |
| Goods receipt (batch-wise, partial) | TESTED | IMPLEMENTED (GRN drawer, split batches) | TESTED | acceptance.test.ts; E2E-35 | Over-receipt blocked; PO → PARTIALLY_RECEIVED / RECEIVED |
| Supplier invoice (three-way match) | TESTED | IMPLEMENTED | TESTED | commerce/acceptance; E2E-36 | Quantity mismatch rejected; duplicate supplier invoice no. rejected; inventory booked here |
| Supplier payments (multi-invoice allocation) | TESTED | IMPLEMENTED | TESTED | commerce.test.ts; E2E-37 | Over-allocation rejected |
| Purchase returns / debit notes | TESTED | IMPLEMENTED | TESTED | commerce.test.ts | Reverses input GST |
| Vendor ledger | TESTED | IMPLEMENTED | — | commerce.test.ts | Running balance, open invoices, overdue days |

## POS billing, returns and receivables

| Feature | Backend | Frontend | Database | Tests | Notes |
|---|---|---|---|---|---|
| POS sale (tax-inclusive GST, FEFO) | TESTED | IMPLEMENTED | TESTED | commerce/acceptance; E2E-38 | Keyboard: F2 search, F9 charge; barcode scan |
| Whole-rupee rounding | TESTED | IMPLEMENTED | — | acceptance.test.ts | Tenders must equal rounded total |
| Split tender (cash / UPI / card / credit) | TESTED | IMPLEMENTED | — | acceptance.test.ts | Cash → Cash in Hand; UPI/card/bank → Bank |
| MRP ceiling | TESTED | IMPLEMENTED | — | commerce.test.ts; E2E-40 | DPCO |
| Idempotent retry | TESTED | IMPLEMENTED (key kept on retry) | TESTED | commerce.test.ts; E2E-39 | |
| IGST for inter-state customers | TESTED | IMPLEMENTED | — | acceptance.test.ts | Place of supply from customer state |
| Credit limit | TESTED | IMPLEMENTED | — | commerce/acceptance | `CREDIT_LIMIT_EXCEEDED`; limit 0 = no limit |
| Schedule H1 capture | TESTED | IMPLEMENTED | TESTED | commerce.test.ts | Blocks sale without prescriber details |
| Tax invoice / bill of supply print | — | IMPLEMENTED (A4 + 72 mm thermal) | — | browser | HSN summary, amount in words, licences |
| Sales returns / credit notes (multi-batch) | TESTED | IMPLEMENTED | TESTED | commerce/acceptance; E2E-41 | Restock per original batch; open credit settled first; RETURNED status |
| Customer receipts & statement | TESTED | IMPLEMENTED | — | commerce.test.ts; E2E-42 | |

## Accounting

| Feature | Backend | Frontend | Database | Tests | Notes |
|---|---|---|---|---|---|
| Automatic journals (sale, COGS, purchase, payments, returns, stock) | TESTED | IMPLEMENTED (journal list) | TESTED | acceptance.test.ts | Balanced-or-reject; append-only lines |
| Manual journals | TESTED | IMPLEMENTED | — | acceptance.test.ts | Unbalanced rejected (422) |
| Reversals | TESTED | IMPLEMENTED | — | acceptance.test.ts | Once only; reversal of a reversal rejected |
| Period locking | TESTED | IMPLEMENTED | TESTED | commerce/acceptance | Blocks every posting dated in the month |
| Trial balance / P&L / balance sheet | TESTED | IMPLEMENTED | — | acceptance.test.ts; E2E-43/44 | GL drill-down with running balance |
| Expenses | TESTED | IMPLEMENTED | — | commerce.test.ts | |
| Inventory GL ↔ stock valuation | TESTED | IMPLEMENTED (reports) | — | acceptance.test.ts | Gap = goods received but not yet billed |

## Compliance & reports

| Feature | Backend | Frontend | Database | Tests | Notes |
|---|---|---|---|---|---|
| Schedule H1 register + CSV | TESTED | IMPLEMENTED | TESTED | commerce.test.ts | |
| GST outward / inward summaries (HSN, B2B/B2C, ITC) | TESTED | VERIFIED (+ HSN CSV) | — | commerce/acceptance; E2E-45 | Net of credit / debit notes. ITC counts only suppliers with a GSTIN; tax from unregistered suppliers shown as not claimable. Not a filed return |
| Reports ↔ books consistency | TESTED | VERIFIED | — | acceptance.test.ts | Sales-report net sales and margin come from the P&L; tender mix excludes later receipts; returns net out of product, dashboard and daily figures |
| Licence register with expiry alerts | IMPLEMENTED | VERIFIED | TESTED | — | Red banner ≤30 days, amber ≤60 days; listed on the dashboard "Needs attention" panel |
| Sales / stock valuation / aging reports + CSV | TESTED | IMPLEMENTED | — | commerce/acceptance | Exports require `reports.export` and are audited |
| Notifications (low stock, near expiry, licences) | TESTED | IMPLEMENTED | TESTED | commerce.test.ts | |
| Wholesale flag | TESTED | — | TESTED | commerce.test.ts | |
| Platform administration | TESTED | IMPLEMENTED (`/platform`) | TESTED | commerce.test.ts; saas.test.ts | Overview, tenant search, assign plan/status/period, suspend/reactivate, plan limit editor (validated) |

## External integrations

**NOT CONNECTED** — GST e-invoice (IRP), e-way bill, payment gateways, WhatsApp/SMS and email delivery are registered in the integrations screen as `NOT_CONNECTED`. None is represented as operational (spec §1.32).
