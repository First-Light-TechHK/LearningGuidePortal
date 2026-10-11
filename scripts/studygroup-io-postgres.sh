#!/usr/bin/env bash
# Study Group PostgreSQL io proofs (`npm run test:io:pg`) against a real
# PostgreSQL 16. Fail-closed: never silently skips the proofs.
#
#   - DATABASE_URL set   -> used as-is; docker is not involved.
#   - DATABASE_URL unset -> a disposable postgres:16 container is started and
#     removed on exit. If docker is not on PATH the script refuses (exit 2):
#     provide DATABASE_URL (postgres://... plus DATABASE_SSL=0) or install docker.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "studygroup-io-postgres: using the provided DATABASE_URL"
else
  if ! command -v docker >/dev/null 2>&1; then
    echo "studygroup-io-postgres: refusing to run. Either provide DATABASE_URL (postgres://... together with DATABASE_SSL=0) or make docker available on PATH; the io proofs are never silently skipped." >&2
    exit 2
  fi

  CONTAINER="lg-study-group-io-$$"
  cleanup() {
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  docker run -d --name "$CONTAINER" \
    -e POSTGRES_USER=lg -e POSTGRES_PASSWORD=lg -e POSTGRES_DB=study_group_io \
    -p 127.0.0.1::5432 \
    postgres:16 >/dev/null

  READY=0
  for _ in $(seq 1 60); do
    if docker exec "$CONTAINER" pg_isready -U lg -d study_group_io >/dev/null 2>&1; then
      READY=1
      break
    fi
    sleep 1
  done
  if [[ "$READY" != 1 ]]; then
    echo "studygroup-io-postgres: postgres did not accept connections after 60 attempts; giving up." >&2
    exit 2
  fi

  HOST_PORT=$(docker port "$CONTAINER" 5432/tcp | awk -F: 'NR == 1 { print $NF }')
  export DATABASE_URL="postgres://lg:lg@127.0.0.1:${HOST_PORT}/study_group_io"
  export DATABASE_SSL=0
  echo "studygroup-io-postgres: started a disposable postgres:16 container on ${HOST_PORT}"

  # The socket-based pg_isready above is also answered by the entrypoint's
  # temporary init server, which has no TCP listener; over the published port
  # that window drops connections ("terminated unexpectedly"). Wait for the
  # real server's TCP listener before the tests connect.
  TCP_READY=0
  for _ in $(seq 1 60); do
    if docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U lg -d study_group_io >/dev/null 2>&1; then
      TCP_READY=1
      break
    fi
    sleep 1
  done
  if [[ "$TCP_READY" != 1 ]]; then
    echo "studygroup-io-postgres: postgres did not accept TCP connections after 60 attempts; giving up." >&2
    exit 2
  fi
fi

npm run test:io:pg
