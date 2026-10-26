# Decision Log

| # | Date | Decision | Rationale / alternatives |
|---|---|---|---|
| 1 | 2026-10-27 | Greenfield pnpm monorepo (apps/web, apps/api, packages/*) per spec §3 default | Workspace empty; no existing constraints |
| 2 | 2026-10-27 | Local dedicated PostgreSQL 18 cluster at `~/medicore-pgdata`, port 5433, trust auth, user `medicore` | System Postgres on 5432 required credentials we don't have; Docker unavailable per user. Self-contained cluster avoids touching the system instance. Start script: `infrastructure/scripts/start-postgres.sh` |
| 3 | 2026-10-27 | No ESLint (owner instruction) | Gates: strict tsc on all packages, vitest unit+integration, production builds. Recorded as the project's quality contract |
| 4 | 2026-10-27 | Internal packages compile to CJS `dist/` (not TS-source consumption) | NestJS (CJS) + Next.js mixed module systems made TS-source sharing fragile (TS1295/TS6059/dist-mirroring). Compiled dist consumed via node_modules works for both consumers |
| 5 | 2026-10-27 | Redis/BullMQ deferred until first background-job need (large imports, Phase 4/10) | Spec §3 lists Redis; nothing in Phases 0–3 is asynchronous yet. Documented deferral, not silent omission |
| 6 | 2026-10-27 | Money: Decimal columns + integer-paise helpers (`@medicore/shared-types/money`) | Spec §1.29/§17. HALF_UP deterministic rounding tested |
| 7 | 2026-10-27 | Session auth via opaque hashed tokens in cookies (not JWT) | Revocation, session listing, and sliding expiry are first-class; JWT revocation is awkward for a counter UI |
| 8 | 2026-10-27 | Org registration seeds ALL system roles with explicit permission sets | Spec §4 role list; makes Users page immediately usable; roles still grant only explicit permissions |
| 9 | 2026-10-27 | Branch header optional in TenantContextGuard; branch-needing endpoints validate presence | Fresh orgs have no branch to send; org-agnostic endpoints (settings, roles) must work. Server still validates every provided branch |
| 10 | 2026-10-27 | Audit writes AFTER commit, separate connection | Writing inside the tx races uncommitted FK targets (observed: AUDIT WRITE FAILED on registration). Trade-off: audit is best-effort until outbox (BullMQ) lands |
| 11 | 2026-10-27 | Lockout fires AFTER 5th failure (5th returns 401, 6th returns 423) | Conventional behavior; test pins it |
| 12 | 2026-10-27 | Transfers deduct on dispatch (no reservation-hold), stock "in transit" represented by the transfer document | Spec §19: creating a transfer must not duplicate stock; receipt upserts the same lot at destination; cancellation returns undelivered qty. Reservation model exists for POS carts |
| 13 | 2026-10-27 | Batch merge key = (org, product, warehouse, batchNumber, expiryDate) | Same manufacturer lot received twice at one site is one batch; differing expiry is a different batch (correctness over storage economy) |
| 14 | 2026-10-27 | Import: client parses CSV, server re-validates everything | Avoids multipart/multer complexity while keeping §29's mandatory server-side validation; duplicate keys make commits retry-safe |
| 15 | 2026-10-27 | Console email transport explicitly "not delivered" | Spec §1.32: never represent an unconnected integration as operational |
| 16 | 2026-10-27 | Test-only invitation-token return under NODE_ENV=test | Integration tests need the acceptance flow; hash-only storage otherwise prevents it; guarded by environment |
| 17 | 2026-10-27 | Prisma 6 (not 7/8 RC) | Stability for a foundation phase; upgrade path documented |

## Assumptions & unresolved questions

- Tax rate seeds (when Phase 8 builds the rate master) MUST be built from the official CBIC schedule; this repo's research doc lists effective slabs with sources and flags the nil-rated drug list as needing verification.
- Whether a tenant is on the ₹40L vs ₹20L registration threshold is state-specific — recorded as "needs review" in the GST doc.
- Computerised-records conditions for Drugs Rules (the "65(2)(b) printouts" claim) could NOT be verified in official text — flagged for professional review; MediCore implements state-practice-agnostic digital records with exports.
- H1 physical-prescription retention beyond the 3-year register is state practice — flagged, not assumed.
