# MediCore — Indian Pharmacy ERP SaaS

Production-oriented pharmacy management platform: billing, batch-level inventory, purchasing, distribution, taxation, accounting, regulatory recordkeeping, multi-branch operations, and SaaS administration.

**Status: Phases 0–3 complete** (foundation, master data, inventory engine). See [docs/testing/feature-verification-matrix.md](docs/testing/feature-verification-matrix.md) for honest per-feature status.

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
pnpm typecheck && pnpm test:integration   # 32 integration tests vs medicore_test
```

Register the first organization at `http://localhost:3000/register`.

## Layout

- `apps/api` — NestJS REST API (`/api/v1`, OpenAPI at `/api/docs`)
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
