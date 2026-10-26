# Transaction Boundaries

**Status:** boundaries implemented in Phases 1–3 and covered by integration tests. This document is the authoritative catalogue; new phases must extend it.

## Principles (spec §26)

1. Operations touching interdependent financial/inventory rows run in a single Prisma `$transaction`.
2. Balance mutations lock the balance row (`SELECT ... FOR UPDATE`) before read-modify-write.
3. External calls (email, future integrations) never run inside a transaction.
4. Audit writes happen **after commit** (audit uses a separate connection; writing inside the transaction would either race uncommitted FK targets or serialize audit with business data).
5. No automatic retries of non-idempotent operations (spec §1.31); client retry-safety comes from idempotency keys in Phase 5.

## Catalogue

| Operation | Boundary | Invariants asserted |
|---|---|---|
| `POST /auth/register` | 1 tx: user + org + 10 system roles + membership + trial subscription + default branch + settings. Audit after commit. | Duplicate email rejected pre-tx (409). |
| Login failure handling | 2 statements (counter/lock update; login-attempt row) + audit | Lock set on 5th failure; next attempt 423. |
| Invitation accept | 1 tx: user activation + membership ACTIVE + token consumed | Token single-use. |
| Member suspend | 1 tx: membership status + session revocation | Owner cannot be suspended. |
| Batch creation (opening stock) | 1 tx: batch upsert (merge on same lot key) + balance delta + `OPENING_STOCK` movement | Quantity > 0; warehouse org-checked. |
| FEFO allocation | Read-only (no tx) — eligibility filtered (SALEABLE, expiry ≥ today); explicit override audited | Expired/recalled/quarantined batches never allocated. |
| Stock adjustment | 1 tx: balance delta + movement; then adjustment row + audit | Negative result rejected (`INSUFFICIENT_STOCK`) under lock. |
| Transfer dispatch | 1 tx: transfer + lines + per-line deduction | Batch must exist in source warehouse; qty > 0. |
| Transfer receipt | 1 tx: per-line receipt + destination batch upsert + `TRANSFER_IN` + line update + status | Over-receipt rejected → whole receipt rolls back. |
| Transfer cancellation | 1 tx: return undelivered qty + status | Received transfers not cancellable. |
| Count posting | 1 tx: variance movements per line + status POSTED | Only COMPLETED counts post. |
| Recall creation | 1 tx: recall row + batch → RECALLED | Allocation of RECALLED batch → `BATCH_INELIGIBLE`. |
| Product update | 1 tx: product update + barcode replace + change-history row | — |
| Import commit | Per-row create with P2002 → skipped (retry-safe, never duplicated) | Server re-validates every row. |

## Failure semantics

- Any invariant violation throws `AppException` with a stable code; the surrounding transaction rolls back entirely (tested: concurrent deductions leave balance exactly stock − k·qty, never negative; partial receipts never over-receive).
- Audit-write failure logs loudly and does NOT fail the business operation (documented trade-off; moves to an outbox with BullMQ).
- External email send is fire-and-forget after commit.

## Planned (later phases)

- Phase 5 (POS): invoice + payment + inventory deduction + accounting entry in ONE transaction, guarded by idempotency key.
- Phase 7 (accounting): journal entries balanced within the posting transaction; immutable once posted.
- Phase 8: e-invoice calls strictly OUTSIDE the posting transaction (spec §26.G); status tracking via integration events.
