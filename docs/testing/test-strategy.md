# Test Strategy

**Status:** Active for Phases 0–3. Quality gates: strict `tsc --noEmit` on every package, vitest suites, production builds (`nest build`, `next build`). There is deliberately NO ESLint in this project (owner decision) — type-strictness and tests carry the quality load.

## Layers

### 1. Unit tests (`packages/validation`, `apps/api/test/unit`)
- Pure logic: Zod schemas (GSTIN/phone/PIN/date formats), money primitives (integer paise, HALF_UP rounding, Indian numbering), FEFO ordering (invariant asserted through integration too).
- Run: `pnpm test:unit`.

### 2. Integration tests (`apps/api/test/integration`)
- The REAL Nest app boots against an isolated PostgreSQL database (`medicore_test` on the local cluster, port 5433). Harness: migrations + seed applied, all tables TRUNCATEd, server spawned on :3101, readiness polled.
- Suites:
  - `auth.test.ts` (9): unauthenticated rejection, credential non-revelation, lockout after 5 failures, session lifecycle, password policy, duplicate registration, tenant isolation negatives (unknown org → 404, foreign branch → 403/404), permission denial for limited roles.
  - `catalog.test.ts` (11): product CRUD + change history, SKU duplicates, server-side validation, tenant-isolated product reads, barcode lookup, vendor GSTIN/state consistency, customer pagination envelope, effective-dated tax versions, import preview errors/duplicates + retry-safe commit, permission-gated imports.
  - `inventory.test.ts` (12): opening stock, FEFO order + multi-batch spanning, expired-batch refusal (Drugs Rules 65(17)), explicit-batch ineligibility, oversell rejection, **concurrent deduction serialization** (8 parallel deductions vs stock 10 → exactly 3 succeed, reconciliation intact), transfer dispatch/receipt/over-receipt rejection/cancellation, count variance posting, recall blocking, cross-tenant warehouse denial.
- Run: `pnpm test:integration` (file-parallelism disabled; shared booted server).

### 3. Browser verification (manual, evidence recorded)
- Real Chromium via in-app browser: register → login → dashboard live data → plan-limit enforcement surfaced → warehouse creation → product creation through the form (Zod resolver path) → opening stock via batch form → expiry dashboard buckets. Recorded in the feature matrix as VERIFIED entries.

## Conventions
- Deterministic fixtures: unique emails per run (`t-<hex>@test.local`), random SKUs/batch numbers.
- Test-only affordance: invitation tokens returned when `NODE_ENV=test` (documented in code; never in other environments).
- Negative-path coverage is mandatory (spec §33): every suite asserts denial codes, not just happy paths.
- Test DB uses trust-auth local cluster — never production credentials; `.env` files are gitignored.

## Planned
- Playwright end-to-end journeys (Phase 5+, once POS exists).
- Load/concurrency beyond the current in-process parallel test (dedicated k6/autocannon run in Phase 12).
- Backup-restore drill (operations, Phase 12).
