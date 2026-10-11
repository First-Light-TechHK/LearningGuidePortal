#!/usr/bin/env bash
# Study Group PostgreSQL io proofs (`npm run test:io:pg`). The fail-closed
# provisioning (DATABASE_URL passthrough, or a disposable postgres:16
# container with the two readiness gates) now lives in the generalized
# scripts/pg-io-postgres.sh; this wrapper keeps the historical entry point.
set -euo pipefail

cd "$(dirname "$0")/.."

# The glob must stay unquoted: this shell expands it, so future
# study-group-*.test.ts files are picked up automatically.
exec bash scripts/pg-io-postgres.sh tests/io/postgres/study-group-*.test.ts
