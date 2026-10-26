# System Architecture

**Status:** Implemented for Phases 0–3 (foundation, master data, inventory engine). Later phases build on this architecture without changing its shape.

## Overview

MediCore is a modular monolith: one NestJS API, one Next.js web app, shared TypeScript packages, one PostgreSQL database. Modules own their tables and services; cross-module access goes through exported services, never raw table access.

```
apps/
  web/    Next.js App Router (React 19, Tailwind, TanStack Query, RHF+Zod)
  api/    NestJS REST API (/api/v1, OpenAPI at /api/docs)
packages/
  shared-types/   wire contracts, domain enums, money primitives (integer paise)
  validation/     Zod schemas shared by API controllers and web forms
infrastructure/
  scripts/        local PostgreSQL bootstrap
docs/
  architecture/ product/ compliance/ operations/ testing/
```

## Request flow

```
Browser ──(session cookie + x-organization-id / x-branch-id)──▶ NestJS API
  SessionGuard        → authenticates opaque session token (SHA-256 stored)
  TenantContextGuard  → resolves membership, branch, effective permissions,
                        enforces @RequirePermissions(...) per endpoint
  ZodValidationPipe   → validates every body/query against shared schemas
  Service             → business rules, transactional Prisma operations
  GlobalExceptionFilter → stable error envelope { error: { code, message, details, correlationId } }
```

The web never filters tenant data client-side; every API call carries tenant headers and the server re-derives scope from the session's membership. The client-side org/branch switcher only chooses which headers to send.

## Module map (implemented)

| Module | Owns | Notes |
|---|---|---|
| auth | users, sessions, login attempts, auth tokens, invitations | argon2id; lockout; email port (console transport, explicitly not "delivered") |
| rbac | permission catalog, role templates, TenantContextGuard | 34 permissions; roles grant only explicit permissions |
| organizations | orgs, memberships, branches, warehouses, counters, settings, licences, document-number sequences, plans/subscriptions/entitlements | setup checklist gates posting readiness |
| audit | audit_logs (append-only) | failures logged loudly, never block business ops |
| catalog | products, barcodes, categories, manufacturers, tax rate versions, product change history | barcode lookup for POS |
| partners | vendors, customers | GSTIN format + state-code consistency |
| inventory | batches, movement ledger, balances, reservations, adjustments, counts, transfers, recalls | FEFO; row-locked balance deltas; reconciliation |

## Key invariants (enforced in code and tested)

1. Money never in floats — `Decimal(18,4)`/`Decimal(18,2)` columns; computation helpers on integer paise (`@medicore/shared-types/money`).
2. Tax rates never hardcoded — versioned `TaxRateVersion` rows; posted documents will snapshot applied rates (Phase 5+).
3. Inventory ledger is append-only; balances maintained under `SELECT ... FOR UPDATE` in the same transaction as the movement insert; a reconciliation endpoint proves balance == Σ movements.
4. FEFO allocation only among eligible batches (SALEABLE, not expired — Drugs Rules 65(17) blocking); explicit batch override is permitted and audited.
5. All org-scoped endpoints require `@RequirePermissions`; membership/branch resolution happens server-side per request.

## Deferred infrastructure decisions

See [DECISIONS.md](../DECISIONS.md): Redis/BullMQ, S3, SMTP, Sentry/OTel are deferred to the phases that first need them (background imports, attachments, e-invoice integrations, hardening). Each is recorded with its trigger phase so nothing silent ships.
