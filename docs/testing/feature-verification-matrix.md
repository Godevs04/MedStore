# Module Catalog & Feature Verification Matrix

Statuses: NOT STARTED · IN PROGRESS · IMPLEMENTED (code + UI exists) · TESTED (automated tests pass) · VERIFIED (end-to-end/manual evidence) · BLOCKED

## Foundation

| Feature | Backend | Frontend | Database | Tests | Evidence / notes |
|---|---|---|---|---|---|
| Registration (org bootstrap) | TESTED | VERIFIED | TESTED | auth.test.ts; browser run | Creates org, roles, trial, branch, settings in one tx |
| Login / logout / sessions | TESTED | VERIFIED | TESTED | auth.test.ts | Cookie + Bearer; session list/revoke endpoints |
| Failed-login lockout | TESTED | — | TESTED | auth.test.ts (423 after 5) | |
| Password reset / email verify | IMPLEMENTED | NOT STARTED (web pages pending) | TESTED | token flows exercised via invitations | Console email transport — no delivery claim |
| Invitations & acceptance | TESTED | PARTIAL (invite via Users page; accept page pending) | TESTED | auth.test.ts, catalog.test.ts | Test env returns token; production needs email delivery |
| RBAC permission enforcement | TESTED | PARTIAL (nav cosmetic; server authoritative) | TESTED | auth.test.ts, catalog.test.ts (403 assertions) | 34-permission catalog; custom roles |
| Tenant isolation | TESTED | — | TESTED | auth.test.ts, catalog.test.ts, inventory.test.ts | 404/403 negative paths |
| Branch / warehouse / counter management | TESTED | VERIFIED (branch+warehouse) | TESTED | via harness setup | Counters modelled, UI pending |
| Org settings & setup checklist | TESTED | VERIFIED | TESTED | checklist drives gating; browser run | Posting gate enforced from Phase 5 |
| Plan limits (branches/users) | TESTED | VERIFIED (browser: "Branch limit reached") | TESTED | — | Configurable plan limits JSON |
| Audit logging (append-only) | TESTED | VERIFIED (audit page) | TESTED | events asserted indirectly | UPDATE/DELETE revoke pending Phase 12 |
| Subscription lifecycle | IMPLEMENTED | PARTIAL (status shown) | IMPLEMENTED | — | Renewal/payment flows deferred to Phase 11 |

## Master data

| Feature | Backend | Frontend | Database | Tests | Notes |
|---|---|---|---|---|---|
| Product CRUD + change history | TESTED | VERIFIED (create via UI) | TESTED | catalog.test.ts | SKU unique; barcodes; pharmacy attributes |
| Barcode lookup | TESTED | — (POS path) | TESTED | catalog.test.ts | |
| Duplicate detection (strength-aware) | IMPLEMENTED | NOT STARTED | TESTED | — | Never merges differing strengths/forms |
| Categories / manufacturers | IMPLEMENTED | NOT STARTED | TESTED | — | API exists; UI pending |
| Tax rate versions (effective-dated) | TESTED | NOT STARTED | TESTED | catalog.test.ts | No hardcoded rates anywhere |
| Vendors (GSTIN format + state check) | TESTED | VERIFIED (page builds; API test) | TESTED | catalog.test.ts | Format check only — not government verification |
| Customers | TESTED | IMPLEMENTED (page) | TESTED | catalog.test.ts | |
| CSV import (products/vendors/customers) | TESTED | IMPLEMENTED (import page) | TESTED | catalog.test.ts | Row-level errors; batch+DB duplicate detection; retry-safe commit |

## Inventory engine

| Feature | Backend | Frontend | Database | Tests | Notes |
|---|---|---|---|---|---|
| Batch creation (opening stock, lot merge) | TESTED | VERIFIED (browser) | TESTED | inventory.test.ts | (org, product, warehouse, batchNo, expiry) unique |
| FEFO allocation | TESTED | — (Phase 5 consumes) | TESTED | inventory.test.ts | earliest expiry first; multi-batch spanning |
| Expired batch blocking | TESTED | — | TESTED | inventory.test.ts | Drugs Rules 65(17) |
| Explicit batch override (audited) | TESTED | — | TESTED | inventory.test.ts | INVENTORY_LEDGER_OVERRIDE audit event |
| Oversell prevention (row-locked) | TESTED | — | TESTED | inventory.test.ts (8 concurrent, exactly 3 succeed) | Never negative |
| Append-only movement ledger | TESTED | VERIFIED (ledger page) | TESTED | reconciliation after ops | |
| Ledger↔balance reconciliation | TESTED | — | TESTED | inventory.test.ts | /inventory/reconcile |
| Stock adjustments (reason-coded) | TESTED | NOT STARTED (UI pending) | TESTED | inventory.test.ts | |
| Stock transfers (dispatch/receive/cancel) | TESTED | NOT STARTED | TESTED | inventory.test.ts | Over-receipt blocked; cancel returns stock |
| Stock counts (variance posting) | TESTED | NOT STARTED | TESTED | inventory.test.ts | |
| Expiry dashboard (buckets) | TESTED | VERIFIED (browser) | TESTED | — | 30/60/90/custom thresholds |
| Recalls | TESTED | NOT STARTED | TESTED | inventory.test.ts | RECALLED blocks allocation |
| Stock reservations | IMPLEMENTED (model) | NOT STARTED | IMPLEMENTED | — | Used from Phase 5 carts |

## Compliance registers, purchasing, POS, accounting, wholesale, reports, SaaS admin, integrations

**NOT STARTED** — Phases 4–12. Regulatory research for GST and pharmacy requirements is complete and documented ([gst-requirements.md](../compliance/gst-requirements.md), [pharmacy-requirements.md](../compliance/pharmacy-requirements.md)) with implementation mapping tables. No external integration (e-invoice, e-way bill, payments, WhatsApp/SMS) has been connected or tested — none is represented as operational (spec §1.32).
