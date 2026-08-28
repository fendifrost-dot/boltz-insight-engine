#!/usr/bin/env bash
# Executes the migration chain against a real PostgreSQL database.
# Fails (exit 1) when psql or a running PostgreSQL server is unavailable.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required for migration integration tests." >&2
  exit 1
fi

PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-postgres}"
TEST_DB="boltz_migration_test_$$"

MIGRATIONS=(
  "supabase/migrations/20260825155900_baseline_ops_schema_adoption.sql"
  "supabase/migrations/20260825165448_28fff59b-8dad-453e-abdc-80c5133bdf5d.sql"
  "supabase/migrations/20260825165502_bef165f1-1a33-4591-8687-a92384202fb1.sql"
  "supabase/migrations/20260826001442_5d12525c-3d20-4454-b554-05ae0d3e0e16.sql"
  "supabase/migrations/20260826001500_c6b8bc61-c333-4d63-ad2d-ed758784bc3e.sql"
  "supabase/migrations/20260827230000_lock_role_probe_to_caller.sql"
)

cleanup() {
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${TEST_DB}\";" postgres >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql_admin() {
  sudo -u postgres psql -v ON_ERROR_STOP=1 "$@"
}

apply_file() {
  local file="$1"
  echo "Applying ${file}..."
  psql_admin -d "${TEST_DB}" -f "${ROOT}/${file}"
}

apply_baseline() {
  apply_file "supabase/migrations/20260825155900_baseline_ops_schema_adoption.sql"
}

setup_auth_stub() {
  psql_admin -d "${TEST_DB}" <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT NULL::uuid $$;
SQL
}

assert_lead_inbox_tables() {
  local count
  count="$(psql_admin -d "${TEST_DB}" -Atc "
    SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'leads','lead_events','message_threads','messages','message_jobs',
        'agent_runs','escalations','ringcentral_subscriptions','integration_health_snapshots'
      );")"
  if [[ "${count}" != "9" ]]; then
    echo "ERROR: expected 9 lead-inbox tables, found ${count}" >&2
    exit 1
  fi
}

assert_role_probes_locked() {
  local has_role_def is_staff_def
  has_role_def="$(psql_admin -d "${TEST_DB}" -Atc "SELECT pg_get_functiondef('public.has_role(uuid, app_role)'::regprocedure);")"
  is_staff_def="$(psql_admin -d "${TEST_DB}" -Atc "SELECT pg_get_functiondef('public.is_staff(uuid)'::regprocedure);")"
  if [[ "${has_role_def}" != *"_user_id = auth.uid()"* ]]; then
    echo "ERROR: has_role is not caller-locked" >&2
    exit 1
  fi
  if [[ "${is_staff_def}" != *"_user_id = auth.uid()"* ]]; then
    echo "ERROR: is_staff is not caller-locked" >&2
    exit 1
  fi
}

echo "Creating isolated database ${TEST_DB}..."
psql_admin -c "DROP DATABASE IF EXISTS \"${TEST_DB}\";" postgres >/dev/null
psql_admin -c "CREATE DATABASE \"${TEST_DB}\";" postgres

setup_supabase_roles() {
  psql_admin -d "${TEST_DB}" <<'SQL'
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
SQL
}

setup_supabase_roles

echo "Test 1: complete migration chain on empty database"
apply_baseline
setup_auth_stub
for file in "${MIGRATIONS[@]:1}"; do
  if [[ "${file}" == *"20260826001442"* ]]; then
    : # auth stub already created
  fi
  apply_file "${file}"
done
assert_lead_inbox_tables
assert_role_probes_locked

echo "Test 2: baseline is idempotent on production-shaped schema"
apply_baseline

echo "Test 3: baseline succeeds a second time"
apply_baseline

echo "PostgreSQL migration integration tests passed."
