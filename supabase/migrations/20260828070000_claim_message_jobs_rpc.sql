-- Atomic job claim with stale-lease recovery, retry ceilings, and lease-fenced completion.

CREATE OR REPLACE FUNCTION public.claim_message_jobs(
  _limit integer,
  _lease_ms integer DEFAULT 120000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lease_cutoff timestamptz;
  _now timestamptz := now();
  _recovered integer := 0;
  _expired_dead integer := 0;
  _jobs jsonb;
BEGIN
  IF _limit IS NULL OR _limit <= 0 THEN
    RETURN jsonb_build_object('recovered', 0, 'expired_dead', 0, 'jobs', '[]'::jsonb);
  END IF;

  IF _limit > 100 THEN
    RAISE EXCEPTION 'claim_message_jobs limit must be between 1 and 100, got %', _limit;
  END IF;

  IF _lease_ms IS NULL OR _lease_ms < 1000 OR _lease_ms > 3600000 THEN
    RAISE EXCEPTION 'claim_message_jobs lease_ms must be between 1000 and 3600000, got %', _lease_ms;
  END IF;

  _lease_cutoff := _now - (_lease_ms * interval '1 millisecond');

  UPDATE public.message_jobs
  SET
    status = 'dead',
    locked_at = NULL,
    completed_at = _now,
    last_error = LEFT(
      CASE
        WHEN last_error IS NULL OR last_error = '' THEN 'Expired processing lease at max attempts'
        ELSE last_error || '; expired processing lease at max attempts'
      END,
      600
    )
  WHERE status = 'processing'
    AND locked_at IS NOT NULL
    AND locked_at < _lease_cutoff
    AND attempts >= max_attempts;
  GET DIAGNOSTICS _expired_dead = ROW_COUNT;

  UPDATE public.message_jobs
  SET
    status = 'pending',
    locked_at = NULL,
    last_error = LEFT(
      CASE
        WHEN last_error IS NULL OR last_error = '' THEN 'Recovered from stale processing lease'
        ELSE last_error || '; recovered from stale processing lease'
      END,
      600
    )
  WHERE status = 'processing'
    AND locked_at IS NOT NULL
    AND locked_at < _lease_cutoff
    AND attempts < max_attempts;
  GET DIAGNOSTICS _recovered = ROW_COUNT;

  WITH picked AS (
    SELECT id
    FROM public.message_jobs
    WHERE status = 'pending'
      AND run_after <= _now
      AND attempts < max_attempts
      AND (locked_at IS NULL OR locked_at < _lease_cutoff)
    ORDER BY run_after ASC, id ASC
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.message_jobs AS j
    SET
      status = 'processing',
      locked_at = _now,
      attempts = j.attempts + 1
    FROM picked
    WHERE j.id = picked.id
      AND j.status = 'pending'
      AND j.attempts < j.max_attempts
    RETURNING j.*
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb)
  INTO _jobs
  FROM claimed;

  RETURN jsonb_build_object(
    'recovered', _recovered,
    'expired_dead', _expired_dead,
    'jobs', _jobs
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_message_job(
  _job_id uuid,
  _expected_attempts integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated uuid;
BEGIN
  UPDATE public.message_jobs
  SET
    status = 'succeeded',
    completed_at = now(),
    locked_at = NULL,
    last_error = NULL
  WHERE id = _job_id
    AND status = 'processing'
    AND attempts = _expected_attempts
  RETURNING id INTO _updated;

  IF _updated IS NULL THEN
    RETURN jsonb_build_object('status', 'lost_lease');
  END IF;

  RETURN jsonb_build_object('status', 'completed');
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_message_job(
  _job_id uuid,
  _expected_attempts integer,
  _error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated public.message_jobs%ROWTYPE;
  _dead boolean;
  _backoff_seconds integer;
BEGIN
  UPDATE public.message_jobs AS j
  SET
    status = CASE
      WHEN j.attempts >= j.max_attempts THEN 'dead'::public.message_job_status
      ELSE 'pending'::public.message_job_status
    END,
    last_error = LEFT(_error, 600),
    locked_at = NULL,
    run_after = CASE
      WHEN j.attempts >= j.max_attempts THEN j.run_after
      ELSE now() + (
        LEAST(
          1800,
          60 * power(2, GREATEST(0, j.attempts - 1)::integer)
        ) * interval '1 second'
      )
    END,
    completed_at = CASE
      WHEN j.attempts >= j.max_attempts THEN now()
      ELSE NULL
    END
  WHERE j.id = _job_id
    AND j.status = 'processing'
    AND j.attempts = _expected_attempts
  RETURNING j.* INTO _updated;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'lost_lease');
  END IF;

  _dead := _updated.status = 'dead';
  RETURN jsonb_build_object(
    'status', CASE WHEN _dead THEN 'dead' ELSE 'pending' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_message_jobs(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_message_job(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_message_job(uuid, integer, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_message_jobs(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_message_job(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_message_job(uuid, integer, text) TO service_role;
