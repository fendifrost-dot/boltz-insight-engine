#!/usr/bin/env bash
# Executes the migration chain against a real PostgreSQL database.
# Fails (exit 1) when psql or a reachable PostgreSQL server is unavailable.
#
# Local Ubuntu default: uses sudo -u postgres when PGUSER=postgres and sudo exists.
# Remote/CI: set PGHOST, PGUSER, PGPASSWORD (and optionally PGPORT) and omit sudo.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required for migration integration tests." >&2
  exit 1
fi

PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-postgres}"
PGPORT="${PGPORT:-5432}"
TEST_DB="boltz_migration_test_$$"
USE_SUDO=0
if [[ "${PGUSER}" == "postgres" ]] && command -v sudo >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
  USE_SUDO=1
fi

MIGRATIONS=(
  "supabase/migrations/20260825155900_baseline_ops_schema_adoption.sql"
  "supabase/migrations/20260825165448_28fff59b-8dad-453e-abdc-80c5133bdf5d.sql"
  "supabase/migrations/20260825165502_bef165f1-1a33-4591-8687-a92384202fb1.sql"
  "supabase/migrations/20260826001442_5d12525c-3d20-4454-b554-05ae0d3e0e16.sql"
  "supabase/migrations/20260826001500_c6b8bc61-c333-4d63-ad2d-ed758784bc3e.sql"
  "supabase/migrations/20260827230000_lock_role_probe_to_caller.sql"
  "supabase/migrations/20260828013000_apply_lead_lifecycle_transition.sql"
)

psql_cmd() {
  if [[ "${USE_SUDO}" == "1" ]]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 "$@"
  else
    psql -v ON_ERROR_STOP=1 "$@"
  fi
}

cleanup() {
  psql_cmd -c "DROP DATABASE IF EXISTS \"${TEST_DB}\";" postgres >/dev/null 2>&1 || true
}
trap cleanup EXIT

apply_file() {
  local file="$1"
  echo "Applying ${file}..."
  psql_cmd -d "${TEST_DB}" -f "${ROOT}/${file}"
}

apply_baseline() {
  apply_file "supabase/migrations/20260825155900_baseline_ops_schema_adoption.sql"
}

setup_auth_stub() {
  psql_cmd -d "${TEST_DB}" <<'SQL'
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

setup_supabase_roles() {
  psql_cmd -d "${TEST_DB}" <<'SQL'
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
SQL
}

assert_lead_inbox_tables() {
  local count
  count="$(psql_cmd -d "${TEST_DB}" -Atc "
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
  has_role_def="$(psql_cmd -d "${TEST_DB}" -Atc "SELECT pg_get_functiondef('public.has_role(uuid, app_role)'::regprocedure);")"
  is_staff_def="$(psql_cmd -d "${TEST_DB}" -Atc "SELECT pg_get_functiondef('public.is_staff(uuid)'::regprocedure);")"
  if [[ "${has_role_def}" != *"_user_id = auth.uid()"* ]]; then
    echo "ERROR: has_role is not caller-locked" >&2
    exit 1
  fi
  if [[ "${is_staff_def}" != *"_user_id = auth.uid()"* ]]; then
    echo "ERROR: is_staff is not caller-locked" >&2
    exit 1
  fi
}

assert_trigger_functions_have_search_path() {
  local deny_def updated_def
  deny_def="$(psql_cmd -d "${TEST_DB}" -Atc "SELECT pg_get_functiondef('public.deny_lead_event_mutation()'::regprocedure);")"
  updated_def="$(psql_cmd -d "${TEST_DB}" -Atc "SELECT pg_get_functiondef('public.set_updated_at()'::regprocedure);")"
  if [[ "${deny_def}" != *"SET search_path TO 'public'"* ]] && [[ "${deny_def}" != *"SET search_path = public"* ]]; then
    echo "ERROR: deny_lead_event_mutation missing SET search_path = public" >&2
    exit 1
  fi
  if [[ "${updated_def}" != *"SET search_path TO 'public'"* ]] && [[ "${updated_def}" != *"SET search_path = public"* ]]; then
    echo "ERROR: set_updated_at missing SET search_path = public" >&2
    exit 1
  fi
}

assert_lifecycle_transition_rpc() {
  local fn_def
  fn_def="$(psql_cmd -d "${TEST_DB}" -Atc "SELECT pg_get_functiondef('public.apply_lead_lifecycle_transition(uuid, public.lead_lifecycle, public.lead_lifecycle, text, text, text, jsonb)'::regprocedure);")"
  if [[ "${fn_def}" != *"SET search_path TO 'public'"* ]] && [[ "${fn_def}" != *"SET search_path = public"* ]]; then
    echo "ERROR: apply_lead_lifecycle_transition missing SET search_path = public" >&2
    exit 1
  fi
  if ! psql_cmd -d "${TEST_DB}" -Atc "SELECT has_function_privilege('authenticated', 'public.apply_lead_lifecycle_transition(uuid, public.lead_lifecycle, public.lead_lifecycle, text, text, text, jsonb)', 'EXECUTE');" | grep -q f; then
    echo "ERROR: authenticated must not execute apply_lead_lifecycle_transition" >&2
    exit 1
  fi
  if ! psql_cmd -d "${TEST_DB}" -Atc "SELECT has_function_privilege('service_role', 'public.apply_lead_lifecycle_transition(uuid, public.lead_lifecycle, public.lead_lifecycle, text, text, text, jsonb)', 'EXECUTE');" | grep -q t; then
    echo "ERROR: service_role must execute apply_lead_lifecycle_transition" >&2
    exit 1
  fi
}

test_lifecycle_transition_rpc() {
  psql_cmd -d "${TEST_DB}" <<'SQL'
DO $$
DECLARE
  v_lead_id uuid;
  v_result jsonb;
  v_count integer;
BEGIN
  INSERT INTO public.leads (phone_e164, lifecycle)
  VALUES ('+15555550101', 'New')
  RETURNING id INTO v_lead_id;

  v_result := public.apply_lead_lifecycle_transition(
    v_lead_id,
    'New',
    'Contacted',
    'lifecycle_changed',
    'Test apply',
    'grok',
    '{"basis":"agent_decision","agent_run_id":"run-1","inbound_message_id":"msg-1"}'::jsonb
  );
  IF v_result->>'status' <> 'applied' THEN
    RAISE EXCEPTION 'expected applied, got %', v_result;
  END IF;

  IF (SELECT lifecycle FROM public.leads WHERE id = v_lead_id) <> 'Contacted' THEN
    RAISE EXCEPTION 'lead lifecycle was not updated';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.lead_events
  WHERE lead_id = v_lead_id AND event_type = 'lifecycle_changed';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected one lifecycle_changed event, got %', v_count;
  END IF;

  v_result := public.apply_lead_lifecycle_transition(
    v_lead_id,
    'New',
    'Qualified',
    'lifecycle_changed',
    'Stale apply',
    'grok',
    '{}'::jsonb
  );
  IF v_result->>'status' <> 'stale' THEN
    RAISE EXCEPTION 'expected stale, got %', v_result;
  END IF;

  IF (SELECT lifecycle FROM public.leads WHERE id = v_lead_id) <> 'Contacted' THEN
    RAISE EXCEPTION 'stale transition must not change lifecycle';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.lead_events
  WHERE lead_id = v_lead_id AND event_type = 'lifecycle_changed';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'stale transition must not insert audit event, got %', v_count;
  END IF;
END $$;
SQL

  psql_cmd -d "${TEST_DB}" <<'SQL'
CREATE OR REPLACE FUNCTION public.test_force_lead_event_fail()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.metadata ? 'test_force_fail' THEN
    RAISE EXCEPTION 'forced failure for atomicity test';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS test_force_lead_event_fail ON public.lead_events;
CREATE TRIGGER test_force_lead_event_fail
  BEFORE INSERT ON public.lead_events
  FOR EACH ROW EXECUTE FUNCTION public.test_force_lead_event_fail();
SQL

  psql_cmd -d "${TEST_DB}" <<'SQL'
DO $$
DECLARE
  v_lead_id uuid;
BEGIN
  INSERT INTO public.leads (phone_e164, lifecycle)
  VALUES ('+15555550102', 'New')
  RETURNING id INTO v_lead_id;

  BEGIN
    PERFORM public.apply_lead_lifecycle_transition(
      v_lead_id,
      'New',
      'Contacted',
      'lifecycle_changed',
      'Forced failure',
      'grok',
      '{"test_force_fail":true}'::jsonb
    );
    RAISE EXCEPTION 'expected forced failure';
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  IF (SELECT lifecycle FROM public.leads WHERE id = v_lead_id) <> 'New' THEN
    RAISE EXCEPTION 'failed event insert must roll back lifecycle update';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.lead_events
    WHERE lead_id = v_lead_id AND event_type = 'lifecycle_changed'
  ) THEN
    RAISE EXCEPTION 'failed event insert must not leave audit row';
  END IF;
END $$;
SQL

  psql_cmd -d "${TEST_DB}" <<'SQL'
DROP TRIGGER IF EXISTS test_force_lead_event_fail ON public.lead_events;
DROP FUNCTION IF EXISTS public.test_force_lead_event_fail();
SQL
}

echo "Creating isolated database ${TEST_DB} (PGHOST=${PGHOST} PGUSER=${PGUSER} sudo=${USE_SUDO})..."
psql_cmd -c "DROP DATABASE IF EXISTS \"${TEST_DB}\";" postgres >/dev/null
psql_cmd -c "CREATE DATABASE \"${TEST_DB}\";" postgres

setup_supabase_roles

echo "Test 1: complete migration chain on empty database"
apply_baseline
setup_auth_stub
for file in "${MIGRATIONS[@]:1}"; do
  apply_file "${file}"
done
assert_lead_inbox_tables
assert_role_probes_locked
assert_trigger_functions_have_search_path
assert_lifecycle_transition_rpc

echo "Test 4: lifecycle transition RPC is atomic and returns stale without audit"
test_lifecycle_transition_rpc

echo "Test 2: baseline is idempotent on production-shaped schema"
apply_baseline
assert_trigger_functions_have_search_path

echo "Test 3: baseline succeeds a second time"
apply_baseline
assert_trigger_functions_have_search_path
assert_role_probes_locked

echo "PostgreSQL migration integration tests passed."
