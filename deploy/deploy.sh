#!/usr/bin/env bash
# Pull-based deploy for the MediCore VM. Runs from cron every couple of minutes.
#
# The VM sits on a private network, so GitHub cannot reach it. Instead the VM asks
# GitHub whether main has moved, waits for every CI check on that commit to pass,
# then rebuilds the stack. If the new build is unhealthy it rolls back to the last
# good commit. Nothing inbound is opened and no secret leaves the VM.
set -euo pipefail

# Re-run from a copy so that updating this file mid-deploy cannot confuse bash.
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  tmp="$(mktemp)"; cp "$0" "$tmp"
  DEPLOY_REEXEC=1 APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}" exec bash "$tmp" "$@"
fi

REPO="${REPO:-Godevs04/MedStore}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:?APP_DIR not set}"
LOG="${LOG_FILE:-$HOME/medicore-deploy.log}"
STATE="${STATE_DIR:-$HOME/.medicore-deploy}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env)
mkdir -p "$STATE"

exec 9>"$STATE/lock"
flock -n 9 || exit 0

log() { echo "$(date -Is) $*" >> "$LOG"; }

cd "$APP_DIR"
git fetch -q origin "$BRANCH"
remote="$(git rev-parse "origin/$BRANCH")"
current="$(git rev-parse HEAD)"
[ "$remote" = "$current" ] && exit 0
[ -f "$STATE/failed-$remote" ] && exit 0

# CI gate: every check run on the commit must have finished successfully.
ci="$(python3 - "$REPO" "$remote" <<'PY'
import json, sys, urllib.request
repo, sha = sys.argv[1:3]
req = urllib.request.Request(
    f"https://api.github.com/repos/{repo}/commits/{sha}/check-runs?per_page=100",
    headers={"Accept": "application/vnd.github+json", "User-Agent": "medicore-deployer"},
)
try:
    runs = json.load(urllib.request.urlopen(req, timeout=20))["check_runs"]
except Exception:
    print("pending"); sys.exit()
if not runs: print("pending")
elif any(r["status"] != "completed" for r in runs): print("pending")
elif all(r["conclusion"] in ("success", "skipped", "neutral") for r in runs): print("success")
else: print("failure")
PY
)"
case "$ci" in
  success) ;;
  pending) exit 0 ;;
  *) log "CI did not pass for $remote; not deploying"; touch "$STATE/failed-$remote"; exit 0 ;;
esac

healthy() {
  for _ in $(seq 1 45); do
    if curl -fsS -m 5 http://localhost:3101/api/v1/health >/dev/null 2>&1 && curl -fsS -m 5 -o /dev/null http://localhost:3100/; then
      return 0
    fi
    sleep 4
  done
  return 1
}

log "Deploying $remote (was $current)"
git reset --hard -q "$remote"
if "${COMPOSE[@]}" up -d --build >>"$LOG" 2>&1 && healthy; then
  log "Deployed $remote"
  docker image prune -f >/dev/null 2>&1 || true
else
  log "Deploy of $remote FAILED; rolling back to $current"
  touch "$STATE/failed-$remote"
  git reset --hard -q "$current"
  "${COMPOSE[@]}" up -d --build >>"$LOG" 2>&1 || true
  exit 1
fi
