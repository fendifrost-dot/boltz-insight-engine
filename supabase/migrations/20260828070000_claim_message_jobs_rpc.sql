-- Atomic job claim with stale processing-lease recovery.
-- Callable only by service_role (server-side cron/workers).

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
  _lease_cutoff timestamptz := now() - (_lease_ms * interval '1 millisecond');
  _now timestamptz := now();
  _recovered integer := 0;
  _jobs jsonb;
BEGIN
  IF _limit <= 0 THEN
    RETURN jsonb_build_object('recovered', 0, 'jobs', '[]'::jsonb);
  END IF;

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
    AND locked_at < _lease_cutoff;
  GET DIAGNOSTICS _recovered = ROW_COUNT;

  WITH picked AS (
    SELECT id
    FROM public.message_jobs
    WHERE status = 'pending'
      AND run_after <= _now
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
    RETURNING j.*
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb)
  INTO _jobs
  FROM claimed;

  RETURN jsonb_build_object('recovered', _recovered, 'jobs', _jobs);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_message_jobs(integer, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_message_jobs(integer, integer) TO service_role;
