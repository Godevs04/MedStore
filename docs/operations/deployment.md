# Operations — Development & Deployment

## Local environment

| Component | Detail |
|---|---|
| Node | ≥ 22 (pnpm 9 via corepack) |
| PostgreSQL | Dedicated cluster: `~/medicore-pgdata`, port **5433**, user `medicore`, trust auth (localhost only). Start: `pnpm db:start` (= `infrastructure/scripts/start-postgres.sh`) |
| Databases | `medicore_dev` (app), `medicore_test` (integration tests, truncated per run) |
| API | `:3001` — build first (`pnpm --filter @medicore/api build`), run `node dist/main.js` |
| Web | `:3000` — `pnpm --filter @medicore/web dev` |

**Known dev-mode gotcha:** after editing shared web modules, React context can duplicate across chunk graphs — restart `next dev` with `rm -rf .next` if pages hang on "Loading session…". Similarly, the API must be rebuilt+restarted after code changes; a stale `dist` silently serves old routes.

## Environment configuration

All configuration via env vars validated at boot (`apps/api/src/config/env.ts`): `DATABASE_URL`, `SESSION_SECRET` (≥32 chars), `PORT`, `CORS_ORIGIN`, `WEB_APP_URL` (origin for emailed links; defaults to the first `CORS_ORIGIN`), `SUPERADMIN_EMAILS`, `EMAIL_TRANSPORT`. `.env` is gitignored; `.env.example` documents each.

## Migrations

- Create: `pnpm --filter @medicore/api db:migrate:dev --name <name>` (dev DB)
- Deploy: `pnpm db:migrate` (`prisma migrate deploy`) — used by the test harness too
- Rollback strategy: migrations are forward-only; destructive changes require a documented compensating migration (spec §1.30). No destructive shortcuts permitted.

## Backup & recovery (baseline)

- The dev cluster is disposable; production backups are an ops phase (12) deliverable: `pg_dump` schedules, PITR via WAL archiving on the hosting provider, restore drills **before** any production claim (spec §32).
- **No disaster-recovery capability is claimed** — nothing has been restored because there is no production deployment yet.

## Health & observability

- `GET /api/v1/health` — readiness including DB round-trip.
- Correlation IDs on every response (`x-correlation-id`); errors carry them into the envelope.
- Sentry/OpenTelemetry: deferred (Phase 12) — recorded in DECISIONS.md.

## CI (planned, Phase 12)

GitHub Actions: install → typecheck → unit → integration (service container postgres:16) → builds. Not yet configured; verification is currently run locally (see phase reports).
