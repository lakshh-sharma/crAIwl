#!/usr/bin/env bash
# Idempotent local-dev seed. Verifies Postgres/Redis/MinIO are reachable and
# creates the `craiwl` schema scaffolding the rest of the app expects.
# Actual table DDL lives with the migration tool (CRAWL-005); this script only
# guarantees the database/role/schema exist so migrations have a target.

set -euo pipefail

PG_URL="${DATABASE_URL:-postgres://craiwl:craiwl@localhost:5432/craiwl}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"

echo "==> Checking Postgres at ${PG_URL%@*}@***"
docker exec craiwl-postgres pg_isready -U craiwl -d craiwl >/dev/null
docker exec craiwl-postgres psql -U craiwl -d craiwl -c "CREATE SCHEMA IF NOT EXISTS craiwl AUTHORIZATION craiwl;" >/dev/null
echo "    ok"

echo "==> Checking Redis"
docker exec craiwl-redis redis-cli ping >/dev/null
echo "    ok"

echo "==> Checking MinIO at ${S3_ENDPOINT}"
# minio-init created the buckets on `dev:up`; just verify they're listable.
docker run --rm --network craiwl_default \
  --entrypoint /bin/sh \
  minio/mc:latest \
  -c "mc alias set local ${S3_ENDPOINT/localhost/minio} craiwl craiwl-dev-password >/dev/null && mc ls local/" \
  | grep -E 'craiwl-(snapshots|outputs)' >/dev/null
echo "    ok"

echo "==> Seed complete."
