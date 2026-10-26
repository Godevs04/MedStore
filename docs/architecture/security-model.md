# Security Model

**Status:** Phases 0–3 implemented and tested. Items marked **Outstanding** are scheduled for later phases and are NOT claims of current capability (spec §1, §28, §34).

## Authentication

- **Password hashing:** argon2id (19 MiB memory, t=2, p=1 — OWASP baseline). Password history retained on change/reset.
- **Sessions:** opaque 256-bit random tokens; only SHA-256 hashes stored. httpOnly, SameSite=Lax cookies scoped to `/api/v1`; `Authorization: Bearer` accepted for API clients. 7-day sliding expiry (refreshed on use past 24h). Logout, password reset, and suspension revoke sessions.
- **Failed-login protection:** per-user counter; 5 failures → 15-minute lock (423 ACCOUNT_LOCKED). Login attempts recorded with IP/UA for analysis.
- **Password policy:** min 10 chars, mixed case + digit (Zod, shared with web forms).
- **Email verification / password reset / invitations:** single-use hashed tokens with expiry (1h reset, 7d invite). Reset revokes all sessions.
- **MFA:** NOT IMPLEMENTED (schema-ready; Phase 12 hardening).
- **Email delivery:** console transport only — the system logs intent and does NOT claim delivery (spec §1.32). SMTP integration lands with notification phase.

## Authorization

- **Permission catalog:** 34 `resource.action` keys seeded at startup; roles (system + custom) reference keys. A role name grants nothing beyond its explicitly assigned permissions (spec §4).
- **System roles:** Owner (implicit all), Organization Admin, Pharmacist, Store Manager, Cashier, Inventory Manager, Purchase Manager, Accountant, Auditor, Analyst — seeded per organization at registration with explicit permission sets.
- **Enforcement:** `SessionGuard` (global) → `TenantContextGuard` (global): resolves ACTIVE membership, loads role permissions, validates the requested branch and the user's assignment (owner or `branches.manage` holders operate org-wide), then enforces `@RequirePermissions(...)` per endpoint. 403 with stable `FORBIDDEN` code; cross-tenant lookups 404 to avoid existence leaks (negative tests assert this).
- **Platform superadmin:** a user flag, not an org role; dedicated platform admin area is Phase 11. No current endpoint grants tenant data access via the flag.

## Tenant isolation

- Every business query filters by `organizationId` derived from the **server-side** membership lookup — never from client claims.
- Branch scope: x-branch-id validated against the org and the user's assignments per request.
- Negative tests: unknown org → 404; other org's branch → 403/404; other org's product → 404; another tenant's allocate → 404/422 without data leakage.

## Input handling

- All bodies/queries validated by Zod (shared `@medicore/validation`) via a global pipe; env vars validated at boot (fail-fast).
- No raw SQL interpolation — the only `$queryRaw` use is the parameterized `SELECT ... FOR UPDATE` balance lock.
- Errors never expose SQL, stack traces, or internals (GlobalExceptionFilter; unhandled → generic INTERNAL_ERROR + correlationId).

## Data protection

- Secrets via env files (`.env` gitignored; `.env.example` committed). SESSION_SECRET required ≥ 32 chars.
- Audit log stores actor, event, entity, redacted details JSON; **no PHI exists yet** (prescription capture is Phase 8) — data-minimization rules documented there will apply.
- Helmet security headers; CORS restricted to configured origins with credentials.

## Outstanding (scheduled, not claimed)

| Item | Phase |
|---|---|
| CSRF: cookie auth + SameSite=Lax covers the SPA threat model for now; token-based CSRF headers re-evaluated when server-side forms arrive | 5/12 |
| Rate limiting (login, API-wide) | 12 |
| File uploads (prescriptions, attachments) — validation, private storage, signed links | 8/10 |
| Dependency vulnerability scanning in CI | 12 |
| `REVOKE UPDATE/DELETE` on append-only tables for the app DB role | 12 |
| Postgres RLS evaluation with connection pooling | 12 |
| Backup/restore testing, least-privilege DB roles | operations docs, 12 |
