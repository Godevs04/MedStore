# MEDICORE ERP — Phases 0–3 (greenfield build)

Workspace verified empty (no git repo) → greenfield. Deliverable: a runnable, tested system covering Phase 0 (audit + regulatory research + docs), Phase 1 (foundation), Phase 2 (master data), Phase 3 (batch-level inventory engine). Later phases honestly recorded as NOT STARTED.

## Key decisions
- **Monorepo** (pnpm workspaces): `apps/web` (Next.js App Router, strict TS, Tailwind, shadcn/ui, TanStack Query/Table, React Hook Form, Zod), `apps/api` (NestJS, REST `/api/v1`, @nestjs/swagger OpenAPI), `packages/shared-types`, `packages/validation` (shared Zod schemas). Per spec §3.
- **No ESLint** per your instruction — quality gates: strict `tsc --noEmit` on all packages, unit/integration tests, production builds.
- **Local PostgreSQL** (no Docker). Redis/BullMQ deferred to the phase that first needs background jobs; documented in the decision log.
- **Money**: `Decimal(18,2)` in DB; all arithmetic via a Money helper on integer paise — no floats anywhere in financial paths.
- **No hardcoded tax rates**: effective-dated, versioned tax configuration tables; every posted document stores the rates actually applied.
- `git init` at start; one commit per coherent unit of work.

## Phase 0 — Audit, research, docs
- Regulatory research from official sources (CBIC, CDSCO, Drugs Rules): current GST slabs for medicines by HSN, e-invoice applicability thresholds, Schedule H1 register fields + 3-year retention, pharmacy licence types (20A/20B/21/21B), e-way bill thresholds. Source-linked in `docs/compliance/*`; anything unresolved flagged "requires qualified professional review" — nothing invented.
- Docs: `docs/architecture/{system-architecture,database-design,security-model,transaction-boundaries}.md`, `docs/product/{module-catalog,acceptance-criteria}.md`, `docs/compliance/{india-regulatory-research,gst-requirements,pharmacy-requirements}.md`, `docs/testing/{test-strategy,feature-verification-matrix}.md`, `DECISIONS.md`.

## Phase 1 — Foundation
- Prisma migration v1: users, sessions, login_attempts, password/email tokens, invitations, organizations, memberships, roles, permissions, role_permissions, user_branch_assignments, branches, warehouses, billing_counters, subscription_plans, subscriptions, feature_entitlements, organization_settings, audit_logs — tenant-owned tables carry `organization_id` + composite unique constraints.
- AuthN: argon2id hashing, DB-backed opaque sessions (httpOnly cookies), login/logout, failed-login lockout, password reset + email verification (email delivery behind a port interface — no false claims of sent email), invitation signup.
- AuthZ: full `resource.action` permission catalog, seeded default roles (Owner, Admin, Pharmacist, Store Manager, Cashier, Inventory Manager, Purchase Manager, Accountant, Auditor, Analyst) + custom roles, NestJS guards on every business route, branch scoping, superadmin via seed.
- Tenant isolation: org-scoped service/repository layer; negative cross-tenant tests (must 403/404).
- API conventions: stable error envelope with application error codes, pagination/filter/sort contract, correlation IDs, Idempotency-Key infrastructure (ready for POS), OpenAPI export.
- Web: login, app shell (collapsible sidebar, org/branch switcher, breadcrumbs, user menu), real-data dashboard, user/role management, org settings, audit viewer — with loading/empty/error/permission-denied states.

## Phase 2 — Master data
- Models: products (full pharmacy attribute set incl. generic name, HSN, dosage form, strength, prescription class, schedule, storage, multi-barcode, price set as Decimal), categories, manufacturers, units + conversion factors, product_tax_profiles + tax_rate_versions, product_supplier_mappings, vendors (GSTIN format + state-code consistency check — documented as format check, not government verification; credit terms/limits), customers (categories, credit policy).
- CSV import (products/vendors/customers): upload → server validation → preview with row-level errors → confirmed commit; retry-safe.
- Web UI: product catalog (filter/sort/column visibility), product detail + change history, vendor/customer directories, taxonomy managers.

## Phase 3 — Inventory engine
- Models: inventory_batches (status: saleable/quarantined/recalled/expired-blocked), append-only inventory_movements (actor, doc ref, signed qty, reason), inventory_balances (same-transaction maintained), stock_reservations, adjustments, stock_counts + lines, stock_transfers + lines (dispatch/in-transit/receive).
- Services: FEFO allocation with eligibility filtering and audited override, availability = balance − reservations, configurable expiry thresholds (30/60/90/custom in org settings), opening stock, reason-coded adjustments (compensating movements only — ledger never rewritten), count variance → adjustment, transfers as paired movements with in-transit tracking + over-receipt prevention.
- Negative-stock prevention via row locks (`SELECT … FOR UPDATE`) with concurrency tests proving no oversell; ledger↔balance reconciliation check + test.
- Web UI: batch inventory + expiry dashboard (expired/30/60/90 buckets), stock ledger with traceability, adjustments, counts, transfers.

## Verification per phase (honest reporting)
- Strict `tsc --noEmit`; vitest unit + API integration tests against a real isolated Postgres test DB; `next build` + `nest build` pass.
- Smoke journey via real API: org → invite user → products → vendor → opening stock → FEFO allocation → adjustment → transfer → verify ledger/balances, audit trail, tenant isolation.
- End-of-phase report per spec §37; persistent `feature-verification-matrix.md` with honest statuses.

## Explicitly deferred (recorded NOT STARTED)
Purchasing (P4), POS/billing (P5), returns (P6), accounting (P7), GST e-invoice/e-way (P8), wholesale (P9), reports center (P10), SaaS admin (P11), hardening (P12); Redis/BullMQ, S3, email/PDF delivery arrive with the phases that need them.

## Environment steps
- Verify local Postgres (psql on PATH / Homebrew / Postgres.app); create `medicore_dev` + `medicore_test`. If none exists, stop and report options before any system-wide install.
- pnpm via corepack if absent.