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

All configuration via env vars validated at boot (`apps/api/src/config/env.ts`): `DATABASE_URL`, `SESSION_SECRET` (≥32 chars), `PORT`, `CORS_ORIGIN`, `WEB_APP_URL` (origin for emailed links; defaults to the first `CORS_ORIGIN`), `SUPERADMIN_EMAILS`, `EMAIL_TRANSPORT`, SMTP settings and the Razorpay keys and webhook secret. `.env` is gitignored; `.env.example` documents each.

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

## CI

`.github/workflows/ci.yml` runs on every pull request and on `main`: lint, typecheck, unit tests and a full build in one job, and the integration suite against a `postgres:16` service container in another.

## Production on the internal VM

Production runs on the internal VM as a Docker Compose stack (`docker-compose.prod.yml`): the API, the web app and a database on the shared `homelab-postgres`. Cloudflare Tunnel is the only way in; every container port is bound to `127.0.0.1`.

| URL | Container | Host port |
|---|---|---|
| `https://medicore.teamgodevs.in` | `medicore-web-1` | 3100 |
| `https://apimedicore.teamgodevs.in` | `medicore-api-1` | 3101 |

### Where the environment files are

Secrets never live in git. Files starting with a dot are hidden by default, so use `ls -a`.

| File | Where | Holds |
|---|---|---|
| `~/medicore/.env` | the VM | Database password, session secret, public URLs, SMTP, Razorpay keys and webhook secret, superadmin emails |
| `~/medicore/tunnel.env` | the VM | The Cloudflare tunnel token |
| `apps/api/.env` | your laptop, local development only | Copy from `apps/api/.env.example` |
| `apps/web/.env.local` | your laptop, local development only | Copy from `apps/web/.env.example`. The web app has no secrets: `NEXT_PUBLIC_API_URL` is baked into the bundle at build time from `API_ORIGIN` in the VM's `.env` |

After editing `~/medicore/.env`, apply it with:

```bash
cd ~/medicore && docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Changing `API_ORIGIN` or `SUPPORT_EMAIL` also needs `--build`, because the web app bakes them in.

### Workflow: branch, pull request, merge

1. Create a branch, commit, push it and open a pull request into `main`.
2. CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, a full build and the integration suite against Postgres.
3. Merge once CI is green. Nobody pushes to `main` directly.

### Deploy

The VM is on a private network, so GitHub cannot reach it. `deploy/deploy.sh` runs from cron on the VM, asks GitHub whether `main` has moved, waits until every CI check on that commit has passed, then rebuilds the stack and checks the health endpoints. If the new build is unhealthy it rolls back to the previous commit. Nothing inbound is opened.

- Log: `~/medicore-deploy.log`
- A commit that failed CI or failed to start is remembered in `~/.medicore-deploy/failed-<sha>` and not retried. Push a fix and it deploys.
- Manual run: `~/medicore/deploy/deploy.sh`

### Razorpay: test mode to live mode

Test mode is on while the keys start with `rzp_test_`. The Plan & billing page shows a banner while it is. To go live:

1. In the Razorpay Dashboard, switch to Live mode and generate live API keys.
2. In **Webhooks**, add `https://apimedicore.teamgodevs.in/api/v1/billing/webhook` with the events `payment.captured` and `order.paid`, and a new secret.
3. In `~/medicore/.env` set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` to the live values and restart the API.
4. Make one real payment of the smallest plan and confirm the plan activates.

The webhook and the in-browser confirmation share one code path and a plan is applied once per payment id, so a customer who closes the tab after paying still gets their plan.
