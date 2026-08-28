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
  "supabase/migrations/20260828070000_claim_message_jobs_rpc.sql"
  "supabase/migrations/20260828110000_correlation_outbound_idempotency.sql"
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
        'agent_runs','escalations','ringcentral_subscriptions','integration_health_snapshots',
        'outbound_send_reservations'
      );")"
  if [[ "${count}" != "10" ]]; then
    echo "ERROR: expected 10 lead-inbox tables, found ${count}" >&2
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

assert_claim_message_jobs_rpc() {
  local fn_def complete_def fail_def
  fn_def="$(psql_cmd -d "${TEST_DB}" -Atc "SELECT pg_get_functiondef('public.claim_message_jobs(integer, integer)'::regprocedure);")"
  complete_def="$(psql_cmd -d "${TEST_DB}" -Atc "SELECT pg_get_functiondef('public.complete_message_job(uuid, integer)'::regprocedure);")"
  fail_def="$(psql_cmd -d "${TEST_DB}" -Atc "SELECT pg_get_functiondef('public.fail_message_job(uuid, integer, text)'::regprocedure);")"
  if [[ "${fn_def}" != *"SET search_path TO 'public'"* ]] && [[ "${fn_def}" != *"SET search_path = public"* ]]; then
    echo "ERROR: claim_message_jobs missing SET search_path = public" >&2
    exit 1
  fi
  if [[ "${complete_def}" != *"attempts = _expected_attempts"* ]]; then
    echo "ERROR: complete_message_job must fence on expected attempts" >&2
    exit 1
  fi
  if [[ "${fail_def}" != *"attempts = _expected_attempts"* ]]; then
    echo "ERROR: fail_message_job must fence on expected attempts" >&2
    exit 1
  fi
  if ! psql_cmd -d "${TEST_DB}" -Atc "SELECT has_function_privilege('authenticated', 'public.claim_message_jobs(integer, integer)', 'EXECUTE');" | grep -q f; then
    echo "ERROR: authenticated must not execute claim_message_jobs" >&2
    exit 1
  fi
  if ! psql_cmd -d "${TEST_DB}" -Atc "SELECT has_function_privilege('service_role', 'public.claim_message_jobs(integer, integer)', 'EXECUTE');" | grep -q t; then
    echo "ERROR: service_role must execute claim_message_jobs" >&2
    exit 1
  fi
  if ! psql_cmd -d "${TEST_DB}" -Atc "SELECT has_function_privilege('service_role', 'public.complete_message_job(uuid, integer)', 'EXECUTE');" | grep -q t; then
    echo "ERROR: service_role must execute complete_message_job" >&2
    exit 1
  fi
}

test_claim_message_jobs_rpc() {
  psql_cmd -d "${TEST_DB}" <<'SQL'
DO $$
DECLARE
  v_stale_id uuid;
  v_fresh_id uuid;
  v_fresh_processing_id uuid;
  v_max_stale_id uuid;
  v_max_pending_id uuid;
  v_single_id uuid;
  v_result jsonb;
  v_status public.message_job_status;
  v_attempts integer;
  v_seen boolean;
BEGIN
  INSERT INTO public.message_jobs (job_type, status, locked_at, attempts, max_attempts, run_after, payload)
  VALUES (
    'process_inbound',
    'processing',
    now() - interval '10 minutes',
    2,
    5,
    now(),
    '{"stale":true}'::jsonb
  )
  RETURNING id INTO v_stale_id;

  INSERT INTO public.message_jobs (job_type, status, run_after, payload)
  VALUES (
    'process_inbound',
    'pending',
    now(),
    '{"fresh":true}'::jsonb
  )
  RETURNING id INTO v_fresh_id;

  INSERT INTO public.message_jobs (job_type, status, locked_at, attempts, max_attempts, run_after, payload)
  VALUES (
    'process_inbound',
    'processing',
    now(),
    1,
    5,
    now(),
    '{"fresh_processing":true}'::jsonb
  )
  RETURNING id INTO v_fresh_processing_id;

  INSERT INTO public.message_jobs (job_type, status, locked_at, attempts, max_attempts, run_after, payload)
  VALUES (
    'process_inbound',
    'processing',
    now() - interval '10 minutes',
    5,
    5,
    now(),
    '{"max_stale":true}'::jsonb
  )
  RETURNING id INTO v_max_stale_id;

  INSERT INTO public.message_jobs (job_type, status, attempts, max_attempts, run_after, payload)
  VALUES (
    'process_inbound',
    'pending',
    5,
    5,
    now(),
    '{"max_pending":true}'::jsonb
  )
  RETURNING id INTO v_max_pending_id;

  v_result := public.claim_message_jobs(5, 120000);

  IF COALESCE((v_result->>'recovered')::integer, 0) <> 1 THEN
    RAISE EXCEPTION 'expected one recovered stale job, got %', v_result;
  END IF;

  IF COALESCE((v_result->>'expired_dead')::integer, 0) <> 1 THEN
    RAISE EXCEPTION 'expected one expired-dead stale job, got %', v_result;
  END IF;

  SELECT status, attempts INTO v_status, v_attempts
  FROM public.message_jobs
  WHERE id = v_stale_id;
  IF v_status <> 'processing' OR v_attempts <> 3 THEN
    RAISE EXCEPTION 'stale recoverable job should be reclaimed as processing attempts=3, got %/%', v_status, v_attempts;
  END IF;

  SELECT status, completed_at IS NOT NULL
  INTO v_status, v_seen
  FROM public.message_jobs
  WHERE id = v_max_stale_id;
  IF v_status <> 'dead' OR NOT v_seen THEN
    RAISE EXCEPTION 'max-attempt stale job should be dead with completed_at';
  END IF;

  SELECT status INTO v_status FROM public.message_jobs WHERE id = v_fresh_processing_id;
  IF v_status <> 'processing' THEN
    RAISE EXCEPTION 'fresh processing job must remain untouched, got %', v_status;
  END IF;

  SELECT status INTO v_status FROM public.message_jobs WHERE id = v_max_pending_id;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'max-attempt pending job must not be claimed, got %', v_status;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'jobs') elem
    WHERE (elem->>'id')::uuid = v_stale_id
  ) INTO v_seen;
  IF NOT v_seen THEN
    RAISE EXCEPTION 'claimed jobs must include stale job id';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'jobs') elem
    WHERE (elem->>'id')::uuid = v_fresh_id
  ) INTO v_seen;
  IF NOT v_seen THEN
    RAISE EXCEPTION 'claimed jobs must include fresh pending job id';
  END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(v_result->'jobs')) <> 2 THEN
    RAISE EXCEPTION 'expected exactly two claimed jobs, got %', v_result->'jobs';
  END IF;

  IF public.complete_message_job(v_stale_id, 2)->>'status' <> 'lost_lease' THEN
    RAISE EXCEPTION 'old worker must not complete after reclaim incremented attempts';
  END IF;

  IF public.complete_message_job(v_stale_id, 3)->>'status' <> 'completed' THEN
    RAISE EXCEPTION 'current worker must complete with matching attempts';
  END IF;

  INSERT INTO public.message_jobs (job_type, status, run_after, payload)
  VALUES ('process_inbound', 'pending', now(), '{"single":true}'::jsonb)
  RETURNING id INTO v_single_id;

  v_result := public.claim_message_jobs(1, 120000);
  IF (SELECT count(*) FROM jsonb_array_elements(v_result->'jobs')) <> 1 THEN
    RAISE EXCEPTION 'single claim should return one job';
  END IF;

  v_result := public.claim_message_jobs(1, 120000);
  IF (SELECT count(*) FROM jsonb_array_elements(v_result->'jobs')) <> 0 THEN
    RAISE EXCEPTION 'second concurrent-style claim must not return the same job';
  END IF;

  SELECT attempts INTO v_attempts FROM public.message_jobs WHERE id = v_single_id;
  IF v_attempts <> 1 THEN
    RAISE EXCEPTION 'valid claim must increment attempts exactly once, got %', v_attempts;
  END IF;

  v_result := public.claim_message_jobs(0, 120000);
  IF jsonb_array_length(v_result->'jobs') <> 0 THEN
    RAISE EXCEPTION 'limit 0 must return no jobs';
  END IF;

  BEGIN
    PERFORM public.claim_message_jobs(101, 120000);
    RAISE EXCEPTION 'limit above 100 must be rejected';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%limit must be between 1 and 100%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.claim_message_jobs(1, 500);
    RAISE EXCEPTION 'lease below 1000ms must be rejected';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%lease_ms must be between 1000 and 3600000%' THEN
        RAISE;
      END IF;
  END;
END $$;
SQL
}

assert_correlation_outbound_rpc() {
  local derive_def enqueue_def reserve_def
  derive_def="$(psql_cmd -d "${TEST_DB}" -Atc "SELECT pg_get_functiondef('public.derive_inbound_correlation_id(text, text)'::regprocedure);")"
  enqueue_def="$(psql_cmd -d "${TEST_DB}" -Atc "SELECT pg_get_functiondef('public.enqueue_inbound_message_job(text, jsonb)'::regprocedure);")"
  reserve_def="$(psql_cmd -d "${TEST_DB}" -Atc "SELECT pg_get_functiondef('public.reserve_outbound_send(text, uuid, uuid, uuid, text, text, integer)'::regprocedure);")"
  if [[ "${derive_def}" != *"SET search_path TO 'public'"* ]] && [[ "${derive_def}" != *"SET search_path = public"* ]]; then
    echo "ERROR: derive_inbound_correlation_id missing SET search_path = public" >&2
    exit 1
  fi
  if [[ "${enqueue_def}" != *"ON CONFLICT"* ]]; then
    echo "ERROR: enqueue_inbound_message_job must use ON CONFLICT for atomic idempotency" >&2
    exit 1
  fi
  if ! psql_cmd -d "${TEST_DB}" -Atc "SELECT has_function_privilege('authenticated', 'public.enqueue_inbound_message_job(text, jsonb)', 'EXECUTE');" | grep -q f; then
    echo "ERROR: authenticated must not execute enqueue_inbound_message_job" >&2
    exit 1
  fi
  if ! psql_cmd -d "${TEST_DB}" -Atc "SELECT has_function_privilege('service_role', 'public.reserve_outbound_send(text, uuid, uuid, uuid, text, text, integer)', 'EXECUTE');" | grep -q t; then
    echo "ERROR: service_role must execute reserve_outbound_send" >&2
    exit 1
  fi
}

test_correlation_outbound_idempotency() {
  psql_cmd -d "${TEST_DB}" <<'SQL'
DO $$
DECLARE
  v_corr_a uuid;
  v_corr_b uuid;
  v_first jsonb;
  v_second jsonb;
  v_lead_id uuid;
  v_thread_id uuid;
  v_reserve_a jsonb;
  v_reserve_b jsonb;
  v_complete jsonb;
  v_retry jsonb;
BEGIN
  v_corr_a := public.derive_inbound_correlation_id('ringcentral', 'prov-123');
  v_corr_b := public.derive_inbound_correlation_id('ringcentral', 'prov-123');
  IF v_corr_a <> v_corr_b THEN
    RAISE EXCEPTION 'correlation id must be deterministic';
  END IF;

  v_first := public.enqueue_inbound_message_job(
    'prov-123',
    '{"provider_message_id":"prov-123","from":"+15555550123"}'::jsonb
  );
  v_second := public.enqueue_inbound_message_job(
    'prov-123',
    '{"provider_message_id":"prov-123","from":"+15555550123"}'::jsonb
  );

  IF (v_first->>'created')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'first enqueue must create job';
  END IF;
  IF (v_second->>'created')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'duplicate enqueue must not create another job';
  END IF;
  IF v_first->>'job_id' <> v_second->>'job_id' THEN
    RAISE EXCEPTION 'duplicate enqueue must return the same job id';
  END IF;
  IF v_first->>'correlation_id' <> v_second->>'correlation_id' THEN
    RAISE EXCEPTION 'duplicate enqueue must return the same correlation id';
  END IF;

  INSERT INTO public.leads (phone_e164, lifecycle)
  VALUES ('+15555550999', 'New')
  RETURNING id INTO v_lead_id;

  INSERT INTO public.message_threads (lead_id, phone_e164, control_mode)
  VALUES (v_lead_id, '+15555550999', 'auto')
  RETURNING id INTO v_thread_id;

  v_reserve_a := public.reserve_outbound_send(
    'agent:test-message',
    v_corr_a,
    v_lead_id,
    v_thread_id,
    '+15555550999',
    'Hello from Boltz',
    120000
  );
  IF v_reserve_a->>'action' <> 'send' THEN
    RAISE EXCEPTION 'first reservation must allow send, got %', v_reserve_a;
  END IF;

  v_reserve_b := public.reserve_outbound_send(
    'agent:test-message',
    v_corr_a,
    v_lead_id,
    v_thread_id,
    '+15555550999',
    'Hello from Boltz',
    120000
  );
  IF v_reserve_b->>'action' <> 'skip' OR v_reserve_b->>'status' <> 'sending' THEN
    RAISE EXCEPTION 'concurrent reservation must skip while sending, got %', v_reserve_b;
  END IF;

  v_complete := public.complete_outbound_send(
    'agent:test-message',
    'rc-msg-1',
    NULL
  );
  IF v_complete->>'status' <> 'sent' THEN
    RAISE EXCEPTION 'complete_outbound_send must mark sent, got %', v_complete;
  END IF;

  v_retry := public.reserve_outbound_send(
    'agent:test-message',
    v_corr_a,
    v_lead_id,
    v_thread_id,
    '+15555550999',
    'Hello from Boltz',
    120000
  );
  IF v_retry->>'action' <> 'skip' OR v_retry->>'status' <> 'sent' THEN
    RAISE EXCEPTION 'retry after sent must skip, got %', v_retry;
  END IF;

  PERFORM public.reserve_outbound_send(
    'agent:ambiguous',
    v_corr_a,
    v_lead_id,
    v_thread_id,
    '+15555550999',
    'Ambiguous body',
    120000
  );
  PERFORM public.mark_outbound_send_ambiguous('agent:ambiguous', 'rc-msg-2', 'provider succeeded locally failed');
  v_retry := public.reserve_outbound_send(
    'agent:ambiguous',
    v_corr_a,
    v_lead_id,
    v_thread_id,
    '+15555550999',
    'Ambiguous body',
    120000
  );
  IF v_retry->>'action' <> 'review' OR v_retry->>'status' <> 'ambiguous' THEN
    RAISE EXCEPTION 'ambiguous reservation must require review, got %', v_retry;
  END IF;

  BEGIN
    PERFORM public.reserve_outbound_send(
      'agent:bad-lease',
      v_corr_a,
      v_lead_id,
      v_thread_id,
      '+15555550999',
      'Lease test',
      500
    );
    RAISE EXCEPTION 'lease below 1000ms must be rejected';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%lease_ms must be between 1000 and 3600000%' THEN
        RAISE;
      END IF;
  END;
END $$;
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
assert_claim_message_jobs_rpc
assert_correlation_outbound_rpc

echo "Test 4: lifecycle transition RPC is atomic and returns stale without audit"
test_lifecycle_transition_rpc

echo "Test 5: claim_message_jobs recovers stale processing leases and claims atomically"
test_claim_message_jobs_rpc

echo "Test 6: correlation identity and outbound reservation idempotency"
test_correlation_outbound_idempotency

echo "Test 2: baseline is idempotent on production-shaped schema"
apply_baseline
assert_trigger_functions_have_search_path

echo "Test 3: baseline succeeds a second time"
apply_baseline
assert_trigger_functions_have_search_path
assert_role_probes_locked

echo "PostgreSQL migration integration tests passed."
