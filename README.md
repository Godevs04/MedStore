# MediCore — Indian Pharmacy ERP SaaS

Production-oriented pharmacy management platform: billing, batch-level inventory, purchasing, distribution, taxation, accounting, regulatory recordkeeping, multi-branch operations, and SaaS administration.

**Status: PRD §38 acceptance journey implemented end to end.** That covers the foundation (organizations, branches, users, roles, audit), product catalog and tax configuration, batch inventory, purchasing (PO → GRN → supplier invoice → payment → debit note), POS billing with printable tax invoices, returns and receivables, double-entry accounting (statements, journals, reversals, period locks), compliance registers (Schedule H1, GST summaries, licences) and reports with audited CSV exports. It runs as a multi-tenant SaaS: subscription plans gate modules and quotas server-side, lapsed or suspended tenants are restricted, owners see usage on **Plan & billing**, and platform administrators manage tenants and plans from the **Platform console**. External integrations (IRP e-invoice, e-way bill, payments, messaging) are deliberately **not connected**. See [docs/testing/feature-verification-matrix.md](docs/testing/feature-verification-matrix.md) for honest per-feature status.

## Quick start

```bash
# 1. PostgreSQL (dedicated local cluster, port 5433 — uses installed PostgreSQL 18)
./infrastructure/scripts/start-postgres.sh

# 2. Install + database
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm db:migrate        # prisma migrate deploy (dev DB)
pnpm db:seed           # permissions, subscription plans (+ optional superadmin via SUPERADMIN_EMAILS)

# 3. Run
pnpm --filter @medicore/api build && pnpm --filter @medicore/api start   # API on :3001
pnpm --filter @medicore/web dev                                          # Web on :3000

# 4. Verify
pnpm lint                                                      # ESLint (type-aware) for API, packages, web; zero warnings allowed
pnpm typecheck
pnpm --filter @medicore/api build && pnpm test:integration     # 77 integration tests vs medicore_test (runs dist/main.js)
pnpm --filter @medicore/api exec tsx scripts/e2e-journey.ts   # 47-step business journey → e2e-results.json
pnpm --filter @medicore/web build                              # production build
# while `next dev` is running, build into a separate folder:
NEXT_DIST_DIR=.next-build pnpm --filter @medicore/web build   # then: git checkout apps/web/tsconfig.json (Next adds an include)
```

To use the platform console, set `SUPERADMIN_EMAILS` before seeding (or flag an existing user's `isPlatformSuperadmin`), then open `/platform`.

## API reference

With the API running, open **http://localhost:3001/api/docs** for the interactive [Scalar](https://scalar.com) reference. It covers all 135 endpoints, grouped by module, each with a summary, description, required permissions and plan module, tenant headers, request body and query schemas, examples, business error codes and response shapes. You can "Try it" in the browser after signing in through `POST /auth/login`. The raw OpenAPI 3 document is served at `/api/openapi.json`, and `pnpm --filter @medicore/api openapi:export` writes it to `docs/api/openapi.json`.

Request schemas come straight from the Zod validation pipes, so the docs always match what the server validates. Summaries and descriptions live in `apps/api/src/openapi/operation-docs.ts`. The API refuses to start if a route is missing there, if an entry has no route, or if an example fails its schema.

Register the first organization at `http://localhost:3000/register`, then on the dashboard checklist: fill the business profile (Settings), add a warehouse (Branches), and click **Load standard GST rates** in Configuration. Sales are blocked for any HSN without an effective rate.

## Layout

- `apps/api` — NestJS REST API (`/api/v1`; Scalar reference at `/api/docs`, OpenAPI at `/api/openapi.json`)
- `apps/web` — Next.js App Router frontend
- `packages/shared-types` — wire contracts, enums, money primitives (integer paise)
- `packages/validation` — Zod schemas shared by API and web forms
- `docs/` — architecture, product, compliance research (sourced), operations, testing
- `DECISIONS.md` — decision log with rationale

## Non-negotiables enforced in code

- No hardcoded tax rates (versioned, effective-dated config; posted docs snapshot applied rates)
- No floats in money paths (Decimal columns; integer-paise math, HALF_UP)
- Append-only inventory ledger + audit log; balances row-locked in-transaction; reconciliation endpoint
- Server-side tenant scoping and permission checks on every business endpoint (negative tests prove it)
- Expired/recalled/quarantined batches can never be sold (Drugs Rules 65(17)); FEFO default with audited override
- Plan entitlements (modules, invoice quota, branch/user/warehouse limits) and subscription state are enforced by the API, not just hidden in the UI
