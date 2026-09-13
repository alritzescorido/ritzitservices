#!/usr/bin/env bash
# Rebuilds a scratch database from db/schema.sql and runs every test file in order.
# Requires the compose stack in db/docker-compose.yml to be up, or set PSQL to your own psql.
#   bash db/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

PSQL="${PSQL:-docker compose -f db/docker-compose.yml exec -T db psql -v ON_ERROR_STOP=1 -U lpb}"
DB="${TEST_DB:-lpb_test}"

echo "== recreate $DB"
$PSQL -d postgres -q -c "drop database if exists $DB" -c "create database $DB"

echo "== load db/schema.sql"
$PSQL -d "$DB" -q < db/schema.sql

for f in db/tests/*.sql; do
  echo "== $f"
  $PSQL -d "$DB" -q < "$f"
done
echo "== all test files passed"
