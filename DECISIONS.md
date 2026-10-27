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
| 18 | 2026-10-27 | Document numbers are per-organization, per-Indian-financial-year sequences: `SCOPE/YYyy/NNNNNN` (e.g. `SI/2627/000001`, `PO/…`, `GRN/…`, `JV/…`) | GST invoices need a unique, consecutive series per FY (≤ 16 chars). Generated inside the posting transaction with a row lock on the sequence, so numbers are gap-free on commit |
| 19 | 2026-10-27 | A posting with no effective GST rate for its HSN is rejected (`TAX_RATE_MISSING`, 422) | Silently treating an unknown rate as 0% under-collects tax. The POS flags the line before charging; Products shows a "No rate" badge |
| 20 | 2026-10-27 | "Load standard GST rates" seeds 5% for medicine HSNs (3002–3006, 3822, 4015, 9018) effective 2025-09-22, skipping HSNs that already have a version | Fast onboarding without hardcoding rates in posting paths: they are ordinary, auditable, end-datable rate versions. Owners must verify against current CBIC notifications |
| 21 | 2026-10-27 | Database triggers reject UPDATE/DELETE on `InventoryMovement`, `JournalLine` and `AuditLog` | Append-only must hold even against application bugs; corrections are compensating movements and reversing journals. `JournalEntry.reversedById` is the only mutable link |
| 22 | 2026-10-27 | `SalesInvoice.creditAmount` is the live unpaid balance (reduced by receipts and by returns against open credit); customer outstanding = opening balance + Σ creditAmount. Credit limit 0 means "no limit" | One source of truth for receivables, aging and credit checks; returns settle open credit before refunding cash |
| 23 | 2026-10-27 | Inventory is booked in the GL at supplier invoice, not at goods receipt | GRN moves physical stock; the invoice fixes cost and input GST. Stock valuation reports the GRN-but-unbilled gap explicitly (`unbookedDifference`) instead of using an accrual account |
| 24 | 2026-10-27 | Retail bills round to the whole rupee (half-up) and tenders must equal the rounded total | Matches counter practice; the rounding difference is part of the invoice total so books, tenders and the printed bill agree |
| 25 | 2026-10-27 | Tender mapping: CASH → Cash in Hand; UPI, CARD, BANK → Bank; CREDIT → Accounts Receivable | Card/UPI settle to the bank; keeps cash-drawer reconciliation honest |
| 26 | 2026-10-27 | Same-day journal reversals are compared by IST calendar date and never timestamped before the original | Manual journals are stamped 12:00 IST; a morning reversal was wrongly rejected as "dated before the original" |
| 27 | 2026-10-27 | `apps/web` build pins `NODE_ENV=production` (with pnpm `shell-emulator`) | A developer shell exporting `NODE_ENV=development` broke Next's `/404` prerender during `next build` |
| 28 | 2026-10-27 | Subscription policy lives in `TenantContextGuard`: suspended → 403 `SUBSCRIPTION_INACTIVE` (except the subscription view); lapsed → 402 on writes, reads allowed; `@RequireModule` → 403 `FEATURE_NOT_ENTITLED` | One server-side choke point; a lapsed pharmacy can still look up records and export data but cannot post |
| 29 | 2026-10-27 | The trial includes every module (300 invoices/month, 1 branch, 3 users, 3 warehouses) | Prospects must be able to evaluate the whole PRD journey before choosing a plan |
| 30 | 2026-10-27 | Organization settings PATCH merges keys and can never set `suspended` | Settings were overwritten wholesale, which let a tenant clear its own suspension and wiped other keys |
| 31 | 2026-10-27 | Plans are assigned by platform administrators (with a payment reference note); no payment gateway | Spec §1.32: payment collection is not represented as operational until a gateway is connected |
| 32 | 2026-10-27 | `/auth/*` and `/platform/*` ignore tenant headers; the web client never sends them there | On a shared counter PC, a stale tenant from the previous user made `/auth/me` return 404 and bounced the next user to login |
| 33 | 2026-10-27 | Audit rows store the actor email at write time; older rows resolve it at read time | Rows are append-only (no backfill); the audit viewer showed "system" for user actions |
| 34 | 2026-10-27 | Sales-report net sales, cost of goods and gross margin are read from the P&L, not recomputed from invoice lines | Recomputing ignored returns and differed from Accounting; one source of truth for money figures |
| 35 | 2026-10-27 | Tender mix counts an invoice's payments in time order up to its total; anything beyond is a later collection | Counter tenders always equal the bill; the old 60-second heuristic counted a quick receipt as a sale tender |
| 36 | 2026-10-27 | Input tax credit summary only counts suppliers with a GSTIN | Section 16 CGST Act requires a tax invoice from a registered supplier; tax on unregistered purchases is shown as not claimable |
| 37 | 2026-10-27 | "GST tax rates configured" is a recommended (non-blocking) setup step | Sales are already blocked per HSN when no rate exists; blocking onboarding would add no safety |

## Assumptions & unresolved questions

- The standard GST loader (decision 20) is a convenience seed, not legal advice: it MUST be checked against the official CBIC schedule; the research doc lists effective slabs with sources and flags the nil-rated drug list as needing verification.
- Whether a tenant is on the ₹40L vs ₹20L registration threshold is state-specific — recorded as "needs review" in the GST doc.
- Computerised-records conditions for Drugs Rules (the "65(2)(b) printouts" claim) could NOT be verified in official text — flagged for professional review; MediCore implements state-practice-agnostic digital records with exports.
- H1 physical-prescription retention beyond the 3-year register is state practice — flagged, not assumed.
