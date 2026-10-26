#!/usr/bin/env bash
# Starts the dedicated local PostgreSQL 18 cluster used for MediCore dev/test.
# Data lives outside the repo at ~/medicore-pgdata (initialized with a
# passwordless "medicore" superuser, listening on 127.0.0.1:5433 only).
set -euo pipefail

PG_BIN="/Library/PostgreSQL/18/bin"
PGDATA="$HOME/medicore-pgdata"
PORT=5433

if [[ ! -d "$PGDATA" ]]; then
  echo "Initializing new cluster at $PGDATA ..."
  mkdir -p "$PGDATA"
  "$PG_BIN/initdb" -D "$PGDATA" -U medicore --auth=trust --encoding=UTF8 --locale=C
fi

if "$PG_BIN/pg_ctl" -D "$PGDATA" status > /dev/null 2>&1; then
  echo "PostgreSQL already running on port $PORT"
else
  echo "Starting PostgreSQL on port $PORT ..."
  "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" -o "-p $PORT -k /tmp" start
fi

for db in medicore_dev medicore_test; do
  if ! "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U medicore -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    echo "Creating database $db"
    "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U medicore "$db"
  fi
done

echo "PostgreSQL ready: postgresql://medicore@localhost:$PORT/medicore_dev"
